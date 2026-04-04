import { beforeEach, describe, expect, it } from 'vitest';
import { useShortcutsStore } from '../shortcutsStore';
import { DEFAULT_BINDINGS } from '../../lib/shortcuts';

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
// Tests
// ---------------------------------------------------------------------------

describe('shortcutsStore', () => {
  beforeEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // hydrate
  // -------------------------------------------------------------------------

  it('hydrate merges saved bindings over defaults', () => {
    useShortcutsStore.getState().hydrate({ 'transport.play_stop': 'P' });
    const { currentBindings, draftBindings } = useShortcutsStore.getState();

    // Overridden action uses the saved value.
    expect(currentBindings['transport.play_stop']).toBe('P');
    expect(draftBindings['transport.play_stop']).toBe('P');

    // Unmentioned actions still have their defaults.
    expect(currentBindings['project.save']).toBe(DEFAULT_BINDINGS['project.save']);
  });

  it('hydrate rebuilds reverseMap from merged bindings', () => {
    useShortcutsStore.getState().hydrate({ 'transport.play_stop': 'P' });
    const { reverseMap } = useShortcutsStore.getState();

    expect(reverseMap['P']).toBe('transport.play_stop');
    // Old default combo 'Space' should no longer point to play_stop.
    expect(reverseMap['Space']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // setDraftBinding
  // -------------------------------------------------------------------------

  it('setDraftBinding updates draftBindings', () => {
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    expect(useShortcutsStore.getState().draftBindings['transport.play_stop']).toBe('P');
  });

  it('setDraftBinding does not affect currentBindings', () => {
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    expect(useShortcutsStore.getState().currentBindings['transport.play_stop']).toBe('Space');
  });

  it('setDraftBinding unbinds conflicting action (set to empty string)', () => {
    // 'L' is the default for 'transport.loop'.
    // Remap 'transport.follow' (default 'F') to 'L'.
    useShortcutsStore.getState().setDraftBinding('transport.follow', 'L');
    const { draftBindings } = useShortcutsStore.getState();

    expect(draftBindings['transport.follow']).toBe('L');
    // The action that previously had 'L' should now be unbound.
    expect(draftBindings['transport.loop']).toBe('');
  });

  // -------------------------------------------------------------------------
  // findConflict
  // -------------------------------------------------------------------------

  it('findConflict returns conflicting actionId', () => {
    // 'Space' is bound to 'transport.play_stop' by default.
    const conflict = useShortcutsStore.getState().findConflict('Space', 'transport.loop');
    expect(conflict).toBe('transport.play_stop');
  });

  it('findConflict returns null when no conflict', () => {
    const conflict = useShortcutsStore.getState().findConflict('F12', 'transport.loop');
    expect(conflict).toBeNull();
  });

  it('findConflict excludes the provided actionId from the search', () => {
    // 'Space' is bound to 'transport.play_stop'.
    // When remapping 'transport.play_stop' itself to 'Space', there should be no conflict.
    const conflict = useShortcutsStore.getState().findConflict('Space', 'transport.play_stop');
    expect(conflict).toBeNull();
  });

  // -------------------------------------------------------------------------
  // resetOne
  // -------------------------------------------------------------------------

  it('resetOne restores default for single action', () => {
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    useShortcutsStore.getState().resetOne('transport.play_stop');
    expect(useShortcutsStore.getState().draftBindings['transport.play_stop']).toBe('Space');
  });

  it('resetOne does not affect other actions', () => {
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    useShortcutsStore.getState().setDraftBinding('project.save', 'Ctrl+Alt+S');
    useShortcutsStore.getState().resetOne('transport.play_stop');

    expect(useShortcutsStore.getState().draftBindings['project.save']).toBe('Ctrl+Alt+S');
  });

  // -------------------------------------------------------------------------
  // resetAll
  // -------------------------------------------------------------------------

  it('resetAll restores all defaults', () => {
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    useShortcutsStore.getState().setDraftBinding('project.save', 'Ctrl+Alt+S');
    useShortcutsStore.getState().resetAll();

    const { draftBindings } = useShortcutsStore.getState();
    expect(draftBindings['transport.play_stop']).toBe('Space');
    expect(draftBindings['project.save']).toBe('Ctrl+S');
  });

  it('resetAll does not change currentBindings', () => {
    useShortcutsStore.getState().commitDraft(); // make current match defaults
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    useShortcutsStore.getState().resetAll();

    // currentBindings should still reflect the last committed state.
    expect(useShortcutsStore.getState().currentBindings['transport.play_stop']).toBe('Space');
  });

  // -------------------------------------------------------------------------
  // commitDraft
  // -------------------------------------------------------------------------

  it('commitDraft updates currentBindings from draftBindings', () => {
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    useShortcutsStore.getState().commitDraft();
    expect(useShortcutsStore.getState().currentBindings['transport.play_stop']).toBe('P');
  });

  it('commitDraft rebuilds reverseMap', () => {
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    useShortcutsStore.getState().commitDraft();
    const { reverseMap } = useShortcutsStore.getState();

    expect(reverseMap['P']).toBe('transport.play_stop');
    expect(reverseMap['Space']).toBeUndefined();
  });

  it('commitDraft excludes empty-string bindings from reverseMap', () => {
    // Unbind 'transport.loop'.
    useShortcutsStore.getState().setDraftBinding('transport.loop', '');
    useShortcutsStore.getState().commitDraft();
    const { reverseMap } = useShortcutsStore.getState();

    // '' should not appear as a key in reverseMap.
    expect(Object.keys(reverseMap).includes('')).toBe(false);
    expect(reverseMap['L']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // discardDraft
  // -------------------------------------------------------------------------

  it('discardDraft resets draftBindings to currentBindings', () => {
    // Commit a known state.
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    useShortcutsStore.getState().commitDraft();

    // Make a new draft change and then discard it.
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'Q');
    useShortcutsStore.getState().discardDraft();

    expect(useShortcutsStore.getState().draftBindings['transport.play_stop']).toBe('P');
  });

  it('discardDraft does not change currentBindings', () => {
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'P');
    useShortcutsStore.getState().commitDraft();
    useShortcutsStore.getState().setDraftBinding('transport.play_stop', 'Q');
    useShortcutsStore.getState().discardDraft();

    expect(useShortcutsStore.getState().currentBindings['transport.play_stop']).toBe('P');
  });
});
