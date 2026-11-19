import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
  detectFaces,
  ensureOk,
  type FaceBox,
  loadJson,
  MAX_FACES,
  type ModelsResponse,
  saveJson,
  type SwapOptions,
  type SwapResult,
  toJpegDataUrl,
} from "../lib/client.ts";
import OptionsPanel, { requiredModels } from "./OptionsPanel.tsx";

type Point = { x: number; y: number };
type Box = [number, number, number, number];

const FACES_KEY = "cmeme_last_faces";
const OPTIONS_KEY = "cmeme_options";
const TOS_KEY = "cmeme_tos_accepted";

const DEFAULT_OPTIONS: SwapOptions = {
  swapModel: "",
  enhancer: "none",
  enhancerBlend: 80,
  occlusion: false,
  upscaler: "none",
};

export default function FaceStage(props: {
  memeUrl: string;
  memeName: string;
  hidden: boolean;
  onBack: () => void;
  onResult: (result: SwapResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const memeBlob = useRef<Promise<Blob> | null>(null);

  // Source faces: previews are small JPEG data URLs (also what we persist).
  const facePreviews = useSignal<string[]>([]);
  const faceFiles = useSignal<File[]>([]);
  const activeFace = useSignal<number | null>(null);
  const validating = useSignal(false);
  const dragOver = useSignal(false);

  // Meme faces: detected first, then hand-drawn; mapping is meme → source index.
  const detected = useSignal<FaceBox[]>([]);
  const manual = useSignal<FaceBox[]>([]);
  const mapping = useSignal<Record<number, number>>({});
  const detecting = useSignal(true);
  const natural = useSignal({ w: 0, h: 0 });

  // Pointer interaction on the meme (all coordinates in image pixels).
  const drawStart = useSignal<Point | null>(null);
  const drawNow = useSignal<Point | null>(null);
  const pressed = useRef<
    { index: number; at: Point; box: Box | null; moved: boolean } | null
  >(null);

  const models = useSignal<ModelsResponse | null>(null);
  const options = useSignal<SwapOptions>(DEFAULT_OPTIONS);
  const swapping = useSignal(false);
  const error = useSignal<string | null>(null);
  const tosAccepted = useSignal(false);

  // ── Load saved state ──────────────────────────────────────────────────────
  useEffect(() => {
    tosAccepted.value = localStorage.getItem(TOS_KEY) === "1";
    const saved = loadJson<string[]>(FACES_KEY, []).filter(Boolean);
    if (saved.length === 0) return;
    Promise.all(saved.map((url) => fetch(url).then((r) => r.blob())))
      .then((blobs) => {
        faceFiles.value = blobs.map((b, i) =>
          new File([b], `face_${i}.jpeg`, { type: b.type })
        );
        facePreviews.value = saved;
        activeFace.value = 0;
      })
      .catch(() => localStorage.removeItem(FACES_KEY));
  }, []);

  // ── Models ────────────────────────────────────────────────────────────────
  async function refreshModels() {
    try {
      const res = await ensureOk(await fetch("/api/models"));
      models.value = await res.json();
    } catch (err) {
      error.value = (err as Error).message;
    }
  }

  useEffect(() => {
    refreshModels().then(() => {
      const list = models.value?.models ?? [];
      if (list.length === 0) return;
      const has = (id: string) => list.some((m) => m.id === id);
      const saved = loadJson<Partial<SwapOptions> | null>(OPTIONS_KEY, null);
      const next = { ...DEFAULT_OPTIONS, ...(saved ?? {}) };
      if (!has(next.swapModel)) {
        next.swapModel = list.find((m) => m.kind === "swapper" && m.default)?.id ?? "";
      }
      if (next.enhancer !== "none" && !has(next.enhancer)) next.enhancer = "none";
      if (next.upscaler !== "none" && !has(next.upscaler)) next.upscaler = "none";
      // First visit: turn restoration on if a restorer is already installed.
      if (!saved) {
        const ready = list.find((m) => m.kind === "enhancer" && m.status === "installed");
        if (ready) next.enhancer = ready.id;
      }
      options.value = next;
    });
  }, []);

  // Poll while anything is downloading.
  const downloading = models.value?.models.some((m) => m.status === "downloading") ?? false;
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(refreshModels, 1500);
    return () => clearInterval(timer);
  }, [downloading]);

  async function downloadModel(id: string) {
    try {
      await ensureOk(await fetch(`/api/models/${id}/download`, { method: "POST" }));
    } catch (err) {
      error.value = (err as Error).message;
    }
    await refreshModels();
  }

  function setOptions(next: SwapOptions) {
    options.value = next;
    saveJson(OPTIONS_KEY, next);
  }

  // ── Detect faces in the meme ──────────────────────────────────────────────
  useEffect(() => {
    detected.value = [];
    manual.value = [];
    mapping.value = {};
    detecting.value = true;
    error.value = null;
    const blob = fetch(props.memeUrl).then((r) => {
      if (!r.ok) throw new Error();
      return r.blob();
    });
    memeBlob.current = blob;
    blob
      .then((b) => detectFaces(b, "meme"))
      .then((faces) => {
        if (memeBlob.current === blob) detected.value = faces;
      })
      .catch((err) => {
        if (memeBlob.current === blob) {
          error.value = err.message || "Couldn't load that meme image. Try another one.";
        }
      })
      .finally(() => {
        if (memeBlob.current === blob) detecting.value = false;
      });
  }, [props.memeUrl]);

  // ── Source faces ──────────────────────────────────────────────────────────
  function commitFaces(files: File[], previews: string[]) {
    faceFiles.value = files;
    facePreviews.value = previews;
    saveJson(FACES_KEY, previews);
  }

  async function addFaces(list: FileList | null | undefined) {
    const incoming = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) return;
    validating.value = true;
    error.value = null;
    const files = [...faceFiles.value];
    const previews = [...facePreviews.value];
    for (const file of incoming) {
      if (files.length >= MAX_FACES) {
        error.value = `You can keep up to ${MAX_FACES} face photos.`;
        break;
      }
      try {
        const faces = await detectFaces(file, "source");
        if (faces.length === 0) {
          error.value = `No face found in "${file.name}" — photo not added.`;
          continue;
        }
        const objectUrl = URL.createObjectURL(file);
        previews.push(await toJpegDataUrl(objectUrl));
        URL.revokeObjectURL(objectUrl);
        files.push(file);
      } catch (err) {
        error.value = `Couldn't check "${file.name}": ${(err as Error).message}`;
      }
    }
    validating.value = false;
    if (files.length > faceFiles.value.length) {
      activeFace.value = faceFiles.value.length;
      commitFaces(files, previews);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeFace(index: number) {
    const next: Record<number, number> = {};
    for (const [memeIdx, srcIdx] of Object.entries(mapping.value)) {
      if (srcIdx !== index) next[Number(memeIdx)] = srcIdx > index ? srcIdx - 1 : srcIdx;
    }
    mapping.value = next;
    commitFaces(
      faceFiles.value.filter((_, i) => i !== index),
      facePreviews.value.filter((_, i) => i !== index),
    );
    const active = activeFace.value;
    if (active === index) activeFace.value = faceFiles.value.length > 0 ? 0 : null;
    else if (active !== null && active > index) activeFace.value = active - 1;
  }

  function clearFaces() {
    mapping.value = {};
    activeFace.value = null;
    commitFaces([], []);
    localStorage.removeItem(FACES_KEY);
  }

  // ── Meme face boxes ───────────────────────────────────────────────────────
  function toImagePoint(e: PointerEvent): Point {
    const rect = imageRef.current!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
    return {
      x: clamp((e.clientX - rect.left) / rect.width * natural.value.w, natural.value.w),
      y: clamp((e.clientY - rect.top) / rect.height * natural.value.h, natural.value.h),
    };
  }

  function removeManual(index: number) {
    const manualIdx = index - detected.value.length;
    manual.value = manual.value.filter((_, i) => i !== manualIdx);
    const next: Record<number, number> = {};
    for (const [key, src] of Object.entries(mapping.value)) {
      const k = Number(key);
      if (k !== index) next[k > index ? k - 1 : k] = src;
    }
    mapping.value = next;
  }

  function toggleAssignment(index: number) {
    if (mapping.value[index] !== undefined) {
      const next = { ...mapping.value };
      delete next[index];
      mapping.value = next;
    } else if (activeFace.value !== null) {
      mapping.value = { ...mapping.value, [index]: activeFace.value };
    } else {
      error.value = "Add a face photo first, then click a face in the meme to assign it.";
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (!natural.value.w || !imageRef.current || e.button > 0) return;
    const target = e.target as HTMLElement;
    const removeBtn = target.closest<HTMLElement>("[data-remove-face]");
    if (removeBtn) return; // handled by the button's click
    const at = toImagePoint(e);
    const boxEl = target.closest<HTMLElement>("[data-face-index]");
    if (boxEl) {
      const index = Number(boxEl.dataset.faceIndex);
      const manualIdx = index - detected.value.length;
      pressed.current = {
        index,
        at,
        box: manualIdx >= 0 ? [...manual.value[manualIdx].box] as Box : null,
        moved: false,
      };
    } else {
      drawStart.value = at;
      drawNow.value = at;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    const press = pressed.current;
    if (press) {
      const at = toImagePoint(e);
      const dx = at.x - press.at.x;
      const dy = at.y - press.at.y;
      const { w, h } = natural.value;
      if (Math.hypot(dx, dy) > Math.max(w, h) * 0.01) press.moved = true;
      if (press.box && press.moved) {
        const [x1, y1, x2, y2] = press.box;
        const nx = Math.max(0, Math.min(x1 + dx, w - (x2 - x1)));
        const ny = Math.max(0, Math.min(y1 + dy, h - (y2 - y1)));
        const next = [...manual.value];
        next[press.index - detected.value.length] = {
          box: [nx, ny, nx + (x2 - x1), ny + (y2 - y1)],
          kind: "manual",
        };
        manual.value = next;
      }
    } else if (drawStart.value) {
      drawNow.value = toImagePoint(e);
    }
  }

  function onPointerUp() {
    const press = pressed.current;
    pressed.current = null;
    if (press) {
      if (!press.moved) toggleAssignment(press.index);
      return;
    }
    const a = drawStart.value;
    const b = drawNow.value;
    drawStart.value = null;
    drawNow.value = null;
    if (!a || !b) return;
    const box: Box = [
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.max(a.x, b.x),
      Math.max(a.y, b.y),
    ];
    const min = Math.max(natural.value.w, natural.value.h) * 0.03;
    if (box[2] - box[0] < min || box[3] - box[1] < min) return;
    const index = detected.value.length + manual.value.length;
    manual.value = [...manual.value, { box, kind: "manual" }];
    // A freshly drawn box is clearly meant to be used.
    if (activeFace.value !== null) {
      mapping.value = { ...mapping.value, [index]: activeFace.value };
    }
  }

  const pct = (box: Box) => {
    const { w, h } = natural.value;
    return `left:${box[0] / w * 100}%;top:${box[1] / h * 100}%;` +
      `width:${(box[2] - box[0]) / w * 100}%;height:${(box[3] - box[1]) / h * 100}%;`;
  };

  // ── Swap ──────────────────────────────────────────────────────────────────
  async function handleSwap() {
    swapping.value = true;
    error.value = null;
    try {
      const meme = await memeBlob.current!;
      const form = new FormData();
      form.append("meme_file", meme, "meme");

      // Only upload the photos that are actually used, re-indexing the map.
      const mapped = Object.keys(mapping.value).length > 0;
      const used = mapped
        ? [...new Set(Object.values(mapping.value))].sort((a, b) => a - b)
        : faceFiles.value.map((_, i) => i);
      used.forEach((i) => form.append("face_file", faceFiles.value[i]));
      if (mapped) {
        const remapped: Record<string, number> = {};
        for (const [memeIdx, srcIdx] of Object.entries(mapping.value)) {
          remapped[memeIdx] = used.indexOf(srcIdx);
        }
        form.append("face_map", JSON.stringify(remapped));
      }
      if (manual.value.length > 0) {
        form.append("manual_faces", JSON.stringify(manual.value.map((f) => f.box)));
      }
      const o = options.value;
      form.append("swap_model", o.swapModel);
      form.append("enhancer", o.enhancer);
      form.append("enhancer_blend", String(o.enhancerBlend / 100));
      form.append("occlusion", String(o.occlusion));
      form.append("upscaler", o.upscaler);

      const res = await ensureOk(await fetch("/api/swap", { method: "POST", body: form }));
      const blob = await res.blob();
      let info = null;
      try {
        info = JSON.parse(res.headers.get("x-cmeme-info") ?? "null");
      } catch { /* optional */ }
      props.onResult({ url: URL.createObjectURL(blob), blob, info });
    } catch (err) {
      error.value = (err as Error).message || "Failed to swap. Try again.";
    } finally {
      swapping.value = false;
    }
  }

  const allFaces = [...detected.value, ...manual.value];
  const mappedCount = Object.keys(mapping.value).length;
  const notReady = requiredModels(options.value).filter((id) =>
    models.value?.models.find((m) => m.id === id)?.status !== "installed"
  );
  const canSwap = faceFiles.value.length > 0 && tosAccepted.value &&
    !swapping.value && !detecting.value && allFaces.length > 0 &&
    models.value !== null && notReady.length === 0;

  let hint = "";
  if (faceFiles.value.length === 0) hint = "Add a face photo to get started.";
  else if (detecting.value) hint = "Looking for faces…";
  else if (allFaces.length === 0) hint = "Draw a box on the meme where the face should go.";
  else if (notReady.length > 0) hint = "Download the selected model(s) above first.";
  else if (!tosAccepted.value) hint = "Accept the terms to continue.";
  else if (mappedCount === 0) {
    hint = allFaces.length === 1
      ? "The face will be swapped automatically."
      : "No faces assigned — every face will be swapped automatically. Click a face to choose who goes where.";
  } else {
    hint = `${mappedCount} of ${allFaces.length} face${allFaces.length === 1 ? "" : "s"} will be swapped.`;
  }

  return (
    <div class="stage-panel face-stage" style={props.hidden ? "display:none" : ""}>
      <div class="stage-header stage-header-flush">
        <h2 class="stage-title">Add your face</h2>
        <p class="stage-subtitle">
          Upload one or more face photos. Pick a photo, then click a face in the
          meme to put it there — or just hit Swap to do them all.
        </p>
      </div>

      <div class="face-stage-grid">
        <div class="face-stage-meme">
          <p class="zone-label">
            🎭 {props.memeName || "Selected meme"}
            {detecting.value && <span class="spinner spinner-inline"></span>}
            <span class="zone-label-note">Drag on the image to add a face box</span>
          </p>
          <div class="meme-preview-box">
            <div
              class="meme-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <img
                ref={imageRef}
                src={props.memeUrl}
                alt={props.memeName}
                class="meme-preview-img"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  natural.value = { w: img.naturalWidth, h: img.naturalHeight };
                }}
              />

              {natural.value.w > 0 && drawStart.value && drawNow.value && (
                <div
                  class="face-draw-box"
                  style={pct([
                    Math.min(drawStart.value.x, drawNow.value.x),
                    Math.min(drawStart.value.y, drawNow.value.y),
                    Math.max(drawStart.value.x, drawNow.value.x),
                    Math.max(drawStart.value.y, drawNow.value.y),
                  ])}
                />
              )}

              {natural.value.w > 0 && !detecting.value && allFaces.length === 0 &&
                !drawStart.value && (
                <div class="no-faces-hint">
                  <div class="no-faces-icon">✏️</div>
                  <strong>No faces found automatically</strong>
                  <span>Click and drag to draw a box where the face should go</span>
                </div>
              )}

              {natural.value.w > 0 && allFaces.map((face, index) => {
                const src = mapping.value[index];
                const isManual = index >= detected.value.length;
                return (
                  <div
                    key={index}
                    data-face-index={index}
                    class={`face-selection-box ${src !== undefined ? "selected" : ""} ${
                      isManual ? "manual-face" : ""
                    }`}
                    style={pct(face.box)}
                    title={src !== undefined ? "Click to unassign" : "Click to assign the active photo"}
                  >
                    {isManual && (
                      <button
                        type="button"
                        data-remove-face
                        class="remove-face-btn remove-box-btn"
                        aria-label="Remove this box"
                        onClick={() => removeManual(index)}
                      >
                        ✕
                      </button>
                    )}
                    {src !== undefined && facePreviews.value[src] && (
                      <div class="assigned-face-badge">
                        <img src={facePreviews.value[src]} alt="" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {natural.value.w === 0 && (
              <div class="meme-preview-loading">
                <span class="spinner"></span>
              </div>
            )}
          </div>
          <button id="change-meme-btn" type="button" class="back-btn change-meme-btn" onClick={props.onBack}>
            ← Change meme
          </button>
        </div>

        <div class="face-stage-upload">
          <p class="zone-label">🧑 Face photos</p>

          {facePreviews.value.length > 0 && (
            <div class="uploaded-faces-gallery">
              {facePreviews.value.map((src, i) => (
                <div
                  key={i}
                  class={`uploaded-face-item ${activeFace.value === i ? "active" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={activeFace.value === i}
                  onClick={() => activeFace.value = i}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") activeFace.value = i;
                  }}
                >
                  <img src={src} alt={`Face photo ${i + 1}`} />
                  <button
                    type="button"
                    class="remove-face-btn"
                    aria-label={`Remove face photo ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFace(i);
                    }}
                  >
                    ✕
                  </button>
                  {activeFace.value === i && <div class="active-face-badge">Active</div>}
                </div>
              ))}
            </div>
          )}

          <div
            id="face-drop-zone"
            class={`upload-zone multi-upload ${dragOver.value ? "drag-over" : ""} ${
              validating.value ? "disabled" : ""
            }`}
            role="button"
            tabIndex={0}
            onClick={() => !validating.value && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !validating.value) inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              dragOver.value = true;
            }}
            onDragLeave={() => dragOver.value = false}
            onDrop={(e) => {
              e.preventDefault();
              dragOver.value = false;
              if (!validating.value) addFaces(e.dataTransfer?.files);
            }}
          >
            <div class="upload-placeholder">
              {validating.value
                ? (
                  <>
                    <span class="spinner spinner-light"></span>
                    <p class="upload-main-text">Checking for a face…</p>
                  </>
                )
                : (
                  <>
                    <span class="upload-icon">➕</span>
                    <p class="upload-main-text">
                      {facePreviews.value.length > 0 ? "Add another photo" : "Add a face photo"}
                    </p>
                    <p class="upload-hint">JPEG, PNG or WebP · max 20 MB · clear, front-facing works best</p>
                  </>
                )}
            </div>
          </div>
          <input
            ref={inputRef}
            id="face-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            class="visually-hidden"
            onChange={(e) => addFaces((e.target as HTMLInputElement).files)}
          />

          {facePreviews.value.length > 0 && (
            <button type="button" class="back-btn clear-faces-btn" onClick={clearFaces}>
              🗑️ Clear saved faces
            </button>
          )}
        </div>
      </div>

      <OptionsPanel
        models={models.value}
        options={options.value}
        onChange={setOptions}
        onDownload={downloadModel}
      />

      {error.value && (
        <div id="swap-error-banner" class="error-banner" role="alert">
          <span class="error-icon">⚠️</span>
          <span>{error.value}</span>
        </div>
      )}

      <div class="tos-checkbox-row">
        <label class="tos-label">
          <input
            id="tos-checkbox"
            type="checkbox"
            checked={tosAccepted.value}
            onChange={(e) => {
              tosAccepted.value = (e.target as HTMLInputElement).checked;
              if (tosAccepted.value) localStorage.setItem(TOS_KEY, "1");
              else localStorage.removeItem(TOS_KEY);
            }}
          />
          <span>
            I agree to the{" "}
            <a href="/tos" target="_blank" class="tos-link">Terms of Service</a>, have
            permission to use these faces, will not create non-consensual explicit
            content or use this for harassment, and understand my photos are{" "}
            <strong>never stored</strong> by the server.
          </span>
        </label>
      </div>

      <div class="swap-action-row">
        <button
          id="swap-btn"
          type="button"
          class={`swap-btn ${swapping.value ? "loading" : ""}`}
          disabled={!canSwap}
          onClick={handleSwap}
        >
          {swapping.value
            ? (
              <>
                <span class="spinner"></span>Swapping faces…
              </>
            )
            : <>✨ Swap Faces!</>}
        </button>
        <p class="swap-hint">{hint}</p>
      </div>
    </div>
  );
}
