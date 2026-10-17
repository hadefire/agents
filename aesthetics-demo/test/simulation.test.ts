import { describe, expect, it } from "vitest";
import {
  baseLipCurves,
  defaultFront,
  defaultSide,
  liftCommissure,
  lipPolylines,
  profileNose,
} from "../src/lib/geometry";
import {
  cornerDegrees,
  lipExtras,
  resolveScale,
  visibleCreaseMm,
} from "../src/lib/params";
import { warpEllipse } from "../src/lib/warp";
import type { Raster } from "../src/lib/types";

describe("parameter compiler", () => {
  it("maps 6–8 mm designs to a visible crease no wider than 4 mm", () => {
    expect(visibleCreaseMm(6)).toBeCloseTo(2.6);
    expect(visibleCreaseMm(7)).toBeCloseTo(3.3);
    expect(visibleCreaseMm(8)).toBeCloseTo(4);
  });

  it("keeps injection and surgery corner angles independent", () => {
    expect(cornerDegrees("injection", "strong")).toBe(2);
    expect(cornerDegrees("surgery", "mild")).toBe(3);
    expect(cornerDegrees("surgery", "strong")).toBe(7);
  });

  it("prefers operator calibration and flags a large iris discrepancy", () => {
    const scale = resolveScale({
      irisDiameterPx: 40,
      intercanthalPx: 160,
      intercanthalMm: 32,
      faceWidthPx: 720,
    });
    expect(scale.source).toBe("icd");
    expect(scale.pxPerMm).toBe(5);
    expect(scale.warning).toContain("20%");
  });
});

describe("procedure geometry", () => {
  it("lifts both commissures upward in screen coordinates", () => {
    const center = { x: 50, y: 50 };
    expect(liftCommissure({ x: 20, y: 50 }, center, 5).y).toBeLessThan(50);
    expect(liftCommissure({ x: 80, y: 50 }, center, 5).y).toBeLessThan(50);
  });

  it("pins lip corners while strong volume exceeds mild volume", () => {
    const face = defaultFront(720, 840);
    const base = baseLipCurves(face);
    const mild = lipPolylines(face, "mild");
    const strong = lipPolylines(face, "strong");
    expect(mild.upper[0]).toEqual(base.upper[0]);
    expect(strong.lower.at(-1)).toEqual(base.lower.at(-1));
    expect(Math.abs(strong.lower[4].y - face.upperMid.y)).toBeGreaterThan(
      Math.abs(mild.lower[4].y - face.upperMid.y),
    );
    expect(lipExtras(1.2).lower).toBeGreaterThan(lipExtras(0.8).lower);
  });

  it("moves a left-facing nose anteriorly and keeps profile points on-canvas", () => {
    const side = defaultSide(720, 840, "left");
    const result = profileNose(side, "typical", 4);
    expect(side.tip.x).toBeGreaterThan(100);
    expect(result.rhinion.x).toBeLessThan(side.rhinion.x);
    expect(result.tip.x).toBeLessThan(side.tip.x);
  });
});

describe("local raster warp", () => {
  it("preserves pixels outside the editing ellipse", () => {
    const raster: Raster = {
      width: 8,
      height: 8,
      data: new Uint8ClampedArray(8 * 8 * 4),
    };
    raster.data.fill(110);
    const warped = warpEllipse(raster, { x: 4, y: 4 }, 2, 2, [
      { from: { x: 4, y: 4 }, to: { x: 5, y: 4 } },
    ]);
    expect(Array.from(warped.data.slice(0, 4))).toEqual(Array.from(raster.data.slice(0, 4)));
  });
});
