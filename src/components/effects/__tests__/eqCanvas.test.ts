/**
 * Unit tests for eqCanvas coordinate helpers (Sprint 18).
 * No DOM required — pure math.
 */
import { describe, it, expect } from 'vitest';
import {
  freqToX,
  xToFreq,
  dbToY,
  yToDb,
  CANVAS_DB_MIN,
  CANVAS_DB_MAX,
  FREQ_MIN,
  FREQ_MAX,
} from '../eqCanvas';

const W = 600;
const H = 200;

describe('freqToX', () => {
  it('maps FREQ_MIN to x=0', () => {
    expect(freqToX(FREQ_MIN, W)).toBeCloseTo(0, 1);
  });

  it('maps FREQ_MAX to x=width', () => {
    expect(freqToX(FREQ_MAX, W)).toBeCloseTo(W, 1);
  });

  it('maps 1 kHz to roughly the middle of the log range', () => {
    // log10(1000/20) / log10(20000/20) ≈ 0.648
    const x = freqToX(1000, W);
    expect(x).toBeGreaterThan(W * 0.5);
    expect(x).toBeLessThan(W * 0.8);
  });

  it('clamps below FREQ_MIN to x=0', () => {
    expect(freqToX(1, W)).toBeCloseTo(0, 1);
  });

  it('clamps above FREQ_MAX to x=width', () => {
    expect(freqToX(999_999, W)).toBeCloseTo(W, 1);
  });
});

describe('xToFreq', () => {
  it('x=0 → FREQ_MIN', () => {
    expect(xToFreq(0, W)).toBeCloseTo(FREQ_MIN, 0);
  });

  it('x=width → FREQ_MAX', () => {
    expect(xToFreq(W, W)).toBeCloseTo(FREQ_MAX, 0);
  });

  it('round-trips with freqToX', () => {
    for (const freq of [50, 200, 1000, 5000, 15000]) {
      const roundTrip = xToFreq(freqToX(freq, W), W);
      expect(roundTrip).toBeCloseTo(freq, 0);
    }
  });
});

describe('dbToY', () => {
  it('maps CANVAS_DB_MAX to y=0 (top)', () => {
    expect(dbToY(CANVAS_DB_MAX, H)).toBeCloseTo(0, 1);
  });

  it('maps CANVAS_DB_MIN to y=height (bottom)', () => {
    expect(dbToY(CANVAS_DB_MIN, H)).toBeCloseTo(H, 1);
  });

  it('maps 0 dB to the vertical centre', () => {
    expect(dbToY(0, H)).toBeCloseTo(H / 2, 1);
  });
});

describe('yToDb', () => {
  it('y=0 → CANVAS_DB_MAX', () => {
    expect(yToDb(0, H)).toBeCloseTo(CANVAS_DB_MAX, 1);
  });

  it('y=height → CANVAS_DB_MIN', () => {
    expect(yToDb(H, H)).toBeCloseTo(CANVAS_DB_MIN, 1);
  });

  it('round-trips with dbToY', () => {
    for (const db of [-18, -6, 0, 6, 18]) {
      expect(yToDb(dbToY(db, H), H)).toBeCloseTo(db, 1);
    }
  });
});
