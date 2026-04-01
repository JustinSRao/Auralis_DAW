/**
 * ExportAudioDialog — modal dialog for offline audio export (Sprint 22).
 *
 * Supports:
 * - Format: WAV (16/24/32-bit float), FLAC (16/24-bit), MP3 (128/192/320 kbps)
 * - Sample rate: 44100 Hz or 48000 Hz
 * - Export range: Full Song or Custom Bars
 * - Stems: optional per-track stem files written to a chosen directory
 * - Progress bar during export
 * - Cancel button to abort a running job
 *
 * Follows the same visual and structural conventions as ExportMidiDialog.
 */

import { useEffect, useState } from 'react';
import { open as openDialog, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';

import { useExportStore } from '@/stores/exportStore';
import {
  ipcStartExport,
  ipcCancelExport,
  type ExportFormat,
  type ExportParams,
  type WavBitDepth,
} from '@/lib/ipc';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExportAudioDialogProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Types (internal)
// ---------------------------------------------------------------------------

type FormatKind = 'wav' | 'flac' | 'mp3';
type RangeMode  = 'full' | 'custom';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ExportAudioDialog renders a full-screen modal overlay for audio export.
 *
 * @param onClose - Called when the user dismisses the dialog.
 */
export function ExportAudioDialog({ onClose }: ExportAudioDialogProps) {
  // ── Local form state ──────────────────────────────────────────────────────
  const [formatKind, setFormatKind] = useState<FormatKind>('wav');
  const [bitDepth, setBitDepth]     = useState<WavBitDepth>('bits24');
  const [kbps, setKbps]             = useState<128 | 192 | 320>(192);
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(44100);
  const [rangeMode, setRangeMode]   = useState<RangeMode>('full');
  const [startBar, setStartBar]     = useState<number>(1);
  const [endBar, setEndBar]         = useState<number>(32);
  const [stems, setStems]           = useState(false);
  const [stemDir, setStemDir]       = useState<string>('');
  const [outputPath, setOutputPath] = useState<string>('');

  // ── Global export store ───────────────────────────────────────────────────
  const { isExporting, progress, error, setExporting, setProgress, setError, reset } =
    useExportStore();

  // ── Listen to backend progress events ─────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<number>('export_progress_changed', (event) => {
      const p = event.payload;
      if (p < 0) {
        // Negative value signals export failure.
        setExporting(false);
        setError('Export failed. See application logs for details.');
      } else {
        setProgress(p);
        if (p >= 1.0) {
          setExporting(false);
        }
      }
    })
      .then((fn) => { unlisten = fn; })
      .catch((e) => { console.error('Failed to register export listener:', e); });

    return () => { unlisten?.(); };
  }, [setExporting, setProgress, setError]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handlePickOutputPath() {
    const ext = formatKind === 'mp3' ? 'mp3' : formatKind === 'flac' ? 'wav' : 'wav';
    const path = await save({
      filters: [{ name: 'Audio Files', extensions: [ext] }],
      defaultPath: `export.${ext}`,
    });
    if (path) setOutputPath(path);
  }

  async function handlePickStemDir() {
    const dir = await openDialog({
      directory: true,
      title: 'Select Stem Output Directory',
    });
    if (typeof dir === 'string') setStemDir(dir);
  }

  async function handleExport() {
    if (!outputPath) {
      setError('Please choose an output file path.');
      return;
    }
    if (stems && !stemDir) {
      setError('Please choose a stem output directory.');
      return;
    }

    setError(null);
    reset();
    setExporting(true);

    const format: ExportFormat =
      formatKind === 'mp3'
        ? { format: 'mp3', kbps }
        : formatKind === 'flac'
        ? { format: 'flac', bitDepth }
        : { format: 'wav', bitDepth };

    const params: ExportParams = {
      outputPath,
      format,
      sampleRate,
      stems,
      stemOutputDir: stems ? stemDir : undefined,
      startBar:  rangeMode === 'custom' ? startBar  : undefined,
      endBar:    rangeMode === 'custom' ? endBar    : undefined,
    };

    try {
      await ipcStartExport(params);
    } catch (e) {
      setExporting(false);
      setError(String(e));
    }
  }

  async function handleCancel() {
    try {
      await ipcCancelExport();
    } catch (e) {
      console.error('Cancel export failed:', e);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  const canExport = !isExporting && !!outputPath && (!stems || !!stemDir);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         200,
        background:     'rgba(0,0,0,0.6)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background:  '#1e1e1e',
          border:      '1px solid #3a3a3a',
          borderRadius: 8,
          padding:     24,
          minWidth:    400,
          maxWidth:    520,
          color:       '#e0e0e0',
          fontSize:    13,
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>
          Export Audio
        </h2>

        {/* ── Format ── */}
        <Section label="Format">
          <div style={{ display: 'flex', gap: 12 }}>
            {(['wav', 'flac', 'mp3'] as FormatKind[]).map((f) => (
              <RadioLabel key={f} checked={formatKind === f} onChange={() => setFormatKind(f)}>
                {f.toUpperCase()}
              </RadioLabel>
            ))}
          </div>
        </Section>

        {/* ── Bit depth (WAV / FLAC) ── */}
        {formatKind !== 'mp3' && (
          <Section label="Bit Depth">
            <div style={{ display: 'flex', gap: 12 }}>
              {([
                ['bits16',      '16-bit'],
                ['bits24',      '24-bit'],
                ['bits32Float', '32-bit float'],
              ] as [WavBitDepth, string][]).map(([v, label]) => (
                <RadioLabel key={v} checked={bitDepth === v} onChange={() => setBitDepth(v)}>
                  {label}
                </RadioLabel>
              ))}
            </div>
          </Section>
        )}

        {/* ── Bitrate (MP3) ── */}
        {formatKind === 'mp3' && (
          <Section label="Bitrate">
            <div style={{ display: 'flex', gap: 12 }}>
              {([128, 192, 320] as const).map((k) => (
                <RadioLabel key={k} checked={kbps === k} onChange={() => setKbps(k)}>
                  {k} kbps
                </RadioLabel>
              ))}
            </div>
          </Section>
        )}

        {/* ── Sample Rate ── */}
        <Section label="Sample Rate">
          <div style={{ display: 'flex', gap: 12 }}>
            {([44100, 48000] as const).map((sr) => (
              <RadioLabel key={sr} checked={sampleRate === sr} onChange={() => setSampleRate(sr)}>
                {sr === 44100 ? '44.1 kHz' : '48 kHz'}
              </RadioLabel>
            ))}
          </div>
        </Section>

        {/* ── Export Range ── */}
        <Section label="Export Range">
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <RadioLabel checked={rangeMode === 'full'} onChange={() => setRangeMode('full')}>
              Full Song
            </RadioLabel>
            <RadioLabel checked={rangeMode === 'custom'} onChange={() => setRangeMode('custom')}>
              Custom Bars
            </RadioLabel>
          </div>
          {rangeMode === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ color: '#888', fontSize: 11 }}>Bar</label>
              <NumInput value={startBar} min={1} onChange={setStartBar} />
              <label style={{ color: '#888', fontSize: 11 }}>to</label>
              <NumInput value={endBar} min={startBar + 1} onChange={setEndBar} />
            </div>
          )}
        </Section>

        {/* ── Stems ── */}
        <Section label="Stems">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={stems}
              onChange={(e) => setStems(e.target.checked)}
            />
            Export per-track stem files
          </label>
          {stems && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span
                style={{
                  flex:        1,
                  padding:     '4px 8px',
                  background:  '#2a2a2a',
                  border:      '1px solid #3a3a3a',
                  borderRadius: 4,
                  color:       stemDir ? '#e0e0e0' : '#666',
                  fontSize:    12,
                  overflow:    'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace:  'nowrap',
                }}
              >
                {stemDir || 'No directory chosen'}
              </span>
              <PickButton onClick={() => void handlePickStemDir()}>Browse...</PickButton>
            </div>
          )}
        </Section>

        {/* ── Output File ── */}
        <Section label="Output File">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
              style={{
                flex:        1,
                padding:     '4px 8px',
                background:  '#2a2a2a',
                border:      '1px solid #3a3a3a',
                borderRadius: 4,
                color:       outputPath ? '#e0e0e0' : '#666',
                fontSize:    12,
                overflow:    'hidden',
                textOverflow: 'ellipsis',
                whiteSpace:  'nowrap',
              }}
            >
              {outputPath || 'No file chosen'}
            </span>
            <PickButton onClick={() => void handlePickOutputPath()}>Browse...</PickButton>
          </div>
        </Section>

        {/* ── Progress bar ── */}
        {isExporting && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                height:       6,
                background:   '#2a2a2a',
                borderRadius: 3,
                overflow:     'hidden',
              }}
            >
              <div
                style={{
                  height:     '100%',
                  width:      `${Math.round(progress * 100)}%`,
                  background: '#6c63ff',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: '#888', textAlign: 'right' }}>
              {Math.round(progress * 100)}%
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div
            style={{
              marginBottom: 16,
              padding:      '8px 12px',
              borderRadius: 4,
              fontSize:     12,
              background:   '#3a1a1a',
              border:       '1px solid #5a2a2a',
              color:        '#cf6f6f',
            }}
          >
            {error}
          </div>
        )}

        {/* ── Buttons ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {isExporting ? (
            <button
              onClick={() => void handleCancel()}
              style={cancelBtnStyle}
            >
              Cancel Export
            </button>
          ) : (
            <button onClick={onClose} style={secondaryBtnStyle}>
              Close
            </button>
          )}

          <button
            onClick={() => void handleExport()}
            disabled={!canExport}
            style={{
              ...primaryBtnStyle,
              background: canExport ? '#6c63ff' : '#4a4a6a',
              cursor:     canExport ? 'pointer' : 'not-allowed',
              opacity:    canExport ? 1 : 0.6,
            }}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function RadioLabel({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
      <input type="radio" checked={checked} onChange={onChange} />
      {children}
    </label>
  );
}

function NumInput({
  value,
  min,
  onChange,
}: {
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      onChange={(e) => onChange(Math.max(min, parseInt(e.target.value, 10) || min))}
      style={{
        width:       64,
        padding:     '4px 6px',
        background:  '#2a2a2a',
        border:      '1px solid #3a3a3a',
        borderRadius: 4,
        color:       '#e0e0e0',
        fontSize:    12,
      }}
    />
  );
}

function PickButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding:     '4px 10px',
        background:  '#2a2a2a',
        border:      '1px solid #3a3a3a',
        borderRadius: 4,
        color:       '#ccc',
        cursor:      'pointer',
        fontSize:    12,
        flexShrink:  0,
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Button style constants
// ---------------------------------------------------------------------------

const primaryBtnStyle: React.CSSProperties = {
  padding:     '6px 18px',
  border:      'none',
  borderRadius: 4,
  color:       '#fff',
  fontSize:    13,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:     '6px 16px',
  background:  'none',
  border:      '1px solid #3a3a3a',
  borderRadius: 4,
  color:       '#aaa',
  cursor:      'pointer',
  fontSize:    13,
};

const cancelBtnStyle: React.CSSProperties = {
  padding:     '6px 16px',
  background:  '#3a2a2a',
  border:      '1px solid #5a3a3a',
  borderRadius: 4,
  color:       '#cf9f9f',
  cursor:      'pointer',
  fontSize:    13,
};
