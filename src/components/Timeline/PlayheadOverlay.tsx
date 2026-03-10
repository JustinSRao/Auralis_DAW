import { useEffect, useRef } from 'react'
import type { TimelineViewport } from '../../stores/arrangementStore'
import { barToX } from './timelineCoords'

interface PlayheadOverlayProps {
  width: number
  height: number
  /** Ref holding current playhead bar position. Updated by transport event, never triggers re-render. */
  playheadBarRef: React.RefObject<number>
  viewport: TimelineViewport
  /** Parent writes the draw function into this ref so it can trigger a redraw on transport events. */
  drawFnRef: React.MutableRefObject<() => void>
}

/**
 * Transparent canvas overlay that draws the playhead vertical line.
 *
 * Positioned absolutely on top of all other canvas layers. Updates at ~30–60 Hz
 * driven by the parent's transport event listener — never triggers React re-renders.
 */
export function PlayheadOverlay({
  width,
  height,
  playheadBarRef,
  viewport,
  drawFnRef,
}: PlayheadOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const x = barToX(playheadBarRef.current ?? 0, viewport)
      if (x < 0 || x > canvas.width) return

      ctx.save()
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
      ctx.restore()
    }

    drawFnRef.current = draw
    draw()
  }, [width, height, viewport, playheadBarRef, drawFnRef])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    />
  )
}
