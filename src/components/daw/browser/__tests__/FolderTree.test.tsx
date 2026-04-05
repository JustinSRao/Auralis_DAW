import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FolderTree } from "../FolderTree";

describe("FolderTree", () => {
  const defaultProps = {
    favorites: [],
    recentFolders: [],
    onNavigate: vi.fn(),
    onRemoveFavorite: vi.fn(),
  };

  it("renders favorites section", () => {
    render(<FolderTree {...defaultProps} favorites={["/music/samples"]} />);
    expect(screen.getByText("samples")).toBeInTheDocument();
  });

  it("renders recent folders", () => {
    render(<FolderTree {...defaultProps} recentFolders={["/tmp/drums"]} />);
    expect(screen.getByText("drums")).toBeInTheDocument();
  });

  it("clicking favorite calls onNavigate with path", () => {
    const onNavigate = vi.fn();
    render(
      <FolderTree
        {...defaultProps}
        favorites={["/music/samples"]}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByText("samples"));
    expect(onNavigate).toHaveBeenCalledWith("/music/samples");
  });

  it("clicking recent calls onNavigate with path", () => {
    const onNavigate = vi.fn();
    render(
      <FolderTree
        {...defaultProps}
        recentFolders={["/tmp/drums"]}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByText("drums"));
    expect(onNavigate).toHaveBeenCalledWith("/tmp/drums");
  });

  it("collapse toggle hides favorites items", () => {
    render(<FolderTree {...defaultProps} favorites={["/music/samples"]} />);
    // Click the FAVORITES header to collapse
    const favHeader = screen.getByText("Favorites");
    fireEvent.click(favHeader);
    expect(screen.queryByText("samples")).not.toBeInTheDocument();
  });

  it("shows None when no favorites", () => {
    render(<FolderTree {...defaultProps} />);
    // Both sections open, both show None
    const noneItems = screen.getAllByText("None");
    expect(noneItems.length).toBeGreaterThanOrEqual(1);
  });
});
