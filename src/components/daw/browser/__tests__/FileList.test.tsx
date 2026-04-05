import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileList } from "../FileList";
import type { FileEntry } from "@/lib/ipc";

const dir = (name: string): FileEntry => ({
  name,
  path: `/music/${name}`,
  size: 0,
  is_dir: true,
  is_audio: false,
});

const audioFile = (name: string): FileEntry => ({
  name,
  path: `/music/${name}`,
  size: 2048,
  is_dir: false,
  is_audio: true,
});

const nonAudio = (name: string): FileEntry => ({
  name,
  path: `/music/${name}`,
  size: 512,
  is_dir: false,
  is_audio: false,
});

describe("FileList", () => {
  const defaultProps = {
    entries: [],
    searchQuery: "",
    previewingPath: null,
    currentPath: "/music",
    onNavigate: vi.fn(),
    onPreview: vi.fn(),
    onStopPreview: vi.fn(),
    onAddFavorite: vi.fn(),
  };

  it("renders directory entries", () => {
    render(<FileList {...defaultProps} entries={[dir("drums")]} />);
    expect(screen.getByText("drums")).toBeInTheDocument();
  });

  it("renders audio file entries with play button", () => {
    render(<FileList {...defaultProps} entries={[audioFile("kick.wav")]} />);
    expect(screen.getByText("kick.wav")).toBeInTheDocument();
    expect(screen.getByLabelText("Preview")).toBeInTheDocument();
  });

  it("search query filters entries", () => {
    const entries = [audioFile("kick.wav"), audioFile("snare.wav"), audioFile("kick_hard.wav")];
    render(<FileList {...defaultProps} entries={entries} searchQuery="kick" />);
    expect(screen.getByText("kick.wav")).toBeInTheDocument();
    expect(screen.getByText("kick_hard.wav")).toBeInTheDocument();
    expect(screen.queryByText("snare.wav")).not.toBeInTheDocument();
  });

  it("clicking directory calls onNavigate", () => {
    const onNavigate = vi.fn();
    render(<FileList {...defaultProps} entries={[dir("drums")]} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("drums"));
    expect(onNavigate).toHaveBeenCalledWith("/music/drums");
  });

  it("clicking play button calls onPreview", () => {
    const onPreview = vi.fn();
    render(<FileList {...defaultProps} entries={[audioFile("kick.wav")]} onPreview={onPreview} />);
    fireEvent.click(screen.getByLabelText("Preview"));
    expect(onPreview).toHaveBeenCalledWith("/music/kick.wav");
  });

  it("shows stop button when file is previewing", () => {
    render(
      <FileList
        {...defaultProps}
        entries={[audioFile("kick.wav")]}
        previewingPath="/music/kick.wav"
      />,
    );
    expect(screen.getByLabelText("Stop preview")).toBeInTheDocument();
  });

  it("audio file row is draggable", () => {
    const { container } = render(
      <FileList {...defaultProps} entries={[audioFile("kick.wav")]} />,
    );
    const draggable = container.querySelector("[draggable='true']");
    expect(draggable).toBeInTheDocument();
  });

  it("non-audio files are not draggable", () => {
    const { container } = render(
      <FileList {...defaultProps} entries={[nonAudio("readme.txt")]} />,
    );
    const draggable = container.querySelector("[draggable='true']");
    expect(draggable).toBeNull();
  });
});
