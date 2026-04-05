import { useEffect, useRef, useState } from "react";
import { useBrowserStore } from "@/stores/browserStore";
import { ipcGetAppConfig } from "@/lib/ipc";
import { FolderTree } from "@/components/daw/browser/FolderTree";
import { FileList } from "@/components/daw/browser/FileList";

/**
 * Dockable sample browser panel (Sprint 28).
 *
 * Shows pinned favorites and recent folders at the top, then a navigable
 * file list below. Clicking an audio file previews it; dragging it passes
 * `application/x-daw-filepath` to drop targets such as SamplerPanel.
 */
export function BrowserPanel() {
  const {
    currentPath,
    fileEntries,
    favorites,
    recentFolders,
    searchQuery,
    isLoading,
    error,
    previewingPath,
    navigate,
    loadDrives,
    setSearch,
    addFavorite,
    removeFavorite,
    startPreview,
    stopPreview,
    hydrateFromConfig,
  } = useBrowserStore();

  // Hydrate favorites/recents from saved config on mount
  useEffect(() => {
    ipcGetAppConfig()
      .then((cfg) => {
        hydrateFromConfig(cfg?.browser ?? { favorites: [], recentFolders: [] });
        void loadDrives();
      })
      .catch(() => {
        void loadDrives();
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize handle
  const [panelWidth, setPanelWidth] = useState(240);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: panelWidth };
    const onMove = (me: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = me.clientX - resizeRef.current.startX;
      setPanelWidth(Math.min(480, Math.max(180, resizeRef.current.startWidth + delta)));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleNavigate = (path: string) => {
    if (!path) {
      void loadDrives();
    } else {
      void navigate(path);
    }
  };

  return (
    <div
      className="flex flex-col bg-[#1e1e1e] overflow-hidden select-none relative flex-1"
      style={{ width: panelWidth }}
      data-panel="browser"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 bg-[#2a2a2a] border-b border-[#3a3a3a] flex-shrink-0">
        <span className="text-[9px] font-mono uppercase tracking-widest text-[#666666]">
          BROWSER
        </span>
        {isLoading && (
          <span className="text-[9px] font-mono text-[#5b8def]">…</span>
        )}
      </div>

      {/* Search */}
      <div className="px-2 py-1 border-b border-[#3a3a3a] flex-shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files…"
          className="w-full bg-[#2a2a2a] text-[10px] font-mono text-[#aaaaaa] placeholder-[#555555] px-2 py-0.5 rounded outline-none border border-[#3a3a3a] focus:border-[#5b8def] transition-colors"
        />
      </div>

      {/* Folder tree — favorites + recents */}
      <div className="flex-shrink-0">
        <FolderTree
          favorites={favorites}
          recentFolders={recentFolders}
          onNavigate={handleNavigate}
          onRemoveFavorite={(path) => void removeFavorite(path)}
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-2 py-1 text-[9px] font-mono text-red-400 bg-red-900/20 flex-shrink-0">
          {error}
        </div>
      )}

      {/* File list */}
      <FileList
        entries={fileEntries}
        searchQuery={searchQuery}
        previewingPath={previewingPath}
        currentPath={currentPath}
        onNavigate={handleNavigate}
        onPreview={(path) => void startPreview(path)}
        onStopPreview={() => void stopPreview()}
        onAddFavorite={(path) => void addFavorite(path)}
      />

      {/* Resize handle on right edge */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[#5b8def]/40 transition-colors"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}
