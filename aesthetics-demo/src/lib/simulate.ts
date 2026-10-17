import {
  creaseOffsets,
  faceCenterX,
  lidPolyline,
  lipPolylines,
  moveAlar,
  profileNose,
  projectionPx,
  cornerMove,
} from "./geometry";
import { EYELID_DESIGN_MM, NOSE_LEVELS } from "./params";
import type { FrontFace, Pt, Raster, SideFace, SimRequest } from "./types";
import { DISCLAIMER } from "./types";
import { shadeSegment, strokePolyline, warpEllipse } from "./warp";

function ellipseOf(pts: Pt[], pad: number): { c: Pt; rx: number; ry: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    c: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    rx: (maxX - minX) / 2 + pad,
    ry: (maxY - minY) / 2 + pad,
  };
}

export function simulateFront(src: Raster, face: FrontFace, request: SimRequest): Raster {
  let raster: Raster = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
  const centerX = faceCenterX(face);

  if (request.procedures.nose) {
    const alar = NOSE_LEVELS[request.noseLevel].alarMm;
    const left = moveAlar(face.alarLeft, face.noseTip.x, alar, request.pxPerMm);
    const right = moveAlar(face.alarRight, face.noseTip.x, alar, request.pxPerMm);
    const box = ellipseOf([face.alarLeft, face.alarRight, face.noseTip, face.subnasale, left, right], 18);
    raster = warpEllipse(raster, box.c, Math.max(box.rx, 24), Math.max(box.ry, 28), [
      { from: face.alarLeft, to: left },
      { from: face.alarRight, to: right },
    ]);
  }

  if (request.procedures.lip) {
    const lips = lipPolylines(face, request.lipLevel);
    const moves = [
      ...lips.upper.map((to, i) => ({ from: lipPolylines(face, "mild").upper[i] ? originalUpper(face)[i] : to, to })),
    ];
    const originalU = originalUpper(face);
    const originalL = originalLower(face);
    const lipMoves = [
      ...lips.upper.map((to, i) => ({ from: originalU[i], to })),
      ...lips.lower.map((to, i) => ({ from: originalL[i], to })),
    ].filter((m) => Math.hypot(m.from.x - m.to.x, m.from.y - m.to.y) > 0.4);
    const box = ellipseOf([...originalU, ...originalL, ...lips.upper, ...lips.lower], 16);
    raster = warpEllipse(raster, box.c, Math.max(box.rx, 20), Math.max(box.ry, 18), lipMoves);
    shadeSegment(raster, face.mouthLeft, face.cupid, [255, 246, 240, 0.18], 2.2);
    shadeSegment(raster, face.cupid, face.mouthRight, [255, 246, 240, 0.18], 2.2);
    void moves;
  }

  if (request.procedures.corner) {
    const moves = cornerMove(face, request);
    const left = moves.filter((m) => m.from.x <= centerX);
    const right = moves.filter((m) => m.from.x > centerX);
    const apply = (group: { from: Pt; to: Pt }[]) => {
      if (group.length === 0) return;
      const box = ellipseOf(
        group.flatMap((m) => [m.from, m.to]),
        22,
      );
      raster = warpEllipse(raster, box.c, Math.max(box.rx, 26), Math.max(box.ry, 26), group);
    };
    apply(left);
    apply(right);
  }

  if (request.procedures.eyelid) {
    drawEyelid(raster, face, request);
  }
  return raster;
}

function originalUpper(face: FrontFace): Pt[] {
  return lipPolylines({ ...face }, "mild").upper.map((_, i, arr) => arr[i]);
}

function originalLower(face: FrontFace): Pt[] {
  const slit = (face.upperMid.y + face.lowerMid.y) / 2;
  const base = lipPolylines(face, "mild");
  return base.lower.map((p, i, arr) => {
    if (i === 0 || i === arr.length - 1) return { x: p.x, y: p.y };
    const extras = 0.06 * 1.6;
    const y = slit + (p.y - slit) / (1 + extras);
    return { x: p.x, y };
  });
}

function drawEyelid(raster: Raster, face: FrontFace, request: SimRequest): void {
  const centerX = faceCenterX(face);
  const design = EYELID_DESIGN_MM[request.eyelidLevel];
  for (const eye of [face.imageLeftEye, face.imageRightEye]) {
    const line = lidPolyline(eye, centerX);
    const offsets = creaseOffsets(design, request.eyelidStyle, line.length, request.pxPerMm);
    const crease = line.map((p, i) => {
      const y = p.y - offsets[i];
      const limit = eye.brow.y + 3;
      return { x: p.x, y: Math.max(limit, y) };
    });
    strokePolyline(raster, crease, [72, 48, 42, 0.72], 1.35);
    const under = crease.map((p, i) => ({ x: p.x, y: p.y + Math.max(1.5, offsets[i] * 0.18) }));
    strokePolyline(raster, under, [255, 248, 242, 0.35], 1.1);
  }
}

export function simulateSide(src: Raster, side: SideFace, request: SimRequest): Raster {
  let raster: Raster = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
  let current = side;
  if (request.procedures.nose) {
    const next = profileNose(side, request.noseLevel, request.pxPerMm);
    const box = ellipseOf([side.nasion, side.rhinion, side.tip, side.subnasale, next.rhinion, next.tip], 26);
    raster = warpEllipse(raster, box.c, Math.max(box.rx, 36), Math.max(box.ry, 40), [
      { from: side.rhinion, to: next.rhinion },
      { from: side.tip, to: next.tip },
    ]);
    shadeSegment(raster, next.rhinion, next.tip, [255, 250, 245, 0.28], 3);
    current = next;
  }
  if (request.procedures.lip) {
    const dir = side.facing === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 };
    const px = projectionPx(request.pxPerMm);
    const to = { x: current.lip.x + dir.x * px, y: current.lip.y };
    const box = ellipseOf([current.lip, to, current.subnasale], 20);
    raster = warpEllipse(raster, box.c, Math.max(box.rx, 22), Math.max(box.ry, 18), [
      { from: current.lip, to },
    ]);
  }
  return raster;
}

export function withFooter(src: Raster, text = DISCLAIMER): Raster {
  const footer = 36;
  const out: Raster = {
    width: src.width,
    height: src.height + footer,
    data: new Uint8ClampedArray((src.height + footer) * src.width * 4),
  };
  out.data.set(src.data);
  for (let i = src.data.length; i < out.data.length; i += 4) {
    out.data[i] = 28;
    out.data[i + 1] = 36;
    out.data[i + 2] = 34;
    out.data[i + 3] = 255;
  }
  stampText(out, text, 12, src.height + 24);
  return out;
}

function stampText(raster: Raster, text: string, x: number, baseline: number): void {
  const canvas = new OffscreenCanvas(raster.width, raster.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height);
  ctx.putImageData(image, 0, 0);
  ctx.fillStyle = "#f4f1ea";
  ctx.font = "14px sans-serif";
  ctx.fillText(text, x, baseline);
  const next = ctx.getImageData(0, 0, raster.width, raster.height);
  raster.data.set(next.data);
}

export function rasterToCanvas(raster: Raster): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
  return canvas;
}
