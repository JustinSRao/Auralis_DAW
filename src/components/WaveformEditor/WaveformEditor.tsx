/**
 * Full-screen Waveform Editor modal (Sprint 15).
 *
 * Renders when `waveformEditorStore.isOpen` is true. Displays both channels
 * of an audio clip as min/max peak waveforms on a single canvas, with an
 * interactive selection region, cursor line, and trim handles.
 *
 * Double-clicking an audio clip in the Timeline opens this editor.
 */

import {
  useEffect,
  useRef,
  useCallback,
  useState,
} from 'react'
import { useWaveformEditorStore } from '../../stores/waveformEditorStore'
import { useHistoryStore } from '../../stores/historyStore'
import { WaveformToolbar } from './WaveformToolbar'

// ---------------------------------------------------------------------------
// Drawing constants
// ---------------------------------------------------------------------------

const WAVEFORM_COLOR_L = '#5b8def'
const WAVEFORM_COLOR_R = '#56cc88'
const SELECTION_COLOR = 'rgba(91, 141, 239, 0.25)'
const CURSOR_COLOR = '#ffffff'
const GRID_COLOR = '#2a2a2a'
const BACKGROUND_COLOR = '#1a1a1a'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WaveformEditor() {
  const store = useWaveformEditorStore()
  const historyStore = useHistoryStore()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawFnRef = useRef<() => void>(() => undefined)
  const containerRef = useRef<HTMLDivElement>(null)

  // Interaction state (no re-renders during drag)
  type DragState =
    | { kind: 'idle' }
    | { kind: 'selecting'; startFrame: number }
  const dragRef = useRef<DragState>({ kind: 'idle' })

  // Canvas size from ResizeObserver
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 400 })

  // ---------------------------------------------------------------------------
  // ResizeObserver — update canvasWidth in store
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const w = Math.max(1, width)
      const h = Math.max(1, height)
      setCanvasSize({ width: w, height: h })
      store.setViewport({ canvasWidth: w })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [store])

  // ---------------------------------------------------------------------------
  // Coordinate helpers
  // ---------------------------------------------------------------------------

  function frameToX(frame: number): number {
    const { scrollFrames, framesPerPixel } = store.viewport
    return (frame - scrollFrames) / framesPerPixel
  }

  function xToFrame(x: number): number {
    const { scrollFrames, framesPerPixel } = store.viewport
    return Math.round(x * framesPerPixel + scrollFrames)
  }

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvasSize
    const { peakData, selection, cursorFrame, viewport } = store
    const { scrollFrames, framesPerPixel } = viewport

    ctx.clearRect(0, 0, width, height)

    // Background
    ctx.fillStyle = BACKGROUND_COLOR
    ctx.fillRect(0, 0, width, height)

    // Vertical time grid (every ~50px)
    const gridEveryFrames = Math.max(1, Math.round((50 * framesPerPixel) / 1))
    const gridEveryPx = gridEveryFrames / framesPerPixel
    const firstGridX = Math.ceil(scrollFrames / gridEveryFrames) * gridEveryFrames
    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = 1
    for (
      let frame = firstGridX;
      (frame - scrollFrames) / framesPerPixel < width;
      frame += gridEveryFrames
    ) {
      const x = (frame - scrollFrames) / framesPerPixel
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    void gridEveryPx // prevent lint unused warning

    // Channel split
    const channelHeight = height / 2

    // Draw waveform channel
    function drawChannel(
      peaks: Array<{ min: number; max: number }>,
      yTop: number,
      color: string,
    ) {
      if (!peaks.length) return
      ctx.fillStyle = color
      const midY = yTop + channelHeight / 2
      const halfH = channelHeight / 2 - 2

      for (let px = 0; px < width; px++) {
        const frame = Math.floor(px * framesPerPixel + scrollFrames)
        const peakIdx = Math.floor(frame / framesPerPixel)
        if (peakIdx < 0 || peakIdx >= peaks.length) continue
        const peak = peaks[peakIdx]
        const minY = midY - peak.max * halfH
        const maxY = midY - peak.min * halfH
        const h = Math.max(1, maxY - minY)
        ctx.fillRect(px, minY, 1, h)
      }

      // Center line
      ctx.strokeStyle = `${color}44`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(width, midY)
      ctx.stroke()
    }

    if (peakData) {
      // Channel label backgrounds
      ctx.fillStyle = '#11111180'
      ctx.fillRect(0, 0, width, channelHeight)
      ctx.fillRect(0, channelHeight, width, channelHeight)

      drawChannel(peakData.left, 0, WAVEFORM_COLOR_L)
      drawChannel(peakData.right, channelHeight, WAVEFORM_COLOR_R)
    } else {
      // Loading placeholder
      ctx.fillStyle = '#333'
      ctx.font = '12px monospace'
      ctx.fillText(store.peakLoading ? 'Loading waveform...' : 'No peak data', 16, height / 2)
    }

    // Selection highlight
    if (selection) {
      const selX1 = frameToX(selection.startFrame)
      const selX2 = frameToX(selection.endFrame)
      const selW = selX2 - selX1
      if (Math.abs(selW) > 0.5) {
        ctx.fillStyle = SELECTION_COLOR
        ctx.fillRect(Math.min(selX1, selX2), 0, Math.abs(selW), height)
        // Selection edge lines
        ctx.strokeStyle = '#5b8def88'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(selX1, 0)
        ctx.lineTo(selX1, height)
        ctx.moveTo(selX2, 0)
        ctx.lineTo(selX2, height)
        ctx.stroke()
      }
    }

    // Cursor line
    if (cursorFrame !== null) {
      const cx = frameToX(cursorFrame)
      ctx.strokeStyle = CURSOR_COLOR
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx, 0)
      ctx.lineTo(cx, height)
      ctx.stroke()
    }

    // Channel divider
    ctx.strokeStyle = '#3a3a3a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, channelHeight)
    ctx.lineTo(width, channelHeight)
    ctx.stroke()

    // Channel labels
    ctx.fillStyle = '#ffffff40'
    ctx.font = '10px monospace'
    ctx.fillText('L', 4, 12)
    ctx.fillText('R', 4, channelHeight + 12)
  }, [canvasSize, store])

  // Store draw function in ref for access from non-React callbacks
  useEffect(() => {
    drawFnRef.current = draw
  }, [draw])

  // Redraw when relevant state changes
  useEffect(() => {
    draw()
  }, [draw])

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!store.isOpen) return
      if (e.key === 'Escape') {
        store.close()
      } else if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        historyStore.undo()
      } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault()
        historyStore.redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [store, historyStore])

  // ---------------------------------------------------------------------------
  // Pointer events
  // ---------------------------------------------------------------------------

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const frame = xToFrame(x)

    if (store.tool === 'select') {
      dragRef.current = { kind: 'selecting', startFrame: frame }
      store.setCursor(frame)
      store.setSelection(null)
    } else {
      // trim-start / trim-end: just place cursor
      store.setCursor(frame)
    }

    drawFnRef.current()
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (drag.kind !== 'selecting') return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const frame = xToFrame(x)

    const startFrame = Math.min(drag.startFrame, frame)
    const endFrame = Math.max(drag.startFrame, frame)

    store.setSelection({ startFrame, endFrame })
    store.setCursor(frame)
    drawFnRef.current()
  }

  function handlePointerUp(_e: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = { kind: 'idle' }
  }

  // ---------------------------------------------------------------------------
  // Scroll (horizontal)
  // ---------------------------------------------------------------------------

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY
    const newScroll = Math.max(0, store.viewport.scrollFrames + delta * store.viewport.framesPerPixel)
    store.setViewport({ scrollFrames: newScroll })
    drawFnRef.current()
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!store.isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#1a1a1a]"
      data-testid="waveform-editor"
      onKeyDown={(e) => {
        // Prevent keypresses from bubbling to DAW shortcuts while editor is open
        e.stopPropagation()
      }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[#111] border-b border-[#3a3a3a] flex-shrink-0">
        <span className="text-[#5b8def] text-xs font-mono uppercase tracking-widest">
          Waveform Editor
        </span>
        {store.activeClipId && (
          <span className="text-[#666] text-[10px] font-mono">
            {store.filePath?.split('/').pop() ?? store.filePath?.split('\\').pop() ?? ''}
          </span>
        )}
        {store.totalFrames > 0 && store.sampleRate > 0 && (
          <span className="text-[#444] text-[10px] font-mono">
            {(store.totalFrames / store.sampleRate).toFixed(2)}s
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => store.close()}
          className="text-[#666] hover:text-[#ccc] text-xs font-mono px-2 py-0.5 border border-[#3a3a3a] rounded hover:border-[#666]"
          title="Close (Esc)"
        >
          CLOSE
        </button>
      </div>

      {/* Toolbar */}
      <WaveformToolbar />

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          style={{ display: 'block', cursor: store.tool === 'select' ? 'crosshair' : 'ew-resize' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          data-testid="waveform-canvas"
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-1 bg-[#111] border-t border-[#3a3a3a] flex-shrink-0">
        {store.cursorFrame !== null && store.sampleRate > 0 && (
          <span className="text-[#555] text-[10px] font-mono">
            Cursor: {store.cursorFrame} frames
            ({(store.cursorFrame / store.sampleRate).toFixed(4)}s)
          </span>
        )}
        {store.selection && store.sampleRate > 0 && (
          <span className="text-[#5b8def] text-[10px] font-mono">
            Selection: {store.selection.startFrame}–{store.selection.endFrame}
            ({((store.selection.endFrame - store.selection.startFrame) / store.sampleRate).toFixed(4)}s)
          </span>
        )}
        {store.peakLoading && (
          <span className="text-[#888] text-[10px] font-mono">Loading peaks...</span>
        )}
      </div>
    </div>
  )
}
