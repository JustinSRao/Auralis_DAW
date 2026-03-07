/**
 * Pure function tests for pianoRollUtils.ts.
 *
 * No React, no mocks, no DOM — these are deterministic math functions.
 */

import { describe, it, expect } from 'vitest';
import {
  beatToX,
  xToBeat,
  pitchToY,
  yToPitch,
  snapBeat,
  getVisibleNotes,
  noteHitTest,
  isBlackKey,
  pitchToName,
} from '../pianoRollUtils';
import type { MidiNote, Viewport } from '../pianoRollTypes';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeVp(overrides: Partial<Viewport> = {}): Viewport {
  return {
    scrollX: 0,
    scrollY: 0,
    pixelsPerBeat: 80,
    pixelsPerSemitone: 12,
    ...overrides,
  };
}

function makeNote(overrides: Partial<MidiNote> = {}): MidiNote {
  return {
    id: 'test-note',
    pitch: 60,
    startBeats: 0,
    durationBeats: 1,
    velocity: 100,
    channel: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// beatToX
// ---------------------------------------------------------------------------

describe('beatToX', () => {
  it('beat 0 at scrollX=0 returns x=0', () => {
    expect(beatToX(0, makeVp())).toBe(0);
  });

  it('beat 1 at pixelsPerBeat=80, scrollX=0 returns x=80', () => {
    expect(beatToX(1, makeVp({ pixelsPerBeat: 80 }))).toBe(80);
  });

  it('beat 2 at pixelsPerBeat=80 returns x=160', () => {
    expect(beatToX(2, makeVp({ pixelsPerBeat: 80 }))).toBe(160);
  });

  it('scrollX shifts result left by scrollX amount', () => {
    // beat 1 → 80px, minus scrollX 40 → 40
    expect(beatToX(1, makeVp({ pixelsPerBeat: 80, scrollX: 40 }))).toBe(40);
  });

  it('large scrollX can produce negative result', () => {
    expect(beatToX(0, makeVp({ scrollX: 100 }))).toBe(-100);
  });
});

// ---------------------------------------------------------------------------
// xToBeat
// ---------------------------------------------------------------------------

describe('xToBeat', () => {
  it('x=0 at scrollX=0 returns beat 0', () => {
    expect(xToBeat(0, makeVp())).toBe(0);
  });

  it('x=80 at pixelsPerBeat=80, scrollX=0 returns beat 1', () => {
    expect(xToBeat(80, makeVp({ pixelsPerBeat: 80 }))).toBe(1);
  });

  it('is the inverse of beatToX', () => {
    const vp = makeVp({ pixelsPerBeat: 80, scrollX: 40 });
    expect(xToBeat(beatToX(3, vp), vp)).toBeCloseTo(3);
  });

  it('negative x clamps to 0 (no negative beat positions)', () => {
    // x = -40, scrollX = 0 → raw = -40/80 = -0.5 → clamped to 0
    expect(xToBeat(-40, makeVp())).toBe(0);
  });

  it('scrollX offset is accounted for', () => {
    // x=0, scrollX=80 → (0+80)/80 = 1 beat
    expect(xToBeat(0, makeVp({ scrollX: 80 }))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// pitchToY
// ---------------------------------------------------------------------------

describe('pitchToY', () => {
  it('pitch 127 at scrollY=0 returns y=0 (highest pitch at top)', () => {
    expect(pitchToY(127, makeVp({ pixelsPerSemitone: 12 }))).toBe(0);
  });

  it('pitch 0 returns y=127*pixelsPerSemitone', () => {
    const pps = 12;
    expect(pitchToY(0, makeVp({ pixelsPerSemitone: pps }))).toBe(127 * pps);
  });

  it('pitch 126 returns y=pixelsPerSemitone', () => {
    expect(pitchToY(126, makeVp({ pixelsPerSemitone: 12 }))).toBe(12);
  });

  it('scrollY shifts result upward (subtracts from y)', () => {
    // pitch 127 without scroll → 0; with scrollY=24 → -24
    expect(pitchToY(127, makeVp({ scrollY: 24 }))).toBe(-24);
  });

  it('middle C (pitch 60) lands at (127-60)*pixelsPerSemitone minus scrollY', () => {
    const vp = makeVp({ pixelsPerSemitone: 12, scrollY: 0 });
    expect(pitchToY(60, vp)).toBe((127 - 60) * 12);
  });
});

// ---------------------------------------------------------------------------
// yToPitch
// ---------------------------------------------------------------------------

describe('yToPitch', () => {
  it('y=0 at scrollY=0 returns pitch 127', () => {
    expect(yToPitch(0, makeVp({ pixelsPerSemitone: 12 }))).toBe(127);
  });

  it('is the approximate inverse of pitchToY', () => {
    const vp = makeVp({ pixelsPerSemitone: 12, scrollY: 0 });
    expect(yToPitch(pitchToY(60, vp), vp)).toBe(60);
  });

  it('clamps result to 0 when y is very large', () => {
    const vp = makeVp({ pixelsPerSemitone: 12, scrollY: 0 });
    // y much larger than 127*12 = 1524 → pitch below 0 → clamp to 0
    expect(yToPitch(9999, vp)).toBe(0);
  });

  it('clamps result to 127 when y is very small (negative)', () => {
    const vp = makeVp({ pixelsPerSemitone: 12, scrollY: 0 });
    expect(yToPitch(-9999, vp)).toBe(127);
  });

  it('scrollY offset shifts pitch correctly', () => {
    const vp = makeVp({ pixelsPerSemitone: 12, scrollY: 12 });
    // y=0, scrollY=12 → raw = 127 - (0+12)/12 = 127-1 = 126
    expect(yToPitch(0, vp)).toBe(126);
  });
});

// ---------------------------------------------------------------------------
// snapBeat
// ---------------------------------------------------------------------------

describe('snapBeat', () => {
  it('0.4 with quantDiv=4 snaps to 0 (nearest 1/4 beat grid)', () => {
    // gridSize = 4/4 = 1 beat; 0.4 → round(0.4/1)*1 = 0
    expect(snapBeat(0.4, 4)).toBe(0);
  });

  it('0.6 with quantDiv=4 snaps to 1', () => {
    expect(snapBeat(0.6, 4)).toBe(1);
  });

  it('0.4 with quantDiv=16 snaps to 0.25 (nearest 1/16 = 0.25 beat)', () => {
    // gridSize = 4/16 = 0.25; round(0.4/0.25)*0.25 = round(1.6)*0.25 = 2*0.25 = 0.5
    // Actually: round(1.6) = 2, so result = 0.5
    expect(snapBeat(0.4, 16)).toBeCloseTo(0.5);
  });

  it('0.13 with quantDiv=16 snaps to 0.25', () => {
    // gridSize = 0.25; round(0.13/0.25) = round(0.52) = 1; result = 0.25
    expect(snapBeat(0.13, 16)).toBeCloseTo(0.25);
  });

  it('exactly on a grid line stays put', () => {
    expect(snapBeat(0.5, 8)).toBeCloseTo(0.5); // gridSize=0.5, 0.5/0.5=1→1*0.5=0.5
  });

  it('0.0 always snaps to 0 regardless of quantDiv', () => {
    expect(snapBeat(0, 32)).toBe(0);
  });

  it('quantDiv=32: gridSize = 4/32 = 0.125 beat', () => {
    // 0.06 → round(0.06/0.125) = round(0.48) = 0 → 0
    expect(snapBeat(0.06, 32)).toBeCloseTo(0);
    // 0.07 → round(0.07/0.125) = round(0.56) = 1 → 0.125
    expect(snapBeat(0.07, 32)).toBeCloseTo(0.125);
  });
});

// ---------------------------------------------------------------------------
// getVisibleNotes
// ---------------------------------------------------------------------------

describe('getVisibleNotes', () => {
  // Viewport constants used throughout this block.
  // pixelsPerSemitone=12, canvasH=480:
  //   topPitch    = yToPitch(0,   VP) = 127  (pitch 127 is at y=0)
  //   bottomPitch = yToPitch(480, VP) = round(127 - 480/12) = round(87) = 87
  //   visible pitch range after ±1 padding: [86, 128] → effectively 87..127
  //
  // To make pitch 60 visible we need a viewport scrolled down so that pitch 60
  // falls inside the canvas window. Scrolling scrollY so that pitch 60 is near
  // the top: y_of_60 = (127-60)*12 = 804px; we need scrollY ≥ 804 - canvasH.
  // Use scrollY = 600 (the default in the store), which makes:
  //   topPitch    = yToPitch(0, VP_MID)   = round(127 - 600/12) = 127-50 = 77
  //   bottomPitch = yToPitch(480, VP_MID) = round(127 - 1080/12) = round(37) = 37
  //   pitch 60 is within [36, 78] ✓
  const VP = makeVp({ pixelsPerBeat: 80, pixelsPerSemitone: 12, scrollX: 0, scrollY: 0 });
  // A viewport scrolled to show the middle octaves (pitch 37..78).
  const VP_MID = makeVp({ pixelsPerBeat: 80, pixelsPerSemitone: 12, scrollX: 0, scrollY: 600 });
  const CANVAS_W = 640;
  const CANVAS_H = 480;

  it('note at beat 0, pitch 60 is visible when viewport is scrolled to show mid-range', () => {
    // VP_MID: scrollY=600 → visible pitches ~37..78; pitch 60 is in range.
    const note = makeNote({ startBeats: 0, durationBeats: 1, pitch: 60 });
    const visible = getVisibleNotes([note], VP_MID, CANVAS_W, CANVAS_H);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('test-note');
  });

  it('note at beat 0, pitch 127 is visible when scrollY=0 (highest pitch maps to y=0)', () => {
    const note = makeNote({ startBeats: 0, durationBeats: 1, pitch: 127 });
    // VP (scrollY=0): topPitch=128 clamped, maxPitch includes 127 ✓
    const visible = getVisibleNotes([note], VP, CANVAS_W, CANVAS_H);
    expect(visible).toHaveLength(1);
  });

  it('note far off to the right is not visible', () => {
    // beat 100 → x = 100*80 = 8000, well past canvasW=640
    const note = makeNote({ startBeats: 100, durationBeats: 1, pitch: 127 });
    const visible = getVisibleNotes([note], VP, CANVAS_W, CANVAS_H);
    expect(visible).toHaveLength(0);
  });

  it('note at pitch 0 is not visible when canvas only shows upper pitch range (scrollY=0)', () => {
    // VP (scrollY=0): bottomPitch = round(127 - 480/12) = 87; minPitch=86
    // pitch 0 < 86 → not visible
    const note = makeNote({ pitch: 0, startBeats: 0, durationBeats: 1 });
    const visible = getVisibleNotes([note], VP, CANVAS_W, CANVAS_H);
    expect(visible).toHaveLength(0);
  });

  it('note at pitch 127 is NOT visible when viewport is scrolled to show mid-range', () => {
    // VP_MID (scrollY=600): topPitch ≈ 77; pitch 127 > 78 → not visible
    const note = makeNote({ pitch: 127, startBeats: 0, durationBeats: 1 });
    const visible = getVisibleNotes([note], VP_MID, CANVAS_W, CANVAS_H);
    expect(visible).toHaveLength(0);
  });

  it('note that spans into visible beat range from the left is included', () => {
    // Starts at beat -2 but extends 5 beats → overlaps beat 0 (visible)
    const note = makeNote({ startBeats: -2, durationBeats: 5, pitch: 127 });
    const visible = getVisibleNotes([note], VP, CANVAS_W, CANVAS_H);
    expect(visible).toHaveLength(1);
  });

  it('returns empty array when notes array is empty', () => {
    expect(getVisibleNotes([], VP, CANVAS_W, CANVAS_H)).toHaveLength(0);
  });

  it('returns only the notes that fall within viewport from a mixed list', () => {
    // VP: scrollY=0 → visible pitches ~87..128; pitch 90 and 100 are visible.
    // pitch 60 is below the visible range with scrollY=0.
    const visible1 = makeNote({ id: 'v1', startBeats: 0, pitch: 100 });
    const hidden1  = makeNote({ id: 'h1', startBeats: 200, pitch: 100 }); // too far right
    const visible2 = makeNote({ id: 'v2', startBeats: 1,   pitch: 90 });
    const result = getVisibleNotes([visible1, hidden1, visible2], VP, CANVAS_W, CANVAS_H);
    expect(result.map((n) => n.id)).toEqual(expect.arrayContaining(['v1', 'v2']));
    expect(result.map((n) => n.id)).not.toContain('h1');
  });
});

// ---------------------------------------------------------------------------
// noteHitTest
// ---------------------------------------------------------------------------

describe('noteHitTest', () => {
  // Note at beat 1, pitch 64, duration 2 beats with default viewport
  // noteX = 1*80 = 80, noteW = 2*80 = 160, noteY = (127-64)*12 = 756, noteH = 12
  const VP = makeVp({ pixelsPerBeat: 80, pixelsPerSemitone: 12 });
  const NOTE = makeNote({ startBeats: 1, durationBeats: 2, pitch: 64 });

  it('returns null when pointer is completely outside the note', () => {
    expect(noteHitTest(NOTE, 0, 0, VP)).toBeNull();
  });

  it('returns "move" when clicking the body (left 80%) of the note', () => {
    const noteX = 1 * 80; // 80
    const noteY = (127 - 64) * 12; // 756
    // Click at left-centre of note — well within body
    const result = noteHitTest(NOTE, noteX + 20, noteY + 6, VP);
    expect(result).toBe('move');
  });

  it('returns "resize" when clicking the right edge of the note', () => {
    const noteX = 1 * 80;    // 80
    const noteW = 2 * 80;    // 160
    const noteY = (127 - 64) * 12;
    // Right edge: noteX + noteW - 2 = 80 + 160 - 2 = 238
    const result = noteHitTest(NOTE, noteX + noteW - 2, noteY + 6, VP);
    expect(result).toBe('resize');
  });

  it('returns null when pointer is just below the note bottom edge', () => {
    const noteX = 1 * 80;
    const noteY = (127 - 64) * 12;
    const noteH = 12;
    expect(noteHitTest(NOTE, noteX + 20, noteY + noteH + 1, VP)).toBeNull();
  });

  it('returns null when pointer is just above the note top edge', () => {
    const noteX = 1 * 80;
    const noteY = (127 - 64) * 12;
    expect(noteHitTest(NOTE, noteX + 20, noteY - 1, VP)).toBeNull();
  });

  it('returns null when pointer is just left of the note', () => {
    const noteX = 1 * 80;
    const noteY = (127 - 64) * 12;
    expect(noteHitTest(NOTE, noteX - 1, noteY + 6, VP)).toBeNull();
  });

  it('resize zone minimum is 4 px for very short notes', () => {
    // A very short note (0.01 beats) → noteW = 0.01*80 = 0.8px → resizeZone=max(4,0.16)=4
    const shortNote = makeNote({ startBeats: 0, durationBeats: 0.01, pitch: 64 });
    const noteX = 0;
    const noteY = (127 - 64) * 12;
    // The note body effectively starts at x=0 and ends at x=0.8; resize zone is 4px wide
    // Click at x=0 (inside note but resize zone covers full note since noteW < resizeZone)
    const result = noteHitTest(shortNote, noteX, noteY + 6, VP);
    expect(result).toBe('resize');
  });
});

// ---------------------------------------------------------------------------
// isBlackKey
// ---------------------------------------------------------------------------

describe('isBlackKey', () => {
  it('C (pitch%12=0) is white', () => expect(isBlackKey(60)).toBe(false));
  it('C# (pitch%12=1) is black', () => expect(isBlackKey(61)).toBe(true));
  it('D (pitch%12=2) is white', () => expect(isBlackKey(62)).toBe(false));
  it('D# (pitch%12=3) is black', () => expect(isBlackKey(63)).toBe(true));
  it('E (pitch%12=4) is white', () => expect(isBlackKey(64)).toBe(false));
  it('F (pitch%12=5) is white', () => expect(isBlackKey(65)).toBe(false));
  it('F# (pitch%12=6) is black', () => expect(isBlackKey(66)).toBe(true));
  it('G (pitch%12=7) is white', () => expect(isBlackKey(67)).toBe(false));
  it('G# (pitch%12=8) is black', () => expect(isBlackKey(68)).toBe(true));
  it('A (pitch%12=9) is white', () => expect(isBlackKey(69)).toBe(false));
  it('A# (pitch%12=10) is black', () => expect(isBlackKey(70)).toBe(true));
  it('B (pitch%12=11) is white', () => expect(isBlackKey(71)).toBe(false));
});

// ---------------------------------------------------------------------------
// pitchToName
// ---------------------------------------------------------------------------

describe('pitchToName', () => {
  it('pitch 60 = C4 (middle C)', () => expect(pitchToName(60)).toBe('C4'));
  it('pitch 69 = A4 (concert A)', () => expect(pitchToName(69)).toBe('A4'));
  it('pitch 0 = C-1', () => expect(pitchToName(0)).toBe('C-1'));
  it('pitch 127 = G9', () => expect(pitchToName(127)).toBe('G9'));
  it('pitch 61 = C#4', () => expect(pitchToName(61)).toBe('C#4'));
});
