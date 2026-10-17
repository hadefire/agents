import type { CornerMode, Level } from "./types";

export const EYELID_DESIGN_MM: Record<Level, number> = {
  mild: 6,
  typical: 7,
  strong: 8,
};

export const NOSE_LEVELS: Record<Level, { dorsumMm: number; alarMm: number }> = {
  mild: { dorsumMm: 2, alarMm: 2 },
  typical: { dorsumMm: 3.5, alarMm: 3 },
  strong: { dorsumMm: 5, alarMm: 4 },
};

export const GOODE_TARGET = 0.6;
export const NASOLABIAL_TARGET = 98;

export const LIP_VOLUME_ML: Record<Level, number> = {
  mild: 0.8,
  typical: 1.0,
  strong: 1.2,
};

export const LIP_PROJECTION_MM = 1;
export const LIP_UPPER_TO_LOWER = 1 / 1.6;

export const CORNER_INJECTION_DEG = 2;

export const CORNER_SURGERY: Record<Level, { limbMm: number; deg: number }> = {
  mild: { limbMm: 1, deg: 3 },
  typical: { limbMm: 3, deg: 5 },
  strong: { limbMm: 5, deg: 7 },
};

export function visibleCreaseMm(designMm: number): number {
  const clamped = Math.min(8, Math.max(6, designMm));
  return 2.6 + ((clamped - 6) / 2) * (4 - 2.6);
}

export function lipExtras(totalMl: number): { upper: number; lower: number } {
  const t = Math.min(1, Math.max(0, (totalMl - 0.8) / 0.4));
  const upper = 0.06 + t * 0.03;
  return { upper, lower: upper / LIP_UPPER_TO_LOWER };
}

export function cornerDegrees(mode: CornerMode, level: Level): number {
  if (mode === "injection") return CORNER_INJECTION_DEG;
  return CORNER_SURGERY[level].deg;
}

export function canSimulateNose(hasSidePhoto: boolean): boolean {
  return hasSidePhoto;
}

export function formatMm(value: number, calibrated: boolean): string {
  if (!calibrated) return "相对幅度";
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${text} mm`;
}

export type ScaleSource = "iris" | "icd" | "nominal";

export function resolveScale(input: {
  irisDiameterPx: number | null;
  intercanthalPx: number | null;
  intercanthalMm: number | null;
  faceWidthPx: number;
}): { pxPerMm: number; calibrated: boolean; source: ScaleSource; warning: string | null } {
  const irisScale =
    input.irisDiameterPx && input.irisDiameterPx > 2 ? input.irisDiameterPx / 11.7 : null;
  const userIcd =
    input.intercanthalMm != null &&
    input.intercanthalMm >= 20 &&
    input.intercanthalMm <= 50 &&
    input.intercanthalPx &&
    input.intercanthalPx > 2
      ? input.intercanthalPx / input.intercanthalMm
      : null;

  if (userIcd) {
    let warning: string | null = null;
    if (irisScale) {
      const implied = input.intercanthalPx! / irisScale;
      if (Math.abs(implied - input.intercanthalMm!) / input.intercanthalMm! > 0.2) {
        warning = "虹膜比例与填写的内眦间距相差超过 20%，已采用填写值。";
      }
    }
    return { pxPerMm: userIcd, calibrated: true, source: "icd", warning };
  }
  if (irisScale) {
    return { pxPerMm: irisScale, calibrated: true, source: "iris", warning: null };
  }
  return {
    pxPerMm: Math.max(input.faceWidthPx, 1) / 180,
    calibrated: false,
    source: "nominal",
    warning: null,
  };
}
