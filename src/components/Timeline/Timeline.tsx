import { useEffect, useRef, useState, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { TransportSnapshot } from '../../lib/ipc'
import { useArrangementStore } from '../../stores/arrangementStore'
import type { ArrangementClip } from '../../stores/arrangementStore'
import { useTrackStore } from '../../stores/trackStore'
import { usePatternStore } from '../../stores/patternStore'
import { TimeRuler, RULER_HEIGHT } from './TimeRuler'
import { PlayheadOverlay } from './PlayheadOverlay'
import {
  barToX,
  xToBar,
  snapToBar,
  trackIndexToY,
  yToTrackIndex,
  clipHitTest,
  samplesToBar,
} from './timelineCoords'

// ---------------------------------------------------------------------------
// Interaction state machine (stored in a ref — no re-renders during drag)
// ---------------------------------------------------------------------------

type InteractionState =
  | { kind: 'idle' }
  | {
      kind: 'movingClip'
      clipId: string
      snapshot: ArrangementClip
      pointerStartX: number
      pointerStartY: number
    }
  | {
      kind: 'resizingClip'
      clipId: string
      snapshot: ArrangementClip
      pointerStartX: number
    }
  | {
      kind: 'loopDrag'
      anchorBar: number
    }

// ---------------------------------------------------------------------------
// Context menu state
// ---------------------------------------------------------------------------

interface ContextMenu {
  clipId: string
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// Clip color by patternId
// ---------------------------------------------------------------------------

function clipColor(patternId: string, selected: boolean): string {
  const hue = (patternId.charCodeAt(0) * 47 + patternId.charCodeAt(1 % patternId.length) * 13) % 360
  const saturation = selected ? 70 : 55
  const lightness = selected ? 45 : 35
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Song timeline (arrangement view): shows all tracks horizontally across time
 * with pattern clip blocks that can be dragged, resized, and deleted.
 */
export function Timeline() {
  const clips = useArrangementStore((s) => s.clips)
  const viewport = useArrangementStore((s) => s.viewport)
  const selectedClipId = useArrangementStore((s) => s.selectedClipId)
  const { addClip, moveClip, resizeClip, deleteClip, duplicateClip,
          updateClipOptimistic, revertClipOptimistic, setViewport, selectClip } =
    useArrangementStore.getState()

  const tracks = useTrackStore((s) => s.tracks)

  // Canvas dimensions from ResizeObserver
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 400 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Canvas refs
  const clipsCanvasRef = useRef<HTMLCanvasElement>(null)

  // Interaction state (never triggers re-renders during drag)
  const interactionRef = useRef<InteractionState>({ kind: 'idle' })

  // Playhead bar position (updated by transport event — never causes re-render)
  const playheadBarRef = useRef<number>(0)
  const drawPlayheadRef = useRef<() => void>(() => undefined)

  // Loop region from transport (bars)
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)

  // ---------------------------------------------------------------------------
  // ResizeObserver
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setCanvasSize({ width: Math.max(1, width), height: Math.max(1, height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ---------------------------------------------------------------------------
  // Transport event subscription → playhead
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    let unlistenFn: (() => void) | undefined

    void listen<TransportSnapshot>('transport-state', (ev) => {
      if (cancelled) return
      const snap = ev.payload
      const timeSig = snap.time_sig_numerator > 0 ? snap.time_sig_numerator : 4
      playheadBarRef.current = samplesToBar(snap.position_samples, snap.bpm, timeSig, 44100)

      // Update loop region bars (convert from samples)
      if (snap.loop_enabled) {
        setLoopStart(samplesToBar(snap.loop_start_samples, snap.bpm, timeSig, 44100))
        setLoopEnd(samplesToBar(snap.loop_end_samples, snap.bpm, timeSig, 44100))
      } else {
        setLoopStart(null)
        setLoopEnd(null)
      }

      drawPlayheadRef.current()
    }).then((fn) => {
      unlistenFn = fn
      if (cancelled) fn()
    })

    return () => {
      cancelled = true
      unlistenFn?.()
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Draw clips canvas
  // ---------------------------------------------------------------------------

  const drawClips = useCallback(() => {
    const canvas = clipsCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvasSize
    ctx.clearRect(0, 0, width, height)

    // Background
    ctx.fillStyle = '#1e1e1e'
    ctx.fillRect(0, 0, width, height)

    // Track row backgrounds + grid lines
    tracks.forEach((_, idx) => {
      const y = trackIndexToY(idx, viewport)
      if (y > height) return

      ctx.fillStyle = idx % 2 === 0 ? '#222222' : '#1e1e1e'
      ctx.fillRect(0, y, width, viewport.trackHeight)

      ctx.strokeStyle = '#2a2a2a'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, y + viewport.trackHeight - 1)
      ctx.lineTo(width, y + viewport.trackHeight - 1)
      ctx.stroke()
    })

    // Vertical bar grid lines
    const firstBar = snapToBar(xToBar(0, viewport))
    const lastBar = Math.ceil(xToBar(width, viewport)) + 1
    ctx.strokeStyle = '#2e2e2e'
    ctx.lineWidth = 1
    for (let bar = Math.max(0, firstBar); bar <= lastBar; bar++) {
      const x = barToX(bar, viewport)
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    // Clips
    const clipList = Object.values(clips)
    for (const clip of clipList) {
      const trackIdx = tracks.findIndex((t) => t.id === clip.trackId)
      if (trackIdx === -1) continue

      const x = barToX(clip.startBar, viewport)
      const w = clip.lengthBars * viewport.pixelsPerBar
      const y = trackIndexToY(trackIdx, viewport)
      const h = viewport.trackHeight - 2
      const isSelected = clip.id === selectedClipId

      // Skip off-screen clips
      if (x + w < 0 || x > width) continue

      // Clip body
      ctx.fillStyle = clipColor(clip.patternId, isSelected)
      ctx.beginPath()
      ctx.roundRect(x, y + 1, Math.max(2, w), h, 3)
      ctx.fill()

      // Selection border
      if (isSelected) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(x, y + 1, Math.max(2, w), h, 3)
        ctx.stroke()
      }

      // Resize handle (right edge, slightly lighter)
      if (w > 16) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)'
        ctx.fillRect(x + w - 8, y + 1, 8, h)
      }

      // Pattern name label
      if (w > 30) {
        const pattern = usePatternStore.getState().patterns[clip.patternId]
        const label = pattern?.name ?? clip.patternId.slice(0, 8)
        ctx.save()
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.font = '11px monospace'
        ctx.textBaseline = 'middle'
        ctx.rect(x + 4, y + 1, w - 12, h)
        ctx.clip()
        ctx.fillText(label, x + 4, y + h / 2 + 1)
        ctx.restore()
      }
    }
  }, [clips, viewport, selectedClipId, tracks, canvasSize])

  // Redraw clips when deps change
  useEffect(() => {
    drawClips()
  }, [drawClips])

  // ---------------------------------------------------------------------------
  // Pointer events on clips canvas
  // ---------------------------------------------------------------------------

  function handleClipsPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Shift+click in ruler area → handled by TimeRuler
    e.currentTarget.setPointerCapture(e.pointerId)

    // Hit test all clips
    const clipList = Object.values(clips)
    let hit: { clip: ArrangementClip; result: 'resize' | 'move'; trackIdx: number } | null = null

    for (const clip of clipList) {
      const trackIdx = tracks.findIndex((t) => t.id === clip.trackId)
      if (trackIdx === -1) continue
      const result = clipHitTest(clip, trackIdx, x, y, viewport)
      if (result) {
        hit = { clip, result, trackIdx }
        break
      }
    }

    if (!hit) {
      selectClip(null)
      setContextMenu(null)
      return
    }

    selectClip(hit.clip.id)
    setContextMenu(null)

    if (hit.result === 'resize') {
      interactionRef.current = {
        kind: 'resizingClip',
        clipId: hit.clip.id,
        snapshot: { ...hit.clip },
        pointerStartX: x,
      }
    } else {
      interactionRef.current = {
        kind: 'movingClip',
        clipId: hit.clip.id,
        snapshot: { ...hit.clip },
        pointerStartX: x,
        pointerStartY: y,
      }
    }
  }

  function handleClipsPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const state = interactionRef.current
    if (state.kind === 'idle') return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (state.kind === 'movingClip') {
      const dxBars = (x - state.pointerStartX) / viewport.pixelsPerBar
      const newStartBar = snapToBar(Math.max(0, state.snapshot.startBar + dxBars))

      const dyTracks = Math.round((y - state.pointerStartY) / viewport.trackHeight)
      const origTrackIdx = tracks.findIndex((t) => t.id === state.snapshot.trackId)
      const newTrackIdx = Math.max(0, Math.min(tracks.length - 1, origTrackIdx + dyTracks))
      const newTrackId = tracks[newTrackIdx]?.id ?? state.snapshot.trackId

      updateClipOptimistic(state.clipId, { startBar: newStartBar, trackId: newTrackId })
      drawClips()

    } else if (state.kind === 'resizingClip') {
      const dxBars = (x - state.pointerStartX) / viewport.pixelsPerBar
      const newLength = Math.max(1, snapToBar(state.snapshot.lengthBars + dxBars) || 1)
      updateClipOptimistic(state.clipId, { lengthBars: newLength })
      drawClips()
    }
  }

  function handleClipsPointerUp(_e: React.PointerEvent<HTMLCanvasElement>) {
    const state = interactionRef.current
    interactionRef.current = { kind: 'idle' }

    if (state.kind === 'movingClip') {
      const clip = clips[state.clipId]
      if (!clip) return
      if (clip.startBar !== state.snapshot.startBar || clip.trackId !== state.snapshot.trackId) {
        void moveClip(state.clipId, clip.trackId, clip.startBar).catch(() => {
          revertClipOptimistic(state.clipId, state.snapshot)
          drawClips()
        })
      }
    } else if (state.kind === 'resizingClip') {
      const clip = clips[state.clipId]
      if (!clip) return
      if (clip.lengthBars !== state.snapshot.lengthBars) {
        void resizeClip(state.clipId, clip.lengthBars).catch(() => {
          revertClipOptimistic(state.clipId, state.snapshot)
          drawClips()
        })
      }
    }
  }

  function handleClipsContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    for (const clip of Object.values(clips)) {
      const trackIdx = tracks.findIndex((t) => t.id === clip.trackId)
      if (trackIdx === -1) continue
      const result = clipHitTest(clip, trackIdx, x, y, viewport)
      if (result) {
        selectClip(clip.id)
        setContextMenu({ clipId: clip.id, x: e.clientX, y: e.clientY })
        return
      }
    }
    setContextMenu(null)
  }

  // ---------------------------------------------------------------------------
  // Ruler pointer events
  // ---------------------------------------------------------------------------

  function handleRulerPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left

    if (e.shiftKey) {
      // Start loop drag
      const bar = snapToBar(xToBar(x, viewport))
      interactionRef.current = { kind: 'loopDrag', anchorBar: bar }
      setLoopStart(bar)
      setLoopEnd(bar + 1)
      e.currentTarget.setPointerCapture(e.pointerId)
    } else {
      // Jump playhead to bar
      const bar = xToBar(x, viewport)
      playheadBarRef.current = bar
      drawPlayheadRef.current()
    }
  }

  // ---------------------------------------------------------------------------
  // Drop handler (patterns from PatternBrowser)
  // ---------------------------------------------------------------------------

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes('application/pattern-id')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const patternId = e.dataTransfer.getData('application/pattern-id')
    if (!patternId) return

    const pattern = usePatternStore.getState().patterns[patternId]
    if (!pattern) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Subtract ruler height from y since clips start below it
    const clipsY = y - RULER_HEIGHT
    const startBar = snapToBar(xToBar(x, viewport))
    const trackIdx = yToTrackIndex(Math.max(0, clipsY), viewport)
    const targetTrack = tracks[trackIdx] ?? tracks[0]
    if (!targetTrack) return

    void addClip(patternId, targetTrack.id, startBar, pattern.lengthBars)
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedClipId) {
        void deleteClip(selectedClipId)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Scroll
  // ---------------------------------------------------------------------------

  function handleWheel(ev: React.WheelEvent<HTMLDivElement>) {
    ev.preventDefault()
    const newScroll = Math.max(0, viewport.scrollLeft + ev.deltaX)
    setViewport({ scrollLeft: newScroll })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const clipsHeight = canvasSize.height - RULER_HEIGHT

  return (
    <div
      ref={containerRef}
      className="flex flex-col flex-1 relative overflow-hidden bg-[#1e1e1e] outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => setContextMenu(null)}
      data-testid="timeline"
    >
      {/* Ruler */}
      <TimeRuler
        width={canvasSize.width}
        viewport={viewport}
        loopStart={loopStart}
        loopEnd={loopEnd}
        onRulerPointerDown={handleRulerPointerDown}
      />

      {/* Clips canvas area */}
      <div className="relative flex-1 overflow-hidden">
        <canvas
          ref={clipsCanvasRef}
          width={canvasSize.width}
          height={clipsHeight}
          style={{ display: 'block', cursor: 'crosshair' }}
          onPointerDown={handleClipsPointerDown}
          onPointerMove={handleClipsPointerMove}
          onPointerUp={handleClipsPointerUp}
          onContextMenu={handleClipsContextMenu}
          data-testid="timeline-clips-canvas"
        />

        {/* Playhead overlay — absolutely positioned, pointer-events none */}
        <PlayheadOverlay
          width={canvasSize.width}
          height={clipsHeight}
          playheadBarRef={playheadBarRef}
          viewport={viewport}
          drawFnRef={drawPlayheadRef}
        />
      </div>

      {/* Zoom control */}
      <div className="flex items-center gap-2 px-3 py-1 bg-[#1a1a1a] border-t border-[#3a3a3a] flex-shrink-0">
        <span className="text-[#555555] text-[10px] font-mono">ZOOM</span>
        <input
          type="range"
          min={20}
          max={400}
          step={5}
          value={viewport.pixelsPerBar}
          onChange={(e) => setViewport({ pixelsPerBar: Number(e.target.value) })}
          className="w-28 h-1 accent-[#5b8def]"
          aria-label="Timeline zoom"
        />
        <span className="text-[#555555] text-[10px] font-mono w-12">
          {viewport.pixelsPerBar}px/bar
        </span>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#2a2a2a] border border-[#444] rounded shadow-lg py-1 text-xs font-mono text-[#cccccc]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="block w-full px-4 py-1.5 text-left hover:bg-[#3a3a3a]"
            onClick={() => {
              const clip = clips[contextMenu.clipId]
              if (clip) {
                void duplicateClip(
                  contextMenu.clipId,
                  clip.startBar + clip.lengthBars,
                  clip.patternId,
                  clip.trackId,
                  clip.lengthBars,
                )
              }
              setContextMenu(null)
            }}
          >
            Duplicate
          </button>
          <button
            className="block w-full px-4 py-1.5 text-left hover:bg-[#3a3a3a] text-red-400"
            onClick={() => {
              void deleteClip(contextMenu.clipId)
              setContextMenu(null)
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
