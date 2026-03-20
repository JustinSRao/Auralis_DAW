/**
 * Stretch panel for the Waveform Editor (Sprint 16).
 *
 * Provides controls for:
 * - Time-stretch (manual ratio input and BPM-match helper)
 * - Pitch-shift (semitone step buttons)
 * - Bake to file (write processed audio as a permanent WAV)
 *
 * Reads state from `waveformEditorStore` and `transportStore`.
 * Dispatches all mutations through the store actions (which handle IPC and
 * push commands to the history store).
 */

import { useState } from 'react'
import { tempDir } from '@tauri-apps/api/path'
import { useWaveformEditorStore } from '../../stores/waveformEditorStore'
import { useTransportStore } from '../../stores/transportStore'
import { ipcComputeBpmStretchRatio } from '../../lib/ipc'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StretchPanel() {
  const store = useWaveformEditorStore()
  const snap = useTransportStore((s) => s.snapshot)

  // Local input state — committed on Apply
  const [ratioInput, setRatioInput] = useState<string>(store.stretchRatio.toFixed(2))
  const [originalBpmInput, setOriginalBpmInput] = useState<string>('')
  const [computedRatio, setComputedRatio] = useState<number | null>(null)
  const [bpmError, setBpmError] = useState<string | null>(null)
  const [bakeStatus, setBakeStatus] = useState<'idle' | 'baking' | 'done'>('idle')

  const projectBpm = snap?.bpm ?? 120.0

  // ---------------------------------------------------------------------------
  // Stretch apply
  // ---------------------------------------------------------------------------

  async function handleApplyStretch() {
    const ratio = parseFloat(ratioInput)
    if (isNaN(ratio) || ratio < 0.5 || ratio > 2.0) {
      return
    }
    await store.applyStretch(ratio)
  }

  // ---------------------------------------------------------------------------
  // BPM match
  // ---------------------------------------------------------------------------

  async function handleComputeBpmRatio() {
    const origBpm = parseFloat(originalBpmInput)
    if (isNaN(origBpm) || origBpm <= 0) {
      setBpmError('Enter a valid original BPM')
      return
    }
    setBpmError(null)
    try {
      const ratio = await ipcComputeBpmStretchRatio(origBpm, projectBpm)
      setComputedRatio(ratio)
      setRatioInput(ratio.toFixed(3))
    } catch (e) {
      setBpmError(String(e))
    }
  }

  async function handleApplyBpmMatch() {
    if (computedRatio === null) return
    await store.applyStretch(computedRatio)
    setComputedRatio(null)
  }

  // ---------------------------------------------------------------------------
  // Pitch
  // ---------------------------------------------------------------------------

  async function handleApplyPitch() {
    await store.applyPitch(store.pitchSemitones)
  }

  function handlePitchStep(delta: number) {
    const newVal = Math.max(-24, Math.min(24, store.pitchSemitones + delta))
    useWaveformEditorStore.setState((s) => { s.pitchSemitones = newVal })
  }

  // ---------------------------------------------------------------------------
  // Bake
  // ---------------------------------------------------------------------------

  async function handleBake() {
    setBakeStatus('baking')
    try {
      const outDir = await tempDir()
      await store.bakeToFile(outDir)
      setBakeStatus('done')
      setTimeout(() => setBakeStatus('idle'), 2500)
    } catch {
      setBakeStatus('idle')
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const stretchApplyDisabled =
    store.isProcessing ||
    (() => {
      const v = parseFloat(ratioInput)
      return isNaN(v) || v < 0.5 || v > 2.0 || Math.abs(v - store.stretchRatio) < 1e-4
    })()

  const pitchApplyDisabled = store.isProcessing

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex flex-col gap-3 px-4 py-3 bg-[#111] border-b border-[#3a3a3a] text-[11px] font-mono text-[#aaa]"
      data-testid="stretch-panel"
    >
      {/* ── TIME STRETCH ── */}
      <section>
        <div className="text-[#5b8def] text-[9px] uppercase tracking-widest mb-2">
          Time Stretch
        </div>

        {/* Manual ratio */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[#666] w-10">Ratio</span>
          <input
            type="number"
            min={0.5}
            max={2.0}
            step={0.01}
            value={ratioInput}
            onChange={(e) => setRatioInput(e.target.value)}
            className="w-20 bg-[#222] border border-[#3a3a3a] rounded px-2 py-0.5 text-[#ccc] text-[11px] font-mono focus:outline-none focus:border-[#5b8def]"
            data-testid="stretch-ratio-input"
          />
          <button
            onClick={() => { void handleApplyStretch() }}
            disabled={stretchApplyDisabled}
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#5b8def] text-[#5b8def] hover:bg-[#5b8def20] disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid="btn-apply-stretch"
          >
            {store.isProcessing ? '...' : 'APPLY'}
          </button>
          <span className="text-[#444] text-[9px]">0.5–2.0</span>
        </div>

        {/* BPM match */}
        <div className="flex flex-col gap-1 pl-2 border-l border-[#2a2a2a]">
          <span className="text-[#555] text-[9px] uppercase">BPM Match</span>
          <div className="flex items-center gap-2">
            <span className="text-[#555] w-20">Original BPM</span>
            <input
              type="number"
              min={1}
              max={999}
              step={1}
              value={originalBpmInput}
              onChange={(e) => { setOriginalBpmInput(e.target.value); setComputedRatio(null); setBpmError(null) }}
              className="w-20 bg-[#222] border border-[#3a3a3a] rounded px-2 py-0.5 text-[#ccc] text-[11px] font-mono focus:outline-none focus:border-[#5b8def]"
              data-testid="original-bpm-input"
              placeholder="e.g. 120"
            />
            <span className="text-[#555]">Project BPM: {projectBpm.toFixed(1)}</span>
          </div>
          {bpmError && (
            <span className="text-red-400 text-[9px]">{bpmError}</span>
          )}
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => { void handleComputeBpmRatio() }}
              disabled={!originalBpmInput || store.isProcessing}
              className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#3a3a3a] text-[#888] hover:text-[#ccc] hover:border-[#555] disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="btn-compute-bpm"
            >
              COMPUTE
            </button>
            {computedRatio !== null && (
              <>
                <span className="text-[#56cc88]">Ratio: {computedRatio.toFixed(3)}x</span>
                <button
                  onClick={() => { void handleApplyBpmMatch() }}
                  disabled={store.isProcessing}
                  className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#56cc88] text-[#56cc88] hover:bg-[#56cc8820] disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid="btn-apply-bpm-match"
                >
                  APPLY BPM MATCH
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="h-px bg-[#2a2a2a]" />

      {/* ── PITCH SHIFT ── */}
      <section>
        <div className="text-[#5b8def] text-[9px] uppercase tracking-widest mb-2">
          Pitch Shift
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handlePitchStep(-1)}
            disabled={store.pitchSemitones <= -24 || store.isProcessing}
            className="w-6 h-6 flex items-center justify-center rounded border border-[#3a3a3a] text-[#888] hover:text-[#ccc] hover:border-[#555] disabled:opacity-30 disabled:cursor-not-allowed font-mono"
            data-testid="btn-pitch-minus"
          >
            −
          </button>
          <span
            className="w-24 text-center text-[#ccc] tabular-nums"
            data-testid="pitch-semitones-display"
          >
            {store.pitchSemitones > 0 ? `+${store.pitchSemitones}` : store.pitchSemitones} st
          </span>
          <button
            onClick={() => handlePitchStep(+1)}
            disabled={store.pitchSemitones >= 24 || store.isProcessing}
            className="w-6 h-6 flex items-center justify-center rounded border border-[#3a3a3a] text-[#888] hover:text-[#ccc] hover:border-[#555] disabled:opacity-30 disabled:cursor-not-allowed font-mono"
            data-testid="btn-pitch-plus"
          >
            +
          </button>
          <button
            onClick={() => { void handleApplyPitch() }}
            disabled={pitchApplyDisabled}
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#5b8def] text-[#5b8def] hover:bg-[#5b8def20] disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid="btn-apply-pitch"
          >
            {store.isProcessing ? '...' : 'APPLY'}
          </button>
        </div>
      </section>

      <div className="h-px bg-[#2a2a2a]" />

      {/* ── BAKE TO FILE ── */}
      <section>
        <button
          onClick={() => { void handleBake() }}
          disabled={store.isProcessing || bakeStatus === 'baking'}
          className={[
            'px-3 py-1 text-[11px] font-mono rounded border',
            bakeStatus === 'done'
              ? 'border-[#56cc88] text-[#56cc88]'
              : 'border-[#cc7755] text-[#cc7755] hover:bg-[#cc775520]',
            'disabled:opacity-30 disabled:cursor-not-allowed',
          ].join(' ')}
          data-testid="btn-bake"
        >
          {bakeStatus === 'baking' ? 'BAKING...' : bakeStatus === 'done' ? 'BAKED!' : 'BAKE TO FILE'}
        </button>
        <p className="text-[#444] text-[9px] mt-1">
          Renders stretch + pitch to a new WAV file. Cannot be undone after closing.
        </p>
      </section>
    </div>
  )
}
