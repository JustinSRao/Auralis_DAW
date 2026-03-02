import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Knob } from "../Knob";

// jsdom does not implement setPointerCapture — polyfill for Knob's onPointerDown handler.
beforeEach(() => {
  SVGElement.prototype.setPointerCapture = vi.fn();
  SVGElement.prototype.releasePointerCapture = vi.fn();
});

describe("Knob", () => {
  it("renders the label text", () => {
    render(<Knob label="Attack" value={0.5} onValue={() => {}} />);
    expect(screen.getByText("Attack")).toBeTruthy();
  });

  it("exposes slider role with correct aria label", () => {
    render(<Knob label="Cutoff" value={0.5} onValue={() => {}} unit="Hz" />);
    const slider = screen.getByRole("slider", { name: /cutoff knob/i });
    expect(slider).toBeTruthy();
    expect(slider.getAttribute("aria-valuenow")).toBe("0.5");
  });

  it("renders custom displayValue when provided", () => {
    render(
      <Knob label="Volume" value={0.7} onValue={() => {}} displayValue="70%" />,
    );
    expect(screen.getByText("70%")).toBeTruthy();
  });

  it("aria-valuemin and aria-valuemax are 0 and 1", () => {
    render(<Knob label="Test" value={0.3} onValue={() => {}} />);
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuemin")).toBe("0");
    expect(slider.getAttribute("aria-valuemax")).toBe("1");
  });

  it("fires pointer event handlers without throwing", () => {
    const onValue = vi.fn();
    const { container } = render(
      <Knob label="Test" value={0.5} onValue={onValue} />,
    );
    const svg = container.querySelector("svg")!;

    // Verify the pointer handlers are wired up — they must not throw even when
    // jsdom does not supply geometry properties (clientY may be 0/NaN).
    expect(() => {
      fireEvent.pointerDown(svg, { clientY: 200 });
      fireEvent.pointerMove(svg, { clientY: 100 });
      fireEvent.pointerUp(svg);
    }).not.toThrow();
  });

  it("does not call onValue on pointer move without prior pointer down", () => {
    const onValue = vi.fn();
    const { container } = render(
      <Knob label="Test" value={0.5} onValue={onValue} />,
    );
    const svg = container.querySelector("svg")!;

    // Move without prior down — dragStartY.current is null so no call
    fireEvent.pointerMove(svg, { clientY: 100 });
    expect(onValue).not.toHaveBeenCalled();
  });

  it("renders the SVG arc element for value track", () => {
    const { container } = render(
      <Knob label="Test" value={0.5} onValue={() => {}} />,
    );
    // Should have SVG paths (background arc + value arc)
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it("renders no value arc when value is 0", () => {
    const { container } = render(
      <Knob label="Test" value={0} onValue={() => {}} />,
    );
    // At value=0, only the background track path renders (no filled arc)
    const paths = container.querySelectorAll("path");
    // Background track arc only
    expect(paths.length).toBe(1);
  });
});
