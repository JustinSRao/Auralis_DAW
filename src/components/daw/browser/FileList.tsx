import { useMemo, useState } from "react";
import type { FileEntry } from "@/lib/ipc";

interface FileListProps {
  entries: FileEntry[];
  searchQuery: string;
  previewingPath: string | null;
  currentPath: string;
  onNavigate: (path: string) => void;
  onPreview: (path: string) => void;
  onStopPreview: () => void;
  onAddFavorite: (path: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function Breadcrumb({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  if (!currentPath) {
    return (
      <div className="px-2 py-1 text-[9px] font-mono text-[#5b8def] bg-[#2a2a2a] border-b border-[#3a3a3a]">
        DRIVES
      </div>
    );
  }

  // Normalize separators
  const normalized = currentPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 bg-[#2a2a2a] border-b border-[#3a3a3a] overflow-x-auto flex-shrink-0">
      <button
        onClick={() => onNavigate("")}
        className="text-[9px] font-mono text-[#5b8def] hover:text-[#7baaf7] transition-colors flex-shrink-0"
      >
        ⊞
      </button>
      {parts.map((part, i) => {
        // Rebuild path up to this segment
        const segPath =
          normalized.startsWith("/")
            ? "/" + parts.slice(0, i + 1).join("/")
            : parts.slice(0, i + 1).join("/") + (i === 0 && part.endsWith(":") ? "\\" : "");
        return (
          <span key={i} className="flex items-center gap-0.5 flex-shrink-0">
            <span className="text-[9px] font-mono text-[#444444]">/</span>
            <button
              onClick={() => onNavigate(segPath)}
              className="text-[9px] font-mono text-[#888888] hover:text-[#cccccc] transition-colors max-w-[60px] truncate"
              title={segPath}
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function FileList({
  entries,
  searchQuery,
  previewingPath,
  currentPath,
  onNavigate,
  onPreview,
  onStopPreview,
  onAddFavorite,
}: FileListProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);

  const filtered = useMemo(() => {
    const safe = entries ?? [];
    if (!searchQuery) return safe;
    const q = searchQuery.toLowerCase();
    return safe.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden relative"
      onClick={() => setContextMenu(null)}
    >
      <Breadcrumb currentPath={currentPath} onNavigate={(p) => {
        if (!p) onNavigate("");
        else onNavigate(p);
      }} />

      <div className="flex-1 overflow-y-auto">
        {filtered.map((entry) => {
          if (entry.is_dir) {
            return (
              <div
                key={entry.path}
                className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-[#2a2a2a] cursor-pointer group"
                onDoubleClick={() => onNavigate(entry.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, path: entry.path });
                }}
              >
                <span className="text-[#888888] text-[10px]">▶</span>
                <span
                  className="flex-1 text-[10px] font-mono text-[#aaaaaa] truncate group-hover:text-[#cccccc] transition-colors"
                  title={entry.path}
                  onClick={() => onNavigate(entry.path)}
                >
                  {entry.name}
                </span>
              </div>
            );
          }

          const isPreviewing = previewingPath === entry.path;
          const opacity = entry.is_audio ? "" : "opacity-40";

          return (
            <div
              key={entry.path}
              className={`flex items-center gap-1.5 px-2 py-0.5 hover:bg-[#2a2a2a] ${opacity}`}
              draggable={entry.is_audio}
              onDragStart={(e) => {
                if (entry.is_audio) {
                  e.dataTransfer.setData("application/x-daw-filepath", entry.path);
                  e.dataTransfer.effectAllowed = "copy";
                }
              }}
            >
              <span className="text-[#666666] text-[9px]">♪</span>
              <span
                className="flex-1 text-[10px] font-mono text-[#aaaaaa] truncate"
                title={entry.path}
              >
                {entry.name}
              </span>
              <span className="text-[9px] font-mono text-[#555555] flex-shrink-0">
                {formatSize(entry.size)}
              </span>
              {entry.is_audio && (
                <button
                  onClick={() => (isPreviewing ? onStopPreview() : onPreview(entry.path))}
                  className={[
                    "text-[9px] flex-shrink-0 transition-colors",
                    isPreviewing
                      ? "text-[#5b8def] hover:text-red-400"
                      : "text-[#555555] hover:text-[#5b8def]",
                  ].join(" ")}
                  aria-label={isPreviewing ? "Stop preview" : "Preview"}
                >
                  {isPreviewing ? "■" : "▶"}
                </button>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="px-3 py-2 text-[9px] font-mono text-[#555555]">
            {searchQuery ? "No matches" : "Empty folder"}
          </p>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#2a2a2a] border border-[#4a4a4a] rounded shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1 text-[10px] font-mono text-[#aaaaaa] hover:bg-[#3a3a3a] hover:text-[#cccccc] transition-colors"
            onClick={() => {
              onAddFavorite(contextMenu.path);
              setContextMenu(null);
            }}
          >
            ★ Add to Favorites
          </button>
        </div>
      )}
    </div>
  );
}
