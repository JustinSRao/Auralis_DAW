/**
 * Pure helpers for the EQ frequency-response canvas.
 *
 * All coordinate math lives here so it can be unit-tested without a DOM.
 */

export const CANVAS_DB_MIN = -18;
export const CANVAS_DB_MAX = 18;
export const FREQ_MIN = 20;
export const FREQ_MAX = 20_000;

/** Maps a frequency (Hz) to a canvas x coordinate [0, width]. */
export function freqToX(freq: number, width: number): number {
  const logMin = Math.log10(FREQ_MIN);
  const logMax = Math.log10(FREQ_MAX);
  return ((Math.log10(Math.max(FREQ_MIN, Math.min(FREQ_MAX, freq))) - logMin) /
    (logMax - logMin)) *
    width;
}

/** Maps a canvas x coordinate to a frequency (Hz). */
export function xToFreq(x: number, width: number): number {
  const logMin = Math.log10(FREQ_MIN);
  const logMax = Math.log10(FREQ_MAX);
  const t = Math.max(0, Math.min(1, x / width));
  return Math.pow(10, logMin + t * (logMax - logMin));
}

/** Maps a gain_db value to a canvas y coordinate [0, height]. */
export function dbToY(db: number, height: number): number {
  const t = 1 - (db - CANVAS_DB_MIN) / (CANVAS_DB_MAX - CANVAS_DB_MIN);
  return t * height;
}

/** Maps a canvas y coordinate to a gain_db value. */
export function yToDb(y: number, height: number): number {
  const t = y / height;
  return CANVAS_DB_MIN + (1 - t) * (CANVAS_DB_MAX - CANVAS_DB_MIN);
}

/** Per-band accent colours (index 0–7). */
export const BAND_COLORS = [
  '#22d3ee', // 0 HP  — cyan
  '#4ade80', // 1 LS  — green
  '#facc15', // 2 PK  — yellow
  '#fb923c', // 3 PK  — orange
  '#f87171', // 4 PK  — red
  '#e879f9', // 5 PK  — fuchsia
  '#a78bfa', // 6 HS  — violet
  '#60a5fa', // 7 LP  — blue
] as const;

export interface DrawPoint {
  freq: number;
  db: number;
}

/**
 * Draws the combined EQ response curve onto a 2D canvas context.
 *
 * @param ctx    Canvas 2D context
 * @param points Array of {freq, db} from the backend or computed locally
 * @param width  Canvas pixel width
 * @param height Canvas pixel height
 */
export function drawResponseCurve(
  ctx: CanvasRenderingContext2D,
  points: DrawPoint[],
  width: number,
  height: number,
): void {
  if (points.length === 0) return;

  ctx.beginPath();
  ctx.strokeStyle = '#93c5fd'; // blue-300
  ctx.lineWidth = 1.5;

  for (let i = 0; i < points.length; i++) {
    const x = freqToX(points[i].freq, width);
    const y = dbToY(points[i].db, height);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Draws the canvas background: fill + grid lines.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  // Background
  ctx.fillStyle = '#111827'; // gray-900
  ctx.fillRect(0, 0, width, height);

  ctx.lineWidth = 0.5;

  // Horizontal dB grid lines
  for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
    const y = dbToY(db, height);
    ctx.strokeStyle = db === 0 ? '#374151' : '#1f2937'; // slightly brighter at 0 dB
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Vertical frequency grid lines
  for (const freq of [100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = freqToX(freq, width);
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}
