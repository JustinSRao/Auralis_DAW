import { useEffect, useRef } from 'react'
import type { TimelineViewport } from '../../stores/arrangementStore'
import { barToX, xToBar, snapToBar } from './timelineCoords'

export const RULER_HEIGHT = 32

interface TimeRulerProps {
  width: number
  viewport: TimelineViewport
  /** Loop region start in bars, or null if loop is disabled / unset. */
  loopStart: number | null
  /** Loop region end in bars, or null if loop is disabled / unset. */
  loopEnd: number | null
  /** Called when the user clicks or shift-drags on the ruler. */
  onRulerPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void
}

/**
 * Horizontal bar/beat ruler drawn on a canvas.
 *
 * Draws:
 * - Bar number labels at each visible bar
 * - Minor beat ticks when zoom is high enough
 * - Semi-transparent blue fill over the loop region
 */
export function TimeRuler({
  width,
  viewport,
  loopStart,
  loopEnd,
  onRulerPointerDown,
}: TimeRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
        const beatsPerBar = 4
        for (let beat = 1; beat < beatsPerBar; beat++) {
          const beatX = x + (beat / beatsPerBar) * viewport.pixelsPerBar
          ctx.strokeStyle = '#333333'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(beatX, RULER_HEIGHT - 6)
          ctx.lineTo(beatX, RULER_HEIGHT - 1)
          ctx.stroke()
        }
      }
    }
  }, [width, viewport, loopStart, loopEnd])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={RULER_HEIGHT}
      style={{ display: 'block', cursor: 'pointer' }}
      onPointerDown={onRulerPointerDown}
    />
  )
}
