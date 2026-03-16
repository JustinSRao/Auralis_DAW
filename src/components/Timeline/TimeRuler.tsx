import { useEffect, useRef } from 'react'
import type { TimelineViewport } from '../../stores/arrangementStore'
import { barToX, xToBar, snapToBar, samplesToBar } from './timelineCoords'

export const RULER_HEIGHT = 32

interface TimeRulerProps {
  width: number
  viewport: TimelineViewport
  /** Loop region start in bars, or null if loop is disabled / unset. */
  loopStart: number | null
  /** Loop region end in bars, or null if loop is disabled / unset. */
  loopEnd: number | null
  /** Called when the user clicks or shift-drags on the ruler (non-Ctrl). */
  onRulerPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void
  /** Called when the user Ctrl+clicks/drags to set punch-in position (beats). */
  onPunchInSet?: (beats: number) => void
  /** Called when the user Ctrl+Alt+clicks/drags to set punch-out position (beats). */
  onPunchOutSet?: (beats: number) => void
  /** Whether punch mode is active. */
  punchEnabled?: boolean
  /** Punch-in position in samples, or null when not set. */
  punchInSamples?: number | null
  /** Punch-out position in samples, or null when not set. */
  punchOutSamples?: number | null
  /** Current BPM — used to convert samples to bar position for drawing. */
  bpm?: number
  /** Beats per bar — used to convert samples to bar position. */
  beatsPerBar?: number
}

// Hardcoded sample rate (matches Timeline.tsx tech debt note)
const SAMPLE_RATE = 44100

/**
 * Horizontal bar/beat ruler drawn on a canvas.
 *
 * Draws:
 * - Bar number labels at each visible bar
 * - Minor beat ticks when zoom is high enough
 * - Semi-transparent blue fill over the loop region
 * - Amber fill + green/red flags over the punch region (when punch mode active)
 *
 * Interaction:
 * - Click / Shift+drag → forwarded to `onRulerPointerDown` (playhead / loop)
 * - Ctrl+click → sets punch-in at that beat position
 * - Ctrl+Alt+click → sets punch-out at that beat position
 */
export function TimeRuler({
  width,
  viewport,
  loopStart,
  loopEnd,
  onRulerPointerDown,
  onPunchInSet,
  onPunchOutSet,
  punchEnabled = false,
  punchInSamples = null,
  punchOutSamples = null,
  bpm = 120,
  beatsPerBar = 4,
}: TimeRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Track whether a punch drag is in progress (Ctrl drag)
  const punchDragRef = useRef<'in' | 'out' | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Background
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Bottom border
    ctx.strokeStyle = '#3a3a3a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, RULER_HEIGHT - 1)
    ctx.lineTo(canvas.width, RULER_HEIGHT - 1)
    ctx.stroke()

    // Loop region fill
    if (loopStart !== null && loopEnd !== null && loopEnd > loopStart) {
      const lx = barToX(loopStart, viewport)
      const lw = barToX(loopEnd, viewport) - lx
      ctx.save()
      ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'
      ctx.fillRect(lx, 0, lw, RULER_HEIGHT - 1)
      ctx.restore()
    }

    // Punch region fill (amber) — only when both markers are set and punch is enabled
    if (
      punchEnabled &&
      punchInSamples !== null &&
      punchOutSamples !== null &&
      punchOutSamples > punchInSamples
    ) {
      const punchInBar = samplesToBar(punchInSamples, bpm, beatsPerBar, SAMPLE_RATE)
      const punchOutBar = samplesToBar(punchOutSamples, bpm, beatsPerBar, SAMPLE_RATE)
      const px = barToX(punchInBar, viewport)
      const pw = barToX(punchOutBar, viewport) - px
      ctx.save()
      ctx.fillStyle = 'rgba(251, 146, 60, 0.20)'
      ctx.fillRect(px, 0, pw, RULER_HEIGHT - 1)
      ctx.restore()
    }

    // Determine which bars are visible
    const firstBar = snapToBar(xToBar(0, viewport))
    const lastBar = Math.ceil(xToBar(canvas.width, viewport)) + 1

    ctx.fillStyle = '#888888'
    ctx.font = '10px monospace'
    ctx.textBaseline = 'middle'

    for (let bar = Math.max(0, firstBar); bar <= lastBar; bar++) {
      const x = barToX(bar, viewport)

      // Major bar tick
      ctx.strokeStyle = '#4a4a4a'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, RULER_HEIGHT - 12)
      ctx.lineTo(x, RULER_HEIGHT - 1)
      ctx.stroke()

      // Bar number label — skip bar 0 label (project starts at bar 1 for display)
      const label = String(bar + 1)
      ctx.fillStyle = '#888888'
      ctx.fillText(label, x + 3, RULER_HEIGHT / 2)

      // Beat subdivisions when zoomed in enough
      if (viewport.pixelsPerBar >= 60) {
        const beatsPerBarLocal = 4
        for (let beat = 1; beat < beatsPerBarLocal; beat++) {
          const beatX = x + (beat / beatsPerBarLocal) * viewport.pixelsPerBar
          ctx.strokeStyle = '#333333'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(beatX, RULER_HEIGHT - 6)
          ctx.lineTo(beatX, RULER_HEIGHT - 1)
          ctx.stroke()
        }
      }
    }

    // Punch-in flag (green downward triangle + "IN" label) — only when punch mode enabled
    if (punchEnabled && punchInSamples !== null) {
      const punchInBar = samplesToBar(punchInSamples, bpm, beatsPerBar, SAMPLE_RATE)
      const fx = barToX(punchInBar, viewport)
      ctx.save()
      ctx.fillStyle = 'rgb(34, 197, 94)'
      ctx.beginPath()
      ctx.moveTo(fx - 5, 2)
      ctx.lineTo(fx + 5, 2)
      ctx.lineTo(fx, 12)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgb(34, 197, 94)'
      ctx.font = '8px monospace'
      ctx.textBaseline = 'top'
      ctx.fillText('IN', fx + 6, 2)
      ctx.restore()
    }

    // Punch-out flag (red downward triangle + "OUT" label) — only when punch mode enabled
    if (punchEnabled && punchOutSamples !== null) {
      const punchOutBar = samplesToBar(punchOutSamples, bpm, beatsPerBar, SAMPLE_RATE)
      const fx = barToX(punchOutBar, viewport)
      ctx.save()
      ctx.fillStyle = 'rgb(239, 68, 68)'
      ctx.beginPath()
      ctx.moveTo(fx - 5, 2)
      ctx.lineTo(fx + 5, 2)
      ctx.lineTo(fx, 12)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgb(239, 68, 68)'
      ctx.font = '8px monospace'
      ctx.textBaseline = 'top'
      ctx.fillText('OUT', fx + 6, 2)
      ctx.restore()
    }
  }, [
    width,
    viewport,
    loopStart,
    loopEnd,
    punchEnabled,
    punchInSamples,
    punchOutSamples,
    bpm,
    beatsPerBar,
  ])

  // ---------------------------------------------------------------------------
  // Pointer handlers
  // ---------------------------------------------------------------------------

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.ctrlKey) {
      // Ctrl+drag → set punch markers
      e.currentTarget.setPointerCapture(e.pointerId)
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      // Convert X to beats: bar * beatsPerBar
      const bar = xToBar(x, viewport)
      const beats = bar * beatsPerBar

      if (e.altKey) {
        punchDragRef.current = 'out'
        onPunchOutSet?.(beats)
      } else {
        punchDragRef.current = 'in'
        onPunchInSet?.(beats)
      }
      // Do not forward to parent handler
      return
    }

    punchDragRef.current = null
    onRulerPointerDown(e)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const dragKind = punchDragRef.current
    if (!dragKind) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const bar = xToBar(x, viewport)
    const beats = bar * beatsPerBar

    if (dragKind === 'in') {
      onPunchInSet?.(beats)
    } else {
      onPunchOutSet?.(beats)
    }
  }

  function handlePointerUp() {
    punchDragRef.current = null
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={RULER_HEIGHT}
      style={{ display: 'block', cursor: 'pointer' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  )
}
