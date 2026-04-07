import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEqStore } from '../../stores/eqStore';
import type { EqBandParams, PresetMeta } from '../../lib/ipc';
import { PresetBar } from '../daw/PresetBar';
import { PresetBrowser } from '../daw/PresetBrowser';
import { usePresets } from '../../hooks/usePresets';
import BiquadBandControl from './BiquadBandControl';
import {
  drawBackground,
  drawResponseCurve,
  freqToX,
  dbToY,
  xToFreq,
  yToDb,
  BAND_COLORS,
  CANVAS_DB_MIN,
  CANVAS_DB_MAX,
} from './eqCanvas';

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_HEIGHT = 200;
const HANDLE_RADIUS = 7;
const SAMPLE_RATE = 44_100;
const N_CURVE_POINTS = 200;

// ─── Local biquad magnitude (mirrors Rust for canvas preview) ─────────────────

type BandForCurve = Pick<EqBandParams, 'filter_type' | 'frequency' | 'gain_db' | 'q' | 'enabled'>;

function computeMagnitudeDb(band: BandForCurve, freqHz: number): number {
  if (!band.enabled || band.filter_type === 'bypass') return 0;
  const w = (2 * Math.PI * freqHz) / SAMPLE_RATE;
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cos2W = Math.cos(2 * w);
  const sin2W = Math.sin(2 * w);

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  const A = Math.pow(10, band.gain_db / 40);
  const sqrtA = Math.sqrt(A);

  switch (band.filter_type) {
    case 'peaking': {
      const alpha = sinW / (2 * band.q);
      b0 = 1 + alpha * A; b1 = -2 * cosW; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cosW; a2 = 1 - alpha / A;
      break;
    }
    case 'low_shelf': {
      const alpha = sinW / 2 * Math.SQRT2;
      b0 = A * ((A + 1) - (A - 1) * cosW + 2 * sqrtA * alpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosW);
      b2 = A * ((A + 1) - (A - 1) * cosW - 2 * sqrtA * alpha);
      a0 = (A + 1) + (A - 1) * cosW + 2 * sqrtA * alpha;
      a1 = -2 * ((A - 1) + (A + 1) * cosW);
      a2 = (A + 1) + (A - 1) * cosW - 2 * sqrtA * alpha;
      break;
    }
    case 'high_shelf': {
      const alpha = sinW / 2 * Math.SQRT2;
      b0 = A * ((A + 1) + (A - 1) * cosW + 2 * sqrtA * alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosW);
      b2 = A * ((A + 1) + (A - 1) * cosW - 2 * sqrtA * alpha);
      a0 = (A + 1) - (A - 1) * cosW + 2 * sqrtA * alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cosW);
      a2 = (A + 1) - (A - 1) * cosW - 2 * sqrtA * alpha;
      break;
    }
    case 'low_pass': {
      const q = 1 / Math.SQRT2;
      const alpha = sinW / (2 * q);
      b0 = (1 - cosW) / 2; b1 = 1 - cosW; b2 = (1 - cosW) / 2;
      a0 = 1 + alpha; a1 = -2 * cosW; a2 = 1 - alpha;
      break;
    }
    case 'high_pass': {
      const q = 1 / Math.SQRT2;
      const alpha = sinW / (2 * q);
      b0 = (1 + cosW) / 2; b1 = -(1 + cosW); b2 = (1 + cosW) / 2;
      a0 = 1 + alpha; a1 = -2 * cosW; a2 = 1 - alpha;
      break;
    }
  }

  const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0;
  const na1 = a1 / a0, na2 = a2 / a0;

  const numRe = nb0 + nb1 * cosW + nb2 * cos2W;
  const numIm = -(nb1 * sinW + nb2 * sin2W);
  const denRe = 1 + na1 * cosW + na2 * cos2W;
  const denIm = -(na1 * sinW + na2 * sin2W);

  const numSq = numRe * numRe + numIm * numIm;
  const denSq = denRe * denRe + denIm * denIm;

  if (denSq < 1e-30) return 0;
  return 10 * Math.log10(numSq / denSq);
}

function buildCurvePoints(bands: EqBandParams[]): { freq: number; db: number }[] {
  const logMin = Math.log10(20);
  const logMax = Math.log10(20_000);
  return Array.from({ length: N_CURVE_POINTS }, (_, i) => {
    const t = i / (N_CURVE_POINTS - 1);
    const freq = Math.pow(10, logMin + t * (logMax - logMin));
    const db = bands.reduce((sum, band) => sum + computeMagnitudeDb(band, freq), 0);
    return { freq, db };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  channelId: string;
}

const EqPanel = React.memo(function EqPanel({ channelId }: Props) {
  const bands = useEqStore((s) => s.channels[channelId]);
  const loadChannel = useEqStore((s) => s.loadChannel);
  const setBand = useEqStore((s) => s.setBand);
  const enableBand = useEqStore((s) => s.enableBand);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [currentPresetName, setCurrentPresetName] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const { captureAndSave, loadAndApply } = usePresets('eq', channelId);

  async function handleSavePreset(name: string) {
    await captureAndSave(name);
    setCurrentPresetName(name);
  }

  async function handleLoadPreset(meta: PresetMeta) {
    const preset = await loadAndApply(meta);
    setCurrentPresetName(preset.name);
    await loadChannel(channelId);
    setShowBrowser(false);
  }

  // ── Drag state ──────────────────────────────────────────────────────────────
  const dragBandRef = useRef<number | null>(null);
  /** Pending band params to send on next RAF tick. */
  const pendingIpcRef = useRef<{ bandIndex: number; params: EqBandParams } | null>(null);
  const rafRef = useRef<number>(0);

  // ── Load state on mount; cancel pending RAF on unmount ─────────────────────
  useEffect(() => {
    loadChannel(channelId).catch(() => {});
    return () => {
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [channelId, loadChannel]);

  // ── Canvas draw ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bands) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;

    drawBackground(ctx, width, height);

    // Frequency response curve
    const points = buildCurvePoints(bands);
    drawResponseCurve(ctx, points, width, height);

    // 0 dB centre line label
    ctx.fillStyle = '#6b7280'; // gray-500
    ctx.font = '9px monospace';
    ctx.fillText('0', 3, dbToY(0, height) - 2);

    // Band handles
    bands.forEach((band, i) => {
      if (!band.enabled || band.filter_type === 'bypass') return;
      // LP / HP handles sit on the 0 dB line since gain doesn't apply
      const gainForHandle =
        band.filter_type === 'low_pass' || band.filter_type === 'high_pass'
          ? 0
          : band.gain_db;
      const x = freqToX(band.frequency, width);
      const y = dbToY(gainForHandle, height);

      ctx.beginPath();
      ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = BAND_COLORS[i];
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Band number inside handle
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });
  }, [bands]);

  // ── IPC flush via RAF (throttles to ~60 fps) ────────────────────────────────
  // `flushIpc` runs at most once per animation frame. It both updates the
  // Zustand store (triggering a canvas redraw) and fires the Tauri IPC call.
  // `onPointerMove` only writes to the pending ref — no direct IPC from the
  // hot path.
  const flushIpc = useCallback(() => {
    rafRef.current = 0;
    if (!pendingIpcRef.current) return;
    const { bandIndex, params } = pendingIpcRef.current;
    pendingIpcRef.current = null;
    setBand(channelId, bandIndex, params);
  }, [channelId, setBand]);

  const scheduleIpc = useCallback(
    (bandIndex: number, params: EqBandParams) => {
      // Overwrite pending with latest — only the most recent drag position
      // within a frame is sent. This caps IPC at ~60 calls/s.
      pendingIpcRef.current = { bandIndex, params };
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(flushIpc);
      }
    },
    [flushIpc],
  );

  // ── Canvas pointer events ───────────────────────────────────────────────────
  const hitTestBand = useCallback(
    (cx: number, cy: number, width: number, height: number): number | null => {
      if (!bands) return null;
      for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        if (!band.enabled || band.filter_type === 'bypass') continue;
        const gainForHandle =
          band.filter_type === 'low_pass' || band.filter_type === 'high_pass'
            ? 0
            : band.gain_db;
        const hx = freqToX(band.frequency, width);
        const hy = dbToY(gainForHandle, height);
        if (Math.hypot(cx - hx, cy - hy) <= HANDLE_RADIUS + 4) return i;
      }
      return null;
    },
    [bands],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !bands) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const hit = hitTestBand(cx, cy, canvas.width, canvas.height);
      if (hit !== null) {
        dragBandRef.current = hit;
        canvas.setPointerCapture(e.pointerId);
      }
    },
    [bands, hitTestBand],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const bandIdx = dragBandRef.current;
      const canvas = canvasRef.current;
      if (bandIdx === null || !canvas || !bands) return;

      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const newFreq = Math.max(20, Math.min(20_000, xToFreq(cx, canvas.width)));
      const newDb = Math.max(CANVAS_DB_MIN, Math.min(CANVAS_DB_MAX, yToDb(cy, canvas.height)));

      const band = bands[bandIdx];
      const hasGain =
        band.filter_type !== 'low_pass' &&
        band.filter_type !== 'high_pass' &&
        band.filter_type !== 'bypass';

      const updated: EqBandParams = {
        ...band,
        frequency: Math.round(newFreq * 10) / 10,
        gain_db: hasGain ? Math.round(newDb * 10) / 10 : band.gain_db,
      };

      // Queue for next RAF tick. flushIpc handles both the Zustand update
      // (canvas redraw) and the IPC call — keeping the hot path IPC-free.
      scheduleIpc(bandIdx, updated);
    },
    [bands, channelId, setBand, scheduleIpc],
  );

  const onPointerUp = useCallback(() => {
    dragBandRef.current = null;
  }, []);

  // ── Canvas resize observer ──────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0 && canvas.width !== w) {
          canvas.width = w;
          canvas.height = CANVAS_HEIGHT;
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  if (!bands) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 text-xs">
        Loading EQ…
      </div>
    );
  }

  return (
    <div
      className="flex flex-col bg-gray-900 border border-gray-700 rounded select-none"
      aria-label="EQ panel"
    >
      {/* Header / Preset bar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-700">
        <span className="text-[10px] text-gray-400 font-semibold tracking-wider uppercase">
          Parametric EQ
        </span>
        <PresetBar
          presetType="eq"
          currentPresetName={currentPresetName}
          onSave={(name) => { void handleSavePreset(name); }}
          onBrowse={() => setShowBrowser((v) => !v)}
        />
      </div>
      {showBrowser && (
        <div className="absolute z-50">
          <PresetBrowser
            presetType="eq"
            onLoad={(meta) => { void handleLoadPreset(meta); }}
            onClose={() => setShowBrowser(false)}
            channelId={channelId}
          />
        </div>
      )}

      {/* Frequency response canvas */}
      <div ref={containerRef} className="w-full" style={{ height: CANVAS_HEIGHT }}>
        <canvas
          ref={canvasRef}
          width={600}
          height={CANVAS_HEIGHT}
          className="w-full cursor-crosshair"
          aria-label="frequency response canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {/* Frequency axis labels */}
      <div className="flex justify-between px-2 pb-0.5">
        {['20', '100', '1k', '10k', '20k'].map((label) => (
          <span key={label} className="text-[8px] text-gray-600">
            {label}
          </span>
        ))}
      </div>

      {/* Band controls */}
      <div className="flex overflow-x-auto border-t border-gray-700 py-1 px-1 gap-0">
        {bands.map((band, i) => (
          <BiquadBandControl
            key={i}
            bandIndex={i}
            params={band}
            onChange={(idx, params) => setBand(channelId, idx, params)}
            onEnableToggle={(idx, enabled) => enableBand(channelId, idx, enabled)}
          />
        ))}
      </div>
    </div>
  );
});

export default EqPanel;
