import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { dist } from "./geometry";
import type { FrontFace, Pt } from "./types";

export type FaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Detection = {
  face: FrontFace;
  bounds: FaceBounds | null;
  irisDiameterPx: number | null;
  intercanthalPx: number;
  source: "mediapipe" | "fallback";
};

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export function faceBoundsFromLandmarks(
  landmarks: { x: number; y: number }[],
  width: number,
  height: number,
): FaceBounds | null {
  const valid = landmarks.filter((landmark) => Number.isFinite(landmark.x) && Number.isFinite(landmark.y));
  if (!valid.length || width <= 0 || height <= 0) return null;
  const xs = valid.map((landmark) => landmark.x * width);
  const ys = valid.map((landmark) => landmark.y * height);
  const left = Math.max(0, Math.min(...xs));
  const top = Math.max(0, Math.min(...ys));
  const right = Math.min(width, Math.max(...xs));
  const bottom = Math.min(height, Math.max(...ys));
  const boxWidth = right - left;
  const boxHeight = bottom - top;
  if (boxWidth <= 0 || boxHeight <= 0) return null;
  const padX = boxWidth * 0.04;
  const padY = boxHeight * 0.04;
  const x = Math.max(0, left - padX);
  const y = Math.max(0, top - padY);
  return {
    x,
    y,
    width: Math.min(width, right + padX) - x,
    height: Math.min(height, bottom + padY) - y,
  };
}

function getLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = FilesetResolver.forVisionTasks("/mediapipe/wasm").then((vision) =>
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "CPU" },
        runningMode: "IMAGE",
        numFaces: 1,
      }),
    );
  }
  return landmarkerPromise;
}

function point(landmarks: { x: number; y: number; z: number }[], index: number, w: number, h: number): Pt {
  const p = landmarks[index];
  return { x: p.x * w, y: p.y * h, z: p.z * w };
}

export async function detectFront(image: HTMLCanvasElement | HTMLImageElement | ImageBitmap, width: number, height: number): Promise<Detection | null> {
  try {
    const landmarker = await getLandmarker();
    const result = landmarker.detect(image);
    const landmarks = result.faceLandmarks[0];
    if (!landmarks) return null;
    const p = (index: number) => point(landmarks, index, width, height);
    const face: FrontFace = {
      imageLeftEye: { outer: p(33), inner: p(133), upper: p(159), brow: p(105), iris: p(468) },
      imageRightEye: { outer: p(263), inner: p(362), upper: p(386), brow: p(334), iris: p(473) },
      noseTip: p(1),
      noseBridge: p(6),
      alarLeft: p(98),
      alarRight: p(327),
      subnasale: p(2),
      mouthLeft: p(61),
      mouthRight: p(291),
      cupid: p(0),
      upperMid: p(13),
      lowerMid: p(17),
    };
    const leftIris = dist(p(469), p(471));
    const rightIris = dist(p(474), p(476));
    return {
      face,
      bounds: faceBoundsFromLandmarks(landmarks, width, height),
      irisDiameterPx: (leftIris + rightIris) / 2,
      intercanthalPx: dist(face.imageLeftEye.inner, face.imageRightEye.inner),
      source: "mediapipe",
    };
  } catch (error) {
    console.warn("Face Landmarker unavailable; using relative fallback.", error);
    return null;
  }
}
