import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { dist } from "./geometry";
import type { FrontFace, Pt } from "./types";

export type Detection = {
  face: FrontFace;
  irisDiameterPx: number | null;
  intercanthalPx: number;
  source: "mediapipe" | "fallback";
};

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

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
      irisDiameterPx: (leftIris + rightIris) / 2,
      intercanthalPx: dist(face.imageLeftEye.inner, face.imageRightEye.inner),
      source: "mediapipe",
    };
  } catch (error) {
    console.warn("Face Landmarker unavailable; using relative fallback.", error);
    return null;
  }
}
