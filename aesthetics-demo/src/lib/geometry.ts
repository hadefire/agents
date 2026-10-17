import {
  CORNER_SURGERY,
  EYELID_DESIGN_MM,
  GOODE_TARGET,
  LIP_PROJECTION_MM,
  LIP_VOLUME_ML,
  NASOLABIAL_TARGET,
  NOSE_LEVELS,
  cornerDegrees,
  lipExtras,
  visibleCreaseMm,
} from "./params";
import type { Facing, FrontFace, Level, Pt, SideFace, SimRequest } from "./types";

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z };
}

export function through(a: Pt, mid: Pt, c: Pt, n: number): Pt[] {
  const control = {
    x: 2 * mid.x - 0.5 * a.x - 0.5 * c.x,
    y: 2 * mid.y - 0.5 * a.y - 0.5 * c.y,
  };
  const pts: Pt[] = [];
  const count = Math.max(2, n);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const u = 1 - t;
    pts.push({
      x: u * u * a.x + 2 * u * t * control.x + t * t * c.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * c.y,
    });
  }
  return pts;
}

export function anteriorUnit(facing: Facing): Pt {
  return facing === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 };
}

export function moveAlong(p: Pt, dir: Pt, px: number): Pt {
  return { x: p.x + dir.x * px, y: p.y + dir.y * px, z: p.z };
}

export function pointLineDistance(p: Pt, a: Pt, b: Pt): number {
  const len = dist(a, b);
  if (len < 1e-6) return dist(p, a);
  const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
  const proj = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return dist(p, proj);
}

export function angleDeg(a: Pt, origin: Pt, b: Pt): number {
  const v1 = { x: a.x - origin.x, y: a.y - origin.y };
  const v2 = { x: b.x - origin.x, y: b.y - origin.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m < 1e-6) return 0;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / m));
  return (Math.acos(cos) * 180) / Math.PI;
}

function rotateAround(p: Pt, origin: Pt, deg: number): Pt {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + dx * c - dy * s,
    y: origin.y + dx * s + dy * c,
    z: p.z,
  };
}

export function aimNasolabial(tip: Pt, subnasale: Pt, lip: Pt, target: number, maxDeg: number): Pt {
  let best = tip;
  let bestErr = Math.abs(angleDeg(tip, subnasale, lip) - target);
  for (let deg = -maxDeg; deg <= maxDeg; deg += 0.5) {
    const next = rotateAround(tip, subnasale, deg);
    const err = Math.abs(angleDeg(next, subnasale, lip) - target);
    if (err < bestErr) {
      bestErr = err;
      best = next;
    }
  }
  return best;
}

export function goodeRatio(nasion: Pt, tip: Pt, subnasale: Pt): number {
  const length = dist(nasion, tip);
  if (length < 1e-6) return 0;
  return pointLineDistance(tip, nasion, subnasale) / length;
}

export function profileNose(side: SideFace, level: Level, pxPerMm: number): SideFace {
  const spec = NOSE_LEVELS[level];
  const dir = anteriorUnit(side.facing);
  const dorsumPx = spec.dorsumMm * pxPerMm;
  const rhinion = moveAlong(side.rhinion, dir, dorsumPx);
  let tip = moveAlong(side.tip, dir, dorsumPx);
  const length = Math.max(dist(side.nasion, tip), 1);
  const current = goodeRatio(side.nasion, tip, side.subnasale);
  if (current < GOODE_TARGET) {
    const extra = Math.min(4 * pxPerMm, (GOODE_TARGET - current) * length);
    tip = moveAlong(tip, dir, extra);
  }
  tip = aimNasolabial(tip, side.subnasale, side.lip, NASOLABIAL_TARGET, 12);
  return { ...side, rhinion, tip };
}

export function moveAlar(alar: Pt, midlineX: number, alarMm: number, pxPerMm: number): Pt {
  const sign = Math.sign(midlineX - alar.x) || 1;
  return { x: alar.x + sign * alarMm * pxPerMm, y: alar.y, z: alar.z };
}

export function creaseOffsets(
  designMm: number,
  style: "infold" | "parallel",
  count: number,
  pxPerMm: number,
): number[] {
  const visiblePx = visibleCreaseMm(designMm) * pxPerMm;
  return Array.from({ length: count }, (_, i) => {
    if (style === "parallel" || count === 1) return visiblePx;
    const t = i / (count - 1);
    return visiblePx * (0.25 + 0.75 * t);
  });
}

export function lidPolyline(eye: FrontFace["imageLeftEye"], centerX: number): Pt[] {
  const medial = Math.abs(eye.inner.x - centerX) <= Math.abs(eye.outer.x - centerX) ? eye.inner : eye.outer;
  const lateral = medial === eye.inner ? eye.outer : eye.inner;
  return through(medial, eye.upper, lateral, 9);
}

export function lipPolylines(face: FrontFace, level: Level): {
  upper: Pt[];
  lower: Pt[];
  pins: Pt[];
} {
  const extras = lipExtras(LIP_VOLUME_ML[level]);
  const slit = (face.upperMid.y + face.lowerMid.y) / 2;
  const upper = through(face.mouthLeft, face.cupid, face.mouthRight, 9).map((p, i, arr) => {
    if (i === 0 || i === arr.length - 1 || i === Math.floor(arr.length / 2)) return p;
    return { x: p.x, y: slit + (p.y - slit) * (1 + extras.upper) };
  });
  const lower = through(face.mouthLeft, face.lowerMid, face.mouthRight, 9).map((p, i, arr) => {
    if (i === 0 || i === arr.length - 1) return p;
    return { x: p.x, y: slit + (p.y - slit) * (1 + extras.lower) };
  });
  return {
    upper,
    lower,
    pins: [face.mouthLeft, face.mouthRight, face.cupid],
  };
}

export function liftCommissure(p: Pt, center: Pt, deg: number): Pt {
  const side = p.x <= center.x ? -1 : 1;
  return rotateAround(p, center, -side * deg);
}

export function baseLipCurves(face: FrontFace): { upper: Pt[]; lower: Pt[] } {
  return {
    upper: through(face.mouthLeft, face.cupid, face.mouthRight, 9),
    lower: through(face.mouthLeft, face.lowerMid, face.mouthRight, 9),
  };
}

export function cornerMove(face: FrontFace, request: SimRequest): { from: Pt; to: Pt }[] {
  const deg = cornerDegrees(request.cornerMode, request.cornerLevel);
  const center = {
    x: (face.mouthLeft.x + face.mouthRight.x) / 2,
    y: (face.mouthLeft.y + face.mouthRight.y) / 2,
  };
  const lift = (p: Pt) => liftCommissure(p, center, deg);
  const skin = (p: Pt) => ({ x: p.x, y: p.y - Math.abs(p.x - center.x) * 0.08 });
  return [
    { from: face.mouthLeft, to: lift(face.mouthLeft) },
    { from: face.mouthRight, to: lift(face.mouthRight) },
    { from: skin(face.mouthLeft), to: lift(skin(face.mouthLeft)) },
    { from: skin(face.mouthRight), to: lift(skin(face.mouthRight)) },
  ];
}

export function projectionPx(pxPerMm: number): number {
  return LIP_PROJECTION_MM * pxPerMm;
}

export function defaultFront(w: number, h: number): FrontFace {
  const cx = w * 0.5;
  const eyeY = h * 0.4;
  const dx = w * 0.15;
  const eye = (sign: number): FrontFace["imageLeftEye"] => ({
    outer: { x: cx + sign * (dx + w * 0.055), y: eyeY },
    inner: { x: cx + sign * (dx - w * 0.04), y: eyeY + h * 0.004 },
    upper: { x: cx + sign * dx, y: eyeY - h * 0.02 },
    brow: { x: cx + sign * dx, y: eyeY - h * 0.07 },
    iris: { x: cx + sign * dx, y: eyeY + h * 0.004 },
  });
  return {
    imageLeftEye: eye(-1),
    imageRightEye: eye(1),
    noseBridge: { x: cx, y: h * 0.46 },
    noseTip: { x: cx, y: h * 0.54 },
    alarLeft: { x: cx - w * 0.045, y: h * 0.55 },
    alarRight: { x: cx + w * 0.045, y: h * 0.55 },
    subnasale: { x: cx, y: h * 0.58 },
    mouthLeft: { x: cx - w * 0.07, y: h * 0.68 },
    mouthRight: { x: cx + w * 0.07, y: h * 0.68 },
    cupid: { x: cx, y: h * 0.655 },
    upperMid: { x: cx, y: h * 0.67 },
    lowerMid: { x: cx, y: h * 0.72 },
  };
}

export function defaultSide(w: number, h: number, facing: Facing): SideFace {
  const nose = w * (facing === "left" ? 0.38 : 0.62);
  const back = facing === "left" ? 1 : -1;
  return {
    facing,
    nasion: { x: nose + back * w * 0.16, y: h * 0.34 },
    rhinion: { x: nose + back * w * 0.08, y: h * 0.42 },
    tip: { x: nose, y: h * 0.5 },
    subnasale: { x: nose + back * w * 0.07, y: h * 0.56 },
    lip: { x: nose + back * w * 0.04, y: h * 0.66 },
  };
}

export function faceCenterX(face: FrontFace): number {
  return (face.imageLeftEye.inner.x + face.imageRightEye.inner.x) / 2;
}

export function eyelidDesign(level: Level): number {
  return EYELID_DESIGN_MM[level];
}

export function surgeryLimb(level: Level): number {
  return CORNER_SURGERY[level].limbMm;
}
