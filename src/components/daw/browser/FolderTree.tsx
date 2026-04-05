import { useState } from "react";

interface FolderTreeProps {
  favorites: string[];
  recentFolders: string[];
  onNavigate: (path: string) => void;
  onRemoveFavorite: (path: string) => void;
}

function folderName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function CollapsibleSection({
  title,
  items,
  renderItem,
}: {
  title: string;
  items: string[];
  renderItem: (item: string, index: number) => React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b border-[#3a3a3a]">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-2 py-1 bg-[#2a2a2a] text-[9px] font-mono uppercase tracking-widest text-[#666666] hover:text-[#aaaaaa] transition-colors"
      >
        <span>{title}</span>
        <span>{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && (
        <div className="py-0.5">
          {items.length === 0 ? (
            <p className="px-3 py-1 text-[9px] font-mono text-[#555555]">None</p>
          ) : (
            items.map((item, i) => renderItem(item, i))
          )}
        </div>
      )}
    </div>
  );
}

export function FolderTree({
  favorites,
  recentFolders,
  onNavigate,
  onRemoveFavorite,
}: FolderTreeProps) {
  return (
    <div className="flex flex-col overflow-y-auto" style={{ maxHeight: 140 }}>
      <CollapsibleSection
        title="Favorites"
        items={favorites}
        renderItem={(path) => (
          <div
            key={path}
            className="group flex items-center gap-1 px-2 py-0.5 hover:bg-[#2a2a2a] cursor-pointer"
          >
            <span className="text-[#5b8def] text-[9px]">★</span>
            <span
              className="flex-1 text-[10px] font-mono text-[#aaaaaa] hover:text-[#cccccc] truncate transition-colors"
              onClick={() => onNavigate(path)}
              title={path}
            >
              {folderName(path)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFavorite(path);
              }}
              className="opacity-0 group-hover:opacity-100 text-[#555555] hover:text-red-400 text-[9px] transition-all"
              aria-label="Remove favorite"
            >
              ×
            </button>
          </div>
        )}
      />
      <CollapsibleSection
        title="Recent"
        items={recentFolders.slice(0, 5)}
        renderItem={(path) => (
          <div
            key={path}
            className="px-2 py-0.5 hover:bg-[#2a2a2a] cursor-pointer"
            onClick={() => onNavigate(path)}
            title={path}
          >
            <span className="text-[10px] font-mono text-[#aaaaaa] hover:text-[#cccccc] transition-colors truncate block">
              {folderName(path)}
            </span>
          </div>
        )}
      />
    </div>
  );
}
