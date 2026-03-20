/**
 * TakeLaneView — stacked take rows rendered beneath a track in the Timeline.
 *
 * Each take is rendered as a colored bar at the loop region's bar range.
 * Clicking a take bar activates it as the playback source for the track.
 * Right-clicking shows a context menu with "Set Active" and "Delete Take".
 * The view is only rendered when the track's take lane is expanded.
 */

import { useState } from 'react';
import { useTakeLaneStore } from '@/stores/takeLaneStore';
import type { Take } from '@/lib/ipc';

export const TAKE_ROW_HEIGHT = 22;

interface TakeLaneViewProps {
  trackId: string;
  /** Converts a bar position to a canvas x pixel offset. */
  barToX: (bar: number) => number;
  /** Total rendered width in pixels. */
  width: number;
  beatsPerBar: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  take: Take;
}

export function TakeLaneView({
  trackId,
  barToX,
  width,
  beatsPerBar,
}: TakeLaneViewProps) {
  const lane = useTakeLaneStore((s) => s.lanes[trackId]);
  const { setActiveTake, deleteTake } = useTakeLaneStore.getState();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  if (!lane || lane.takes.length === 0) return null;

  function takeToX(beats: number): number {
    return barToX(beats / beatsPerBar);
  }

  function handleTakeClick(take: Take) {
    void setActiveTake(trackId, take.id);
  }

  function handleContextMenu(e: React.MouseEvent, take: Take) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, take });
  }

  return (
    <div
      style={{ position: 'relative', width, background: '#111' }}
      onClick={() => setContextMenu(null)}
    >
      {lane.takes.map((take) => {
        const x = takeToX(take.loopStartBeats);
        const w = Math.max(4, takeToX(take.loopEndBeats) - x);
        return (
          <div
            key={take.id}
            style={{
              height: TAKE_ROW_HEIGHT,
              position: 'relative',
              borderBottom: '1px solid #222',
            }}
          >
            {/* Take label */}
            <span
              style={{
                position: 'absolute',
                left: 4,
                top: 3,
                fontSize: 10,
                color: '#666',
                userSelect: 'none',
                zIndex: 1,
              }}
            >
              T{take.takeNumber}
            </span>
            {/* Take region bar */}
            <div
              onClick={() => handleTakeClick(take)}
              onContextMenu={(e) => handleContextMenu(e, take)}
              style={{
                position: 'absolute',
                left: x,
                top: 3,
                width: w,
                height: TAKE_ROW_HEIGHT - 6,
                borderRadius: 3,
                background: take.isActive ? '#6c63ff' : '#3a3a5a',
                opacity: take.isActive ? 1 : 0.5,
                cursor: 'pointer',
                boxSizing: 'border-box',
                border: take.isActive ? '1px solid #8a80ff' : '1px solid #4a4a6a',
              }}
              title={`Take ${take.takeNumber}${take.isActive ? ' (active)' : ''}`}
              data-testid={`take-bar-${take.id}`}
            />
          </div>
        );
      })}

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: 4,
            zIndex: 1000,
            fontSize: 12,
            color: '#e0e0e0',
            minWidth: 140,
          }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button
            style={menuItemStyle}
            onClick={() => {
              void setActiveTake(trackId, contextMenu.take.id);
              setContextMenu(null);
            }}
          >
            Set Active
          </button>
          <button
            style={menuItemStyle}
            onClick={() => {
              void deleteTake(trackId, contextMenu.take.id);
              setContextMenu(null);
            }}
          >
            Delete Take
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  background: 'none',
  border: 'none',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: 12,
};
