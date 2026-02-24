import { useCallback, useEffect, useState } from "react";
import { useFileStore } from "@/stores/fileStore";

export function ProjectToolbar() {
  const {
    filePath,
    isDirty,
    currentProject,
    recentProjects,
    error,
    createNewProject,
    save,
    open,
    loadRecentProjects,
    setError,
  } = useFileStore();

  const [showRecent, setShowRecent] = useState(false);

  useEffect(() => {
    loadRecentProjects();
  }, [loadRecentProjects]);

  const handleNew = useCallback(async () => {
    await createNewProject("Untitled Project");
  }, [createNewProject]);

  const handleSave = useCallback(async () => {
    if (!currentProject) return;
    if (filePath) {
      await save(filePath);
    }
    // If no filePath, "Save As" should be triggered via native dialog
    // (handled at the app level with @tauri-apps/plugin-dialog)
  }, [currentProject, filePath, save]);

  const handleOpen = useCallback(
    async (path: string) => {
      await open(path);
      setShowRecent(false);
    },
    [open],
  );

  const projectName = currentProject?.name ?? "No Project";

  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        onClick={handleNew}
        className="px-2 py-1 text-[#cccccc] hover:bg-[#3a3a3a] rounded transition-colors"
        title="New Project"
      >
        New
      </button>

      <button
        onClick={handleSave}
        disabled={!currentProject}
        className="px-2 py-1 text-[#cccccc] hover:bg-[#3a3a3a] rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="Save Project"
      >
        Save
      </button>

      <div className="relative">
        <button
          onClick={() => setShowRecent(!showRecent)}
          className="px-2 py-1 text-[#cccccc] hover:bg-[#3a3a3a] rounded transition-colors"
          title="Open Recent Project"
        >
          Open
        </button>

        {showRecent && recentProjects.length > 0 && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-[#2d2d2d] border border-[#3a3a3a] rounded shadow-lg z-50">
            {recentProjects.map((rp) => (
              <button
                key={rp.file_path}
                onClick={() => handleOpen(rp.file_path)}
                className="w-full text-left px-3 py-2 text-[#cccccc] hover:bg-[#3a3a3a] text-xs truncate"
                title={rp.file_path}
              >
                {rp.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="text-[#888888] ml-2" title={filePath ?? "Unsaved"}>
        {projectName}
        {isDirty && <span className="text-[#ff8800] ml-1">*</span>}
      </span>

      {error && (
        <span className="text-[#ff4444] text-xs ml-2">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-1 text-[#888888] hover:text-[#cccccc]"
          >
            x
          </button>
        </span>
      )}
    </div>
  );
}
