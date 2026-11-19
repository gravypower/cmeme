// Browser-side types and helpers shared by the wizard components.

export type FaceBox = {
  box: [number, number, number, number];
  kind?: "real" | "cartoon" | "manual";
};

export type ModelKind = "swapper" | "enhancer" | "occluder" | "upscaler";

export type ModelInfo = {
  id: string;
  kind: ModelKind;
  name: string;
  description: string;
  size_mb: number;
  license: string;
  default: boolean;
  status: "installed" | "missing" | "downloading" | "error";
  progress?: number;
  error?: string | null;
};

export type ModelsResponse = {
  models: ModelInfo[];
  device: "cpu" | "gpu";
  downloads_allowed: boolean;
};

export type SwapOptions = {
  swapModel: string;
  enhancer: string; // model id or "none"
  enhancerBlend: number; // 0–100
  occlusion: boolean;
  upscaler: string; // model id or "none"
};

export type SwapInfo = {
  faces_swapped: number;
  swap_model: string;
  enhancer: string;
  occlusion: boolean;
  upscaler: string;
  device: string;
  ms: number;
};

export type SwapResult = { url: string; blob: Blob; info: SwapInfo | null };

export const OCCLUDER_ID = "xseg_1";
export const MAX_FACES = 8;

/** Throw a readable Error for a failed /api response. */
export async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `Error ${res.status}`;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
  } catch { /* keep the generic message */ }
  throw new Error(message);
}

export async function detectFaces(
  file: Blob,
  purpose: "meme" | "source",
): Promise<FaceBox[]> {
  const form = new FormData();
  form.append("meme_file", file, "image");
  form.append("purpose", purpose);
  const res = await ensureOk(
    await fetch("/api/detect_faces", { method: "POST", body: form }),
  );
  return (await res.json()).faces ?? [];
}

/** Downscale any image to a JPEG data URL small enough for localStorage. */
export async function toJpegDataUrl(
  src: string,
  maxDim = 800,
): Promise<string> {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = src;
  });
  const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

/** localStorage can be full or blocked; persistence is best-effort. */
export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}
