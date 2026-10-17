export type Pt = { x: number; y: number; z?: number };

export type Level = "mild" | "typical" | "strong";

export type Raster = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type EyePts = {
  outer: Pt;
  inner: Pt;
  upper: Pt;
  brow: Pt;
  iris: Pt;
};

export type FrontFace = {
  imageLeftEye: EyePts;
  imageRightEye: EyePts;
  noseTip: Pt;
  noseBridge: Pt;
  alarLeft: Pt;
  alarRight: Pt;
  subnasale: Pt;
  mouthLeft: Pt;
  mouthRight: Pt;
  cupid: Pt;
  upperMid: Pt;
  lowerMid: Pt;
};

export type Facing = "left" | "right";

export type SideFace = {
  facing: Facing;
  nasion: Pt;
  rhinion: Pt;
  tip: Pt;
  subnasale: Pt;
  lip: Pt;
};

export type CornerMode = "injection" | "surgery";

export type ProcedureSelection = {
  eyelid: boolean;
  nose: boolean;
  lip: boolean;
  corner: boolean;
};

export type SimRequest = {
  procedures: ProcedureSelection;
  eyelidLevel: Level;
  eyelidStyle: "infold" | "parallel";
  noseLevel: Level;
  lipLevel: Level;
  cornerMode: CornerMode;
  cornerLevel: Level;
  pxPerMm: number;
};

export const DISCLAIMER = "模拟效果，非医疗建议，不作为手术承诺";

export const IRIS_DIAMETER_MM = 11.7;
