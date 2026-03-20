/**
 * Toolbar for the Waveform Editor.
 *
 * Contains:
 * - Tool mode buttons: Select, Trim Start, Trim End
 * - Operation buttons: Cut, Reverse, Splice to Zero Crossing
 * - Zoom In / Zoom Out
 * - Undo / Redo
 */

import { tempDir } from '@tauri-apps/api/path'
import { useHistoryStore } from '../../stores/historyStore'
import { useWaveformEditorStore } from '../../stores/waveformEditorStore'
import {
  ipcComputeCutClip,
  ipcComputeTrimStartClip,
  ipcComputeTrimEndClip,
  ipcFindZeroCrossing,
  ipcReverseClipRegion,
} from '../../lib/ipc'
import type { ClipEditData } from '../../lib/ipc'
import {
  CutClipCommand,
  TrimClipCommand,
  ReverseClipCommand,
} from '../../lib/commands/WaveformEditCommands'
import { useFileStore } from '../../stores/fileStore'
import { useTransportStore } from '../../stores/transportStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolId = 'select' | 'trim-start' | 'trim-end'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WaveformToolbar() {
  const store = useWaveformEditorStore()
  const historyStore = useHistoryStore()

  const hasSelection = store.selection !== null
  const hasCursor = store.cursorFrame !== null

  // ---------------------------------------------------------------------------
  // IPC helpers
  // ---------------------------------------------------------------------------

  function buildClipEditData(): ClipEditData | null {
    const { activeClipId, activeTrackId, filePath } = store
    if (!activeClipId || !activeTrackId || !filePath) return null

    const project = useFileStore.getState().currentProject
    if (!project) return null

    const track = project.tracks.find((t) => t.id === activeTrackId)
    if (!track) return null

    const clip = track.clips.find((c) => c.id === activeClipId)
    if (!clip || clip.content.type !== 'Audio') return null

    return {
      id: clip.id,
      name: clip.name,
      startBeats: clip.start_beats,
      durationBeats: clip.duration_beats,
      sampleId: clip.content.sample_id,
      startOffsetSamples: clip.content.start_offset_samples,
      gain: clip.content.gain,
    }
  }

  function getSamplesPerBeat(): number {
    const snap = useTransportStore.getState().snapshot
    return (44100 * 60) / snap.bpm
  }

  // ---------------------------------------------------------------------------
  // Cut
  // ---------------------------------------------------------------------------

  async function handleCut() {
    const { selection, filePath, activeTrackId } = store
    if (!selection || !filePath || !activeTrackId) return

    const clipData = buildClipEditData()
    if (!clipData) return

    const samplesPerBeat = getSamplesPerBeat()

    try {
      // Snap both edges to zero crossings for a cleaner cut
      const [snappedStart, snappedEnd] = await Promise.all([
        ipcFindZeroCrossing(filePath, selection.startFrame, 512),
        ipcFindZeroCrossing(filePath, selection.endFrame, 512),
      ])

      // Use midpoint of selection as the cut point
      const cutFrame = Math.floor((snappedStart + snappedEnd) / 2)

      const result = await ipcComputeCutClip(clipData, cutFrame, samplesPerBeat)

      const cmd = new CutClipCommand(
        activeTrackId,
        result.removedClipId,
        clipData,
        result.clipA,
        result.clipB,
      )
      historyStore.push(cmd)

      // Close editor after cutting — clip is gone
      store.close()
    } catch (e) {
      useWaveformEditorStore.setState((s) => { s.error = String(e) })
    }
  }

  // ---------------------------------------------------------------------------
  // Reverse
  // ---------------------------------------------------------------------------

  async function handleReverse() {
    const { selection, filePath, activeTrackId } = store
    if (!selection || !filePath || !activeTrackId) return

    const clipData = buildClipEditData()
    if (!clipData) return

    const samplesPerBeat = getSamplesPerBeat()

    try {
      const outputDir = await tempDir()

      const result = await ipcReverseClipRegion(
        filePath,
        clipData,
        selection.startFrame,
        selection.endFrame,
        outputDir,
        samplesPerBeat,
      )

      const cmd = new ReverseClipCommand(
        activeTrackId,
        result.removedClipId,
        clipData,
        result.newClip,
        result.newSampleReference,
        result.reversedFilePath,
      )
      historyStore.push(cmd)

      // Close after reverse — the clip now points to a different file
      store.close()
    } catch (e) {
      useWaveformEditorStore.setState((s) => { s.error = String(e) })
    }
  }

  // ---------------------------------------------------------------------------
  // Trim (Start / End)
  // ---------------------------------------------------------------------------

  async function handleTrimStart() {
    const { cursorFrame, activeTrackId } = store
    if (cursorFrame === null || !activeTrackId) return

    const clipData = buildClipEditData()
    if (!clipData) return

    const samplesPerBeat = getSamplesPerBeat()

    try {
      const result = await ipcComputeTrimStartClip(clipData, cursorFrame, samplesPerBeat)
      const cmd = new TrimClipCommand(
        activeTrackId,
        result.clipId,
        result.before,
        result.after,
        'start',
      )
      historyStore.push(cmd)
    } catch (e) {
      useWaveformEditorStore.setState((s) => { s.error = String(e) })
    }
  }

  async function handleTrimEnd() {
    const { cursorFrame, activeTrackId } = store
    if (cursorFrame === null || !activeTrackId) return

    const clipData = buildClipEditData()
    if (!clipData) return

    const samplesPerBeat = getSamplesPerBeat()

    try {
      const result = await ipcComputeTrimEndClip(clipData, cursorFrame, samplesPerBeat)
      const cmd = new TrimClipCommand(
        activeTrackId,
        result.clipId,
        result.before,
        result.after,
        'end',
      )
      historyStore.push(cmd)
    } catch (e) {
      useWaveformEditorStore.setState((s) => { s.error = String(e) })
    }
  }

  // ---------------------------------------------------------------------------
  // Splice to zero crossing
  // ---------------------------------------------------------------------------

  async function handleSpliceToZeroCrossing() {
    const { cursorFrame, filePath } = store
    if (cursorFrame === null || !filePath) return

    try {
      const snapped = await ipcFindZeroCrossing(filePath, cursorFrame, 1024)
      store.setCursor(snapped)
    } catch (e) {
      useWaveformEditorStore.setState((s) => { s.error = String(e) })
    }
  }

  // ---------------------------------------------------------------------------
  // Zoom
  // ---------------------------------------------------------------------------

  function handleZoomIn() {
    const newFpp = Math.max(1, Math.floor(store.viewport.framesPerPixel / 2))
    store.setViewport({ framesPerPixel: newFpp })
    void store.loadPeakData()
  }

  function handleZoomOut() {
    const newFpp = store.viewport.framesPerPixel * 2
    store.setViewport({ framesPerPixel: newFpp })
    void store.loadPeakData()
  }

  // ---------------------------------------------------------------------------
  // Tool buttons config
  // ---------------------------------------------------------------------------

  const tools: Array<{ id: ToolId; label: string; title: string }> = [
    { id: 'select', label: 'SELECT', title: 'Select region (drag)' },
    { id: 'trim-start', label: 'TRIM START', title: 'Drag to trim clip start' },
    { id: 'trim-end', label: 'TRIM END', title: 'Drag to trim clip end' },
  ]

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex items-center gap-1 px-3 py-1 bg-[#1a1a1a] border-b border-[#3a3a3a] flex-shrink-0 flex-wrap"
      data-testid="waveform-toolbar"
    >
      {/* Tool selector */}
      <span className="text-[#555] text-[10px] font-mono mr-1">TOOL</span>
      {tools.map((t) => (
        <button
          key={t.id}
          title={t.title}
          onClick={() => store.setTool(t.id)}
          className={[
            'px-2 py-0.5 text-[10px] font-mono rounded border',
            store.tool === t.id
              ? 'border-[#5b8def] text-[#5b8def] bg-[#5b8def20]'
              : 'border-[#3a3a3a] text-[#666] hover:text-[#aaa] hover:border-[#555]',
          ].join(' ')}
        >
          {t.label}
        </button>
      ))}

      <div className="w-px h-4 bg-[#3a3a3a] mx-1" />

      {/* Operations */}
      <button
        title="Cut at midpoint of selection (snaps to zero crossings)"
        disabled={!hasSelection}
        onClick={() => { void handleCut() }}
        className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#3a3a3a] text-[#cc7755] hover:border-[#cc7755] disabled:opacity-30 disabled:cursor-not-allowed"
        data-testid="btn-cut"
      >
        CUT
      </button>

      <button
        title="Reverse selected region (writes new WAV)"
        disabled={!hasSelection}
        onClick={() => { void handleReverse() }}
        className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#3a3a3a] text-[#77cc88] hover:border-[#77cc88] disabled:opacity-30 disabled:cursor-not-allowed"
        data-testid="btn-reverse"
      >
        REVERSE
      </button>

      <button
        title="Snap cursor to nearest zero crossing"
        disabled={!hasCursor}
        onClick={() => { void handleSpliceToZeroCrossing() }}
        className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#3a3a3a] text-[#aaaaff] hover:border-[#aaaaff] disabled:opacity-30 disabled:cursor-not-allowed"
        data-testid="btn-splice"
      >
        SPLICE
      </button>

      {store.tool === 'trim-start' && (
        <button
          title="Apply trim start at cursor position"
          disabled={!hasCursor}
          onClick={() => { void handleTrimStart() }}
          className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#5b8def] text-[#5b8def] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          APPLY TRIM START
        </button>
      )}

      {store.tool === 'trim-end' && (
        <button
          title="Apply trim end at cursor position"
          disabled={!hasCursor}
          onClick={() => { void handleTrimEnd() }}
          className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#5b8def] text-[#5b8def] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          APPLY TRIM END
        </button>
      )}

      <div className="w-px h-4 bg-[#3a3a3a] mx-1" />

      {/* Zoom */}
      <button
        title="Zoom in"
        onClick={handleZoomIn}
        className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#3a3a3a] text-[#888] hover:text-[#ccc] hover:border-[#555]"
        data-testid="btn-zoom-in"
      >
        ZOOM IN
      </button>
      <button
        title="Zoom out"
        onClick={handleZoomOut}
        className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#3a3a3a] text-[#888] hover:text-[#ccc] hover:border-[#555]"
        data-testid="btn-zoom-out"
      >
        ZOOM OUT
      </button>
      <span className="text-[#444] text-[10px] font-mono ml-1">
        {store.viewport.framesPerPixel}fps/px
      </span>

      <div className="w-px h-4 bg-[#3a3a3a] mx-1" />

      {/* Sprint 16: Stretch / Pitch compact indicators (read-only) */}
      <span
        className="text-[#56cc88] text-[10px] font-mono"
        title="Current time-stretch ratio"
        data-testid="stretch-indicator"
      >
        {store.stretchRatio !== 1.0
          ? `×${store.stretchRatio.toFixed(2)}`
          : '×1.00'}
      </span>
      <span
        className="text-[#cc7755] text-[10px] font-mono"
        title="Current pitch shift in semitones"
        data-testid="pitch-indicator"
      >
        {store.pitchSemitones > 0
          ? `+${store.pitchSemitones}st`
          : store.pitchSemitones < 0
            ? `${store.pitchSemitones}st`
            : '+0st'}
      </span>

      <div className="w-px h-4 bg-[#3a3a3a] mx-1" />

      {/* Undo / Redo */}
      <button
        title="Undo (Ctrl+Z)"
        disabled={!historyStore.canUndo}
        onClick={() => historyStore.undo()}
        className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#3a3a3a] text-[#888] hover:text-[#ccc] hover:border-[#555] disabled:opacity-30 disabled:cursor-not-allowed"
      >
        UNDO
      </button>
      <button
        title="Redo (Ctrl+Y)"
        disabled={!historyStore.canRedo}
        onClick={() => historyStore.redo()}
        className="px-2 py-0.5 text-[10px] font-mono rounded border border-[#3a3a3a] text-[#888] hover:text-[#ccc] hover:border-[#555] disabled:opacity-30 disabled:cursor-not-allowed"
      >
        REDO
      </button>

      {/* Error display */}
      {store.error && (
        <span className="text-red-400 text-[10px] font-mono ml-2 max-w-xs truncate" title={store.error}>
          ERR: {store.error}
        </span>
      )}
    </div>
  )
}
