/**
 * ExportMidiDialog — modal dialog for exporting MIDI patterns or the full arrangement.
 *
 * Modes:
 * - "pattern": exports a single selected pattern as a Type 0 MIDI file.
 * - "arrangement": exports all tracks with notes as a Type 1 MIDI file.
 *
 * The user picks the export PPQ (480 or 960) and clicks "Export..."
 * which triggers the OS native save dialog, then calls the appropriate Tauri command.
 * A non-blocking status message is shown on success or error.
 */

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { save } from '@tauri-apps/plugin-dialog';
import { usePatternStore } from '@/stores/patternStore';
import { useArrangementStore } from '@/stores/arrangementStore';
import { useTransportStore } from '@/stores/transportStore';
import { useTempoMapStore } from '@/stores/tempoMapStore';
import {
  ipcExportMidiPattern,
  ipcExportMidiArrangement,
  type ExportNote,
  type ExportTrack,
  type ExportOptions,
} from '@/lib/ipc';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExportMidiDialogProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface MidiPatternContent {
  type: 'Midi';
  notes: Array<{
    pitch: number;
    velocity: number;
    channel: number;
    startBeats: number;
    durationBeats: number;
  }>;
}

function isMidiContent(content: { type: string }): content is MidiPatternContent {
  return content.type === 'Midi' && Array.isArray((content as MidiPatternContent).notes);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ExportMidiDialog renders a modal overlay for MIDI export.
 *
 * @param onClose - Called when the user dismisses the dialog (Cancel or after export).
 */
export function ExportMidiDialog({ onClose }: ExportMidiDialogProps) {
  const [mode, setMode] = useState<'pattern' | 'arrangement'>('arrangement');
  const [selectedPatternId, setSelectedPatternId] = useState<string>('');
  const [exportPpq, setExportPpq] = useState<480 | 960>(480);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const patterns = usePatternStore(useShallow((s) => Object.values(s.patterns)));
  const midiPatterns = patterns.filter((p) => isMidiContent(p.content));

  const clips = useArrangementStore(useShallow((s) => Object.values(s.clips)));
  const snapshot = useTransportStore((s) => s.snapshot);
  const tempoPoints = useTempoMapStore((s) => s.points);

  const beatsPerBar = snapshot.time_sig_numerator;

  async function handleExport() {
    setStatus(null);
    setIsExporting(true);

    try {
      const defaultName =
        mode === 'pattern'
          ? (midiPatterns.find((p) => p.id === selectedPatternId)?.name ?? 'pattern') + '.mid'
          : 'arrangement.mid';

      const path = await save({
        filters: [{ name: 'MIDI Files', extensions: ['mid'] }],
        defaultPath: defaultName,
      });

      if (!path) {
        setIsExporting(false);
        return; // user cancelled
      }

      const options: ExportOptions = { exportPpq };

      if (mode === 'pattern') {
        const pattern = midiPatterns.find((p) => p.id === selectedPatternId);
        if (!pattern) {
          setStatus({ kind: 'error', message: 'No pattern selected.' });
          setIsExporting(false);
          return;
        }

        const content = pattern.content as MidiPatternContent;
        const notes: ExportNote[] = content.notes.map((n) => ({
          pitch: n.pitch,
          velocity: n.velocity,
          channel: n.channel,
          startBeats: n.startBeats,
          durationBeats: n.durationBeats,
        }));

        await ipcExportMidiPattern(
          notes,
          path,
          options,
          tempoPoints,
          snapshot.time_sig_numerator,
          snapshot.time_sig_denominator,
        );
      } else {
        // Group clips by trackId, compute absolute beat positions
        const trackMap = new Map<string, ExportNote[]>();

        for (const clip of clips) {
          const pattern = patterns.find((p) => p.id === clip.patternId);
          if (!pattern || !isMidiContent(pattern.content)) continue;

          const clipOffsetBeats = clip.startBar * beatsPerBar;
          const existing = trackMap.get(clip.trackId) ?? [];

          for (const n of pattern.content.notes) {
            existing.push({
              pitch: n.pitch,
              velocity: n.velocity,
              channel: n.channel,
              startBeats: clipOffsetBeats + n.startBeats,
              durationBeats: n.durationBeats,
            });
          }
          trackMap.set(clip.trackId, existing);
        }

        const tracks: ExportTrack[] = Array.from(trackMap.entries()).map(([trackId, notes]) => ({
          name: trackId,
          notes,
        }));

        await ipcExportMidiArrangement(
          tracks,
          path,
          options,
          tempoPoints,
          snapshot.time_sig_numerator,
          snapshot.time_sig_denominator,
        );
      }

      setStatus({ kind: 'success', message: `Saved to ${path}` });
    } catch (err) {
      setStatus({ kind: 'error', message: String(err) });
    } finally {
      setIsExporting(false);
    }
  }

  const exportDisabled = isExporting || (mode === 'pattern' && !selectedPatternId);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#1e1e1e',
          border: '1px solid #3a3a3a',
          borderRadius: 8,
          padding: 24,
          minWidth: 360,
          maxWidth: 480,
          color: '#e0e0e0',
          fontSize: 13,
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>Export MIDI</h2>

        {/* Mode selector */}
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
          <legend style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Export Mode</legend>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 6 }}
          >
            <input
              type="radio"
              name="mode"
              value="arrangement"
              checked={mode === 'arrangement'}
              onChange={() => setMode('arrangement')}
            />
            Full Arrangement (Type 1)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="radio"
              name="mode"
              value="pattern"
              checked={mode === 'pattern'}
              onChange={() => setMode('pattern')}
            />
            Single Pattern (Type 0)
          </label>
        </fieldset>

        {/* Pattern selector (shown only in pattern mode) */}
        {mode === 'pattern' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 6 }}>
              Pattern
            </label>
            <select
              value={selectedPatternId}
              onChange={(e) => setSelectedPatternId(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: 4,
                color: '#e0e0e0',
                fontSize: 13,
              }}
            >
              <option value="">— Select a pattern —</option>
              {midiPatterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* PPQ selector */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 6 }}>
            Export PPQ
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            {([480, 960] as const).map((ppq) => (
              <label
                key={ppq}
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  name="ppq"
                  value={ppq}
                  checked={exportPpq === ppq}
                  onChange={() => setExportPpq(ppq)}
                />
                {ppq}
                {ppq === 480 && (
                  <span style={{ color: '#666', fontSize: 11 }}>(default)</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* Status message */}
        {status && (
          <div
            style={{
              marginBottom: 16,
              padding: '8px 12px',
              borderRadius: 4,
              fontSize: 12,
              background: status.kind === 'success' ? '#1a3a1a' : '#3a1a1a',
              border: `1px solid ${status.kind === 'success' ? '#2a5a2a' : '#5a2a2a'}`,
              color: status.kind === 'success' ? '#6fcf6f' : '#cf6f6f',
            }}
          >
            {status.message}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              background: 'none',
              border: '1px solid #3a3a3a',
              borderRadius: 4,
              color: '#aaa',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {status?.kind === 'success' ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={exportDisabled}
            style={{
              padding: '6px 16px',
              background: isExporting ? '#4a4a6a' : '#6c63ff',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              cursor: exportDisabled ? 'not-allowed' : 'pointer',
              fontSize: 13,
              opacity: mode === 'pattern' && !selectedPatternId ? 0.5 : 1,
            }}
          >
            {isExporting ? 'Exporting...' : 'Export...'}
          </button>
        </div>
      </div>
    </div>
  );
}
