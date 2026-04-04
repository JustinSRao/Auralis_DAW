/**
 * Tests for ShortcutsSettingsTab (Sprint 46).
 *
 * Uses jsdom + testing-library. The shortcutsStore and settingsStore are used
 * directly (no Tauri IPC needed for this tab). The KeyCaptureModal and
 * ConflictDialog are exercised via keyboard events and button clicks.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { act } from 'react';
import { useShortcutsStore } from '@/stores/shortcutsStore';
import { DEFAULT_BINDINGS, ACTION_REGISTRY } from '@/lib/shortcuts';

// ---------------------------------------------------------------------------
// Mock settingsStore.updateShortcuts so we don't need the full Tauri runtime.
// ---------------------------------------------------------------------------

const mockUpdateShortcuts = vi.fn();

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      updateShortcuts: mockUpdateShortcuts,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import component after mocks.
// ---------------------------------------------------------------------------

const { ShortcutsSettingsTab } = await import('../ShortcutsSettingsTab');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useShortcutsStore.setState({
    currentBindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)) as Record<string, string>,
    draftBindings:   JSON.parse(JSON.stringify(DEFAULT_BINDINGS)) as Record<string, string>,
    reverseMap:      Object.fromEntries(
      Object.entries(DEFAULT_BINDINGS).filter(([, v]) => v !== '').map(([k, v]) => [v, k]),
    ),
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShortcutsSettingsTab', () => {
  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  it('renders all actions from ACTION_REGISTRY', () => {
    render(<ShortcutsSettingsTab />);
    for (const action of ACTION_REGISTRY) {
      expect(screen.getByText(action.label)).toBeInTheDocument();
    }
  });

  it('renders a Remap button for each action', () => {
    render(<ShortcutsSettingsTab />);
    const remapButtons = screen.getAllByText('Remap');
    expect(remapButtons).toHaveLength(ACTION_REGISTRY.length);
  });

  it('renders Reset All Shortcuts button', () => {
    render(<ShortcutsSettingsTab />);
    expect(screen.getByText('Reset All Shortcuts')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Search filter
  // -------------------------------------------------------------------------

  it('search filters by label (case-insensitive)', async () => {
    render(<ShortcutsSettingsTab />);
    const searchInput = screen.getByPlaceholderText('Search actions or keys...');

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'loop' } });
    });

    expect(screen.getByText('Toggle Loop')).toBeInTheDocument();
    // An action that doesn't match 'loop' should not be visible.
    expect(screen.queryByText('Save Project')).not.toBeInTheDocument();
  });

  it('search filters by current binding combo', async () => {
    render(<ShortcutsSettingsTab />);
    const searchInput = screen.getByPlaceholderText('Search actions or keys...');

    // 'Space' is the binding for 'Play / Stop'.
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'space' } });
    });

    expect(screen.getByText('Play / Stop')).toBeInTheDocument();
  });

  it('search shows no results when query matches nothing', async () => {
    render(<ShortcutsSettingsTab />);
    const searchInput = screen.getByPlaceholderText('Search actions or keys...');

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'zzznomatch' } });
    });

    for (const action of ACTION_REGISTRY) {
      expect(screen.queryByText(action.label)).not.toBeInTheDocument();
    }
  });

  // -------------------------------------------------------------------------
  // Remap — opens KeyCaptureModal
  // -------------------------------------------------------------------------

  it('clicking Remap opens KeyCaptureModal', async () => {
    render(<ShortcutsSettingsTab />);
    const remapButtons = screen.getAllByText('Remap');

    await act(async () => {
      fireEvent.click(remapButtons[0]);
    });

    expect(screen.getByText('Press a key combination...')).toBeInTheDocument();
  });

  it('pressing Escape in KeyCaptureModal closes it without change', async () => {
    render(<ShortcutsSettingsTab />);
    const remapButtons = screen.getAllByText('Remap');

    await act(async () => {
      fireEvent.click(remapButtons[0]);
    });

    // Modal is open.
    expect(screen.getByText('Press a key combination...')).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    // Modal should be gone.
    expect(screen.queryByText('Press a key combination...')).not.toBeInTheDocument();
    // No binding should have changed.
    expect(mockUpdateShortcuts).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Conflict detection
  // -------------------------------------------------------------------------

  it('ConflictDialog shown when captured combo conflicts with another action', async () => {
    render(<ShortcutsSettingsTab />);

    // Click Remap for "Toggle Loop" (currently bound to 'L').
    const toggleLoopLabel = screen.getByText('Toggle Loop');
    const row = toggleLoopLabel.closest('div[class*="flex items-center"]') as HTMLElement;
    const remapBtn = within(row).getByText('Remap');

    await act(async () => {
      fireEvent.click(remapBtn);
    });

    // Simulate pressing 'Space' — which is already bound to 'Play / Stop'.
    await act(async () => {
      fireEvent.keyDown(document, { key: ' ', code: 'Space' }, { capture: true });
    });

    // ConflictDialog should appear — check for the alert role and conflict message.
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/already assigned to/i);
    expect(alert).toHaveTextContent('Play / Stop');
  });

  // -------------------------------------------------------------------------
  // Reset button
  // -------------------------------------------------------------------------

  it('Reset button restores default for single action', async () => {
    // Manually modify a binding so the Reset button appears.
    await act(async () => {
      useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    });

    render(<ShortcutsSettingsTab />);

    // The reset button should be visible (opacity-100) for the modified action.
    const resetBtn = screen.getByLabelText('Reset Play / Stop to default');

    await act(async () => {
      fireEvent.click(resetBtn);
    });

    expect(useShortcutsStore.getState().draftBindings['transport.play_stop']).toBe('Space');
    expect(mockUpdateShortcuts).toHaveBeenCalled();
  });

  it('Reset All Shortcuts restores all defaults', async () => {
    await act(async () => {
      useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
      useShortcutsStore.getState().setDraftBinding('project.save', 'Ctrl+Alt+S');
    });

    render(<ShortcutsSettingsTab />);

    await act(async () => {
      fireEvent.click(screen.getByText('Reset All Shortcuts'));
    });

    const { draftBindings } = useShortcutsStore.getState();
    expect(draftBindings['transport.play_stop']).toBe('Space');
    expect(draftBindings['project.save']).toBe('Ctrl+S');
    expect(mockUpdateShortcuts).toHaveBeenCalled();
  });
});
