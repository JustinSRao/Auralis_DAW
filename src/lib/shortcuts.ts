/**
 * Keyboard shortcut definitions and utilities (Sprint 46).
 *
 * `ACTION_REGISTRY` is the single source of truth for every remappable action.
 * `DEFAULT_BINDINGS` is derived from it for use as fallback values.
 * `serializeCombo` converts a `KeyboardEvent` into a human-readable combo
 * string such as `"Ctrl+S"` or `"Space"`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionCategory = 'Transport' | 'Editing' | 'Track' | 'View' | 'Project';

export interface ActionDef {
  id: string;
  label: string;
  category: ActionCategory;
  defaultCombo: string;
}

// ---------------------------------------------------------------------------
// Action registry
// ---------------------------------------------------------------------------

export const ACTION_REGISTRY: ActionDef[] = [
  { id: 'transport.play_stop',  label: 'Play / Stop',       category: 'Transport', defaultCombo: 'Space'   },
  { id: 'transport.loop',       label: 'Toggle Loop',        category: 'Transport', defaultCombo: 'L'       },
  { id: 'transport.follow',     label: 'Follow Playhead',    category: 'Transport', defaultCombo: 'F'       },
  { id: 'track.record_arm',     label: 'Record Arm',         category: 'Track',     defaultCombo: 'R'       },
  { id: 'track.mute',           label: 'Mute Track',         category: 'Track',     defaultCombo: 'M'       },
  { id: 'track.solo',           label: 'Solo Track',         category: 'Track',     defaultCombo: 'S'       },
  { id: 'track.delete',         label: 'Delete Track',       category: 'Track',     defaultCombo: 'Delete'  },
  { id: 'editing.undo',         label: 'Undo',               category: 'Editing',   defaultCombo: 'Ctrl+Z'  },
  { id: 'editing.redo',         label: 'Redo',               category: 'Editing',   defaultCombo: 'Ctrl+Y'  },
  { id: 'editing.copy',         label: 'Copy',               category: 'Editing',   defaultCombo: 'Ctrl+C'  },
  { id: 'editing.paste',        label: 'Paste',              category: 'Editing',   defaultCombo: 'Ctrl+V'  },
  { id: 'editing.duplicate',    label: 'Duplicate',          category: 'Editing',   defaultCombo: 'Ctrl+D'  },
  { id: 'editing.delete',       label: 'Delete Selection',   category: 'Editing',   defaultCombo: 'Delete'  },
  { id: 'project.save',         label: 'Save Project',       category: 'Project',   defaultCombo: 'Ctrl+S'  },
  { id: 'project.new',          label: 'New Project',        category: 'Project',   defaultCombo: 'Ctrl+N'  },
  { id: 'view.settings',        label: 'Open Settings',      category: 'View',      defaultCombo: 'Ctrl+,'  },
  { id: 'view.browser',         label: 'Toggle Browser',     category: 'View',      defaultCombo: 'B'       },
  { id: 'view.mixer',           label: 'Toggle Mixer',       category: 'View',      defaultCombo: 'W'       },
];

// ---------------------------------------------------------------------------
// Default bindings — derived from ACTION_REGISTRY
// ---------------------------------------------------------------------------

export const DEFAULT_BINDINGS: Record<string, string> = Object.fromEntries(
  ACTION_REGISTRY.map((a) => [a.id, a.defaultCombo]),
);

// ---------------------------------------------------------------------------
// Key display normalisation
// ---------------------------------------------------------------------------

const KEY_DISPLAY: Record<string, string> = {
  ' ':          'Space',
  'ArrowUp':    'Up',
  'ArrowDown':  'Down',
  'ArrowLeft':  'Left',
  'ArrowRight': 'Right',
  'Escape':     'Escape',
  'Enter':      'Enter',
  'Backspace':  'Backspace',
  'Delete':     'Delete',
  'Tab':        'Tab',
};

/**
 * Serialises a `KeyboardEvent` into a stable combo string such as `"Ctrl+S"`,
 * `"Space"`, or `"Alt+Shift+F4"`.
 *
 * Returns an empty string when the event is a bare modifier key press (no
 * actionable key yet), so callers can ignore it.
 */
export function serializeCombo(e: KeyboardEvent): string {
  const rawKey = e.key;

  // Bare modifier key — not a complete combo yet.
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(rawKey)) return '';

  // Normalize printable single characters to uppercase so bindings such as
  // `"R"` match whether or not Shift is held. Multi-character keys (e.g.
  // "Delete", "ArrowUp") are left as-is and handled via KEY_DISPLAY first.
  const normalizedRaw = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
  const key = KEY_DISPLAY[normalizedRaw] ?? normalizedRaw;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);

  return parts.join('+');
}
