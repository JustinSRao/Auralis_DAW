/**
 * MidiImportDialog — modal for selecting which MIDI tracks to import.
 *
 * Shown after `ipcImportMidiFile` returns a `MidiFileInfo`.  The user can:
 * - Enable / disable individual tracks via checkboxes.
 * - Rename each pattern.
 * - Choose the target DAW track from a dropdown.
 * - Choose the pattern length in bars.
 * - View the suggested BPM from the MIDI file.
 *
 * On confirm, calls `onConfirm` with the list of enabled payloads.
 */

import { useState } from 'react';
import { useTrackStore } from '../../stores/trackStore';
import type {
  MidiFileInfo,
  ImportedTrack,
  ImportTrackPayload,
  PatternLengthBars,
} from '../../lib/ipc';
import { MidiImporter } from '../../lib/midiImportUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RowState {
  enabled: boolean;
  patternName: string;
  trackId: string;
  lengthBars: PatternLengthBars;
}

export interface MidiImportDialogProps {
  fileInfo: MidiFileInfo;
  onConfirm(payloads: ImportTrackPayload[]): void;
  onCancel(): void;
}

const LENGTH_OPTIONS: PatternLengthBars[] = [1, 2, 4, 8, 16, 32];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MidiImportDialog({ fileInfo, onConfirm, onCancel }: MidiImportDialogProps) {
  const { tracks } = useTrackStore();
  const defaultTrackId = tracks[0]?.id ?? '';

  // Build initial row state: non-empty tracks enabled, empty ones disabled.
  const [rows, setRows] = useState<RowState[]>(() =>
    fileInfo.tracks.map((t: ImportedTrack) => {
      const maxEndBeat = t.notes.reduce(
        (acc, n) => Math.max(acc, n.startBeats + n.durationBeats),
        0,
      );
      const rawBars = maxEndBeat / 4; // assume 4/4
      const lengthBars = MidiImporter.snapLengthBars(rawBars) as PatternLengthBars;
      return {
        enabled: !t.isEmpty,
        patternName: t.name,
        trackId: defaultTrackId,
        lengthBars,
      };
    }),
  );

  function updateRow(idx: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function handleConfirm() {
    const payloads: ImportTrackPayload[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.enabled) continue;
      const track = fileInfo.tracks[i];
      if (track.notes.length === 0) continue;
      payloads.push({
        midiTrackIndex: track.midiTrackIndex,
        patternName: row.patternName.trim() || track.name,
        trackId: row.trackId,
        notes: track.notes,
        lengthBars: row.lengthBars,
      });
    }
    onConfirm(payloads);
  }

  const enabledCount = rows.filter((r) => r.enabled).length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60"
        onClick={onCancel}
        data-testid="midi-import-backdrop"
      />

      {/* Dialog */}
      <div
        className="fixed inset-0 z-60 flex items-center justify-center pointer-events-none"
        style={{ zIndex: 60 }}
      >
        <div
          className="pointer-events-auto bg-[#1e1e2e] border border-[#3a3a4a] rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col"
          data-testid="midi-import-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#3a3a4a] flex-shrink-0">
            <div>
              <h2 className="text-sm font-mono text-[#cccccc]">Import MIDI File</h2>
              <p className="text-[10px] text-[#666] mt-0.5 font-mono">
                Detected tempo:{' '}
                <span className="text-[#88aaff]" data-testid="suggested-bpm">
                  {Math.round(fileInfo.suggestedBpm)} BPM
                </span>
                {' · '}
                {fileInfo.format === 0 ? 'Type 0 (single track)' : 'Type 1 (multi-track)'}
              </p>
            </div>
            <button
              onClick={onCancel}
              className="text-[#666] hover:text-[#aaa] text-lg leading-none font-mono"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Track list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* Column headers */}
            <div className="grid grid-cols-[28px_1fr_140px_120px_80px] gap-2 px-4 py-1.5 border-b border-[#2a2a3a] text-[9px] font-mono text-[#555] uppercase">
              <span />
              <span>Pattern Name</span>
              <span>DAW Track</span>
              <span>Length</span>
              <span className="text-right">Notes</span>
            </div>

            {fileInfo.tracks.map((track, idx) => {
              const row = rows[idx];
              return (
                <div
                  key={track.midiTrackIndex}
                  data-testid={`import-track-row-${idx}`}
                  className={[
                    'grid grid-cols-[28px_1fr_140px_120px_80px] gap-2 px-4 py-2 items-center',
                    'border-b border-[#2a2a2a]',
                    row.enabled ? '' : 'opacity-40',
                  ].join(' ')}
                >
                  {/* Enable checkbox */}
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={track.isEmpty}
                    onChange={(e) => updateRow(idx, { enabled: e.target.checked })}
                    data-testid={`import-track-checkbox-${idx}`}
                    className="accent-[#5b8def] cursor-pointer"
                    aria-label={`Import track ${track.name}`}
                  />

                  {/* Pattern name input */}
                  <input
                    type="text"
                    value={row.patternName}
                    onChange={(e) => updateRow(idx, { patternName: e.target.value })}
                    disabled={!row.enabled}
                    data-testid={`import-track-name-${idx}`}
                    className="bg-[#141420] border border-[#3a3a4a] rounded px-2 py-1 text-xs text-[#cccccc] outline-none focus:border-[#5b8def] disabled:opacity-50 font-mono"
                    maxLength={128}
                  />

                  {/* DAW track dropdown */}
                  <select
                    value={row.trackId}
                    onChange={(e) => updateRow(idx, { trackId: e.target.value })}
                    disabled={!row.enabled || tracks.length === 0}
                    data-testid={`import-track-select-${idx}`}
                    className="bg-[#141420] border border-[#3a3a4a] rounded px-2 py-1 text-xs text-[#cccccc] outline-none focus:border-[#5b8def] disabled:opacity-50 font-mono"
                  >
                    {tracks.length === 0 ? (
                      <option value="">No tracks</option>
                    ) : (
                      tracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))
                    )}
                  </select>

                  {/* Length dropdown */}
                  <select
                    value={row.lengthBars}
                    onChange={(e) =>
                      updateRow(idx, { lengthBars: Number(e.target.value) as PatternLengthBars })
                    }
                    disabled={!row.enabled}
                    data-testid={`import-track-length-${idx}`}
                    className="bg-[#141420] border border-[#3a3a4a] rounded px-2 py-1 text-xs text-[#cccccc] outline-none focus:border-[#5b8def] disabled:opacity-50 font-mono"
                  >
                    {LENGTH_OPTIONS.map((l) => (
                      <option key={l} value={l}>
                        {l === 1 ? '1 bar' : `${l} bars`}
                      </option>
                    ))}
                  </select>

                  {/* Note count */}
                  <span className="text-right text-[10px] text-[#666] font-mono">
                    {track.isEmpty ? (
                      <span className="text-[#444]">empty</span>
                    ) : (
                      track.notes.length
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[#3a3a4a] flex-shrink-0">
            <button
              onClick={onCancel}
              data-testid="midi-import-cancel"
              className="px-4 py-1.5 text-xs font-mono text-[#888] hover:text-[#ccc] border border-[#3a3a4a] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={enabledCount === 0}
              data-testid="midi-import-confirm"
              className="px-4 py-1.5 text-xs font-mono bg-[#5b8def] text-white rounded hover:bg-[#4a7cde] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Import {enabledCount > 0 ? `${enabledCount} track${enabledCount > 1 ? 's' : ''}` : ''}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
