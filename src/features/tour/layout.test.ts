import { describe, expect, it } from "vitest";
import { GAP, MARGIN, place, visible } from "./layout";
import { STEPS } from "./steps";

const VW = 1320;
const VH = 840;

describe("place", () => {
  it("puts the bubble right of a sidebar item, with the arrow pointing left at it", () => {
    const hole = { x: 10, y: 140, w: 180, h: 36 };
    const p = place(hole, 330, 200, VW, VH);
    expect(p.side).toBe("right");
    expect(p.left).toBe(hole.x + hole.w + GAP);
    expect(p.arrow.x1).toBe(p.left);
    expect(p.arrow.x2).toBeGreaterThan(hole.x + hole.w);
    expect(p.arrow.x2).toBeLessThan(p.left);
  });

  it("goes left of the settings panel on the right edge", () => {
    const hole = { x: 1000, y: 50, w: 316, h: 780 };
    const p = place(hole, 330, 220, VW, VH);
    expect(p.side).toBe("left");
    expect(p.left + 330).toBeLessThanOrEqual(hole.x - GAP + 0.001);
  });

  it("goes below a small element at the top right (the GPU status)", () => {
    const hole = { x: 1000, y: 8, w: 90, h: 28 };
    const p = place(hole, 330, 180, VW, VH);
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(hole.y + hole.h + GAP);
  });

  it("always stays inside the window", () => {
    for (const hole of [
      { x: 0, y: 0, w: VW, h: VH },
      { x: 600, y: 790, w: 100, h: 40 },
      { x: 1280, y: 400, w: 36, h: 36 },
    ]) {
      const p = place(hole, 330, 240, VW, VH);
      expect(p.left).toBeGreaterThanOrEqual(MARGIN);
      expect(p.top).toBeGreaterThanOrEqual(MARGIN);
      expect(p.left + 330).toBeLessThanOrEqual(VW - MARGIN);
      expect(p.top + 240).toBeLessThanOrEqual(VH - MARGIN);
    }
  });
});

describe("visible", () => {
  it("pads the element and clips it to the window", () => {
    expect(visible({ x: 10, y: 10, w: 100, h: 50 }, VW, VH, 6)).toEqual({ x: 4, y: 4, w: 112, h: 62 });
    expect(visible({ x: -50, y: 100, w: 100, h: 50 }, VW, VH, 6)).toEqual({ x: 2, y: 94, w: 54, h: 62 });
    expect(visible({ x: 2000, y: 100, w: 100, h: 50 }, VW, VH, 6)).toBeNull();
  });
});

describe("steps", () => {
  it("start with the welcome card and end with the closing one", () => {
    expect(STEPS[0]?.id).toBe("intro");
    expect(STEPS.at(-1)?.id).toBe("outro");
  });

  it("only open a page that the next step expects", () => {
    STEPS.forEach((step, i) => {
      if (step.go) expect(STEPS[i + 1]?.page).toBe(step.go);
    });
  });
});
