import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useFileStore } from '@/stores/fileStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useKeyboardStore } from '@/stores/keyboardStore';
import { useAuthStore } from '@/stores/authStore';
import { ExportMidiDialog } from './ExportMidiDialog';
import { ExportAudioDialog } from './ExportAudioDialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MenuId = 'file' | 'edit' | 'view' | 'help' | null;

// ---------------------------------------------------------------------------
// Shared class strings
// ---------------------------------------------------------------------------

const itemCls =
  'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-[#cccccc] cursor-pointer ' +
  'hover:bg-[#3a3a3a] hover:text-white outline-none select-none transition-colors ' +
  'disabled:opacity-40 disabled:pointer-events-none';

const separatorCls = 'my-1 h-px bg-[#3a3a3a] mx-1';

const dropdownCls =
  'absolute top-full left-0 mt-0 bg-[#252525] border border-[#3a3a3a] rounded shadow-2xl py-1 min-w-[180px] z-50';

// ---------------------------------------------------------------------------
// Shortcut label
// ---------------------------------------------------------------------------

function Shortcut({ keys }: { keys: string }) {
  return (
    <span className="ml-auto pl-4 text-[#666666] text-[10px] font-mono">
      {keys}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MenuBar
// ---------------------------------------------------------------------------

/**
 * Application-level menu bar with File, Edit, View, and Help menus.
 *
 * Implemented with plain React state and native `<button>` elements for full
 * test-environment compatibility (no Radix Portal dependency on the menu bar).
 * All actions delegate to the appropriate Zustand store — no direct IPC calls.
 */
export function MenuBar() {
  const { filePath, recentProjects, save, open, createNewProject } = useFileStore();
  const { canUndo, canRedo, undo, redo } = useHistoryStore();
  const { browserOpen, mixerOpen, toggleBrowser, toggleMixer } = useKeyboardStore();
  const { currentUser, logout } = useAuthStore();

  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const [exportMidiOpen, setExportMidiOpen]   = useState(false);
  const [exportAudioOpen, setExportAudioOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!openMenu) return;
    function handleMouseDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [openMenu]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenu(null);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  function toggleMenu(id: MenuId) {
    setOpenMenu((prev) => (prev === id ? null : id));
  }

  function closeMenu() {
    setOpenMenu(null);
  }

  // ---------------------------------------------------------------------------
  // File actions
  // ---------------------------------------------------------------------------

  function handleNew() {
    closeMenu();
    void createNewProject('Untitled Project');
  }

  function handleSave() {
    closeMenu();
    if (filePath) void save(filePath);
  }

  function handleOpenRecent(path: string) {
    closeMenu();
    void open(path);
  }

  function handleExportMidi() {
    closeMenu();
    setExportMidiOpen(true);
  }

  function handleExportAudio() {
    closeMenu();
    setExportAudioOpen(true);
  }

  // ---------------------------------------------------------------------------
  // Edit actions
  // ---------------------------------------------------------------------------

  function handleUndo() {
    closeMenu();
    undo();
  }

  function handleRedo() {
    closeMenu();
    redo();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
    <div
      ref={barRef}
      className="h-8 bg-[#1a1a1a] border-b border-[#333333] flex items-center px-1 flex-shrink-0 z-30"
      role="menubar"
    >
      {/* Brand */}
      <span className="text-[#6c63ff] font-bold text-sm px-2 mr-1 select-none">
        MusicApp
      </span>

      {/* ── File ── */}
      <div className="relative">
        <button
          onClick={() => toggleMenu('file')}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'file'}
          className="px-2 h-8 text-xs text-[#cccccc] hover:bg-[#2d2d2d] rounded transition-colors outline-none"
        >
          File
        </button>

        {openMenu === 'file' && (
          <div className={dropdownCls} role="menu">
            <button role="menuitem" className={itemCls} onClick={handleNew}>
              New Project
              <Shortcut keys="Ctrl+N" />
            </button>

            <button
              role="menuitem"
              className={itemCls}
              onClick={closeMenu}
            >
              Open...
              <Shortcut keys="Ctrl+O" />
            </button>

            <button
              role="menuitem"
              className={itemCls}
              onClick={handleSave}
              disabled={!filePath}
            >
              Save
              <Shortcut keys="Ctrl+S" />
            </button>

            <button
              role="menuitem"
              className={itemCls}
              onClick={closeMenu}
            >
              Save As...
              <Shortcut keys="Ctrl+Shift+S" />
            </button>

            <div className={separatorCls} role="separator" />
            <button role="menuitem" className={itemCls} onClick={handleExportAudio}>
              Export Audio...
            </button>
            <button role="menuitem" className={itemCls} onClick={handleExportMidi}>
              Export MIDI...
            </button>

            {recentProjects.length > 0 && (
              <>
                <div className={separatorCls} role="separator" />
                <div className="relative group">
                  <button role="menuitem" className={itemCls}>
                    Recent Projects
                    <ChevronRight size={12} className="ml-auto" />
                  </button>
                  <div className="absolute left-full top-0 hidden group-hover:block bg-[#252525] border border-[#3a3a3a] rounded shadow-2xl py-1 min-w-[200px]">
                    {recentProjects.slice(0, 5).map((rp) => (
                      <button
                        key={rp.file_path}
                        role="menuitem"
                        className={itemCls}
                        onClick={() => handleOpenRecent(rp.file_path)}
                        title={rp.file_path}
                      >
                        <span className="truncate max-w-[180px]">{rp.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className={separatorCls} role="separator" />

            <button
              role="menuitem"
              className={itemCls}
              onClick={closeMenu}
            >
              Exit
            </button>
          </div>
        )}
      </div>

      {/* ── Edit ── */}
      <div className="relative">
        <button
          onClick={() => toggleMenu('edit')}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'edit'}
          className="px-2 h-8 text-xs text-[#cccccc] hover:bg-[#2d2d2d] rounded transition-colors outline-none"
        >
          Edit
        </button>

        {openMenu === 'edit' && (
          <div className={dropdownCls} role="menu">
            <button
              role="menuitem"
              className={itemCls}
              onClick={handleUndo}
              disabled={!canUndo}
            >
              Undo
              <Shortcut keys="Ctrl+Z" />
            </button>

            <button
              role="menuitem"
              className={itemCls}
              onClick={handleRedo}
              disabled={!canRedo}
            >
              Redo
              <Shortcut keys="Ctrl+Shift+Z" />
            </button>
          </div>
        )}
      </div>

      {/* ── View ── */}
      <div className="relative">
        <button
          onClick={() => toggleMenu('view')}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'view'}
          className="px-2 h-8 text-xs text-[#cccccc] hover:bg-[#2d2d2d] rounded transition-colors outline-none"
        >
          View
        </button>

        {openMenu === 'view' && (
          <div className={dropdownCls} role="menu">
            <button
              role="menuitem"
              className={itemCls}
              onClick={() => { closeMenu(); toggleBrowser(); }}
            >
              {browserOpen ? '✓ ' : ''}Toggle Browser
            </button>

            <button
              role="menuitem"
              className={itemCls}
              onClick={() => { closeMenu(); toggleMixer(); }}
            >
              {mixerOpen ? '✓ ' : ''}Toggle Mixer
            </button>
          </div>
        )}
      </div>

      {/* ── Help ── */}
      <div className="relative">
        <button
          onClick={() => toggleMenu('help')}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'help'}
          className="px-2 h-8 text-xs text-[#cccccc] hover:bg-[#2d2d2d] rounded transition-colors outline-none"
        >
          Help
        </button>

        {openMenu === 'help' && (
          <div className={dropdownCls} role="menu">
            <button
              role="menuitem"
              className={itemCls}
              onClick={closeMenu}
            >
              About MusicApp
            </button>
          </div>
        )}
      </div>

      {/* ── User section (right-aligned) ── */}
      <div className="ml-auto flex items-center gap-2">
        {currentUser && (
          <>
            <span className="text-xs text-[#888888]">{currentUser.username}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="text-xs text-[#888888] hover:text-[#cccccc] px-2 py-1 rounded hover:bg-[#2a2a2a] transition-colors"
            >
              Log Out
            </button>
          </>
        )}
      </div>
    </div>
    {exportAudioOpen && <ExportAudioDialog onClose={() => setExportAudioOpen(false)} />}
    {exportMidiOpen && <ExportMidiDialog onClose={() => setExportMidiOpen(false)} />}
    </>
  );
}
