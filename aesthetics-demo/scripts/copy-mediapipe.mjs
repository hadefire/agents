import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const destination = resolve(root, "public/mediapipe/wasm");

if (!existsSync(source)) {
  throw new Error("MediaPipe WASM not found. Run npm install first.");
}

mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true, force: true });
console.log("MediaPipe WASM copied to public/mediapipe/wasm");
