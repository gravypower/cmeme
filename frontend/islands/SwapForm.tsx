import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────────────

type Stage = 0 | 1 | 2; // 0=Browse, 1=Add Face, 2=Result
type ImgflipMeme = { id: string; name: string; url: string };
type MemegenTemplate = {
  id: string; name: string; lines: number;
  example: { text: string[]; url: string };
  blank: string;
};
type FaceBox = { box: [number, number, number, number] };

// ── Helpers ──────────────────────────────────────────────────────────────────

function memegenEncode(text: string): string {
  if (!text.trim()) return "_";
  return text
    .replace(/_/g, "__").replace(/-/g, "--").replace(/ /g, "_")
    .replace(/\?/g, "~q").replace(/&/g, "~a").replace(/%/g, "~p")
    .replace(/#/g, "~h").replace(/\//g, "~s").replace(/\\/g, "~b");
}

function memegenUrl(id: string, lines: string[]): string {
  return `https://api.memegen.link/images/${id}/${lines.map(memegenEncode).join("/")}.png`;
}

async function urlToFile(url: string, name: string): Promise<{ file: File; preview: string }> {
  const res = await fetch(url);
  const blob = await res.blob();
  const file = new File([blob], `${name}.png`, { type: blob.type || "image/png" });
  return { file, preview: URL.createObjectURL(blob) };
}

async function saveResultToStorage(blobUrl: string, storageKey: string = "cmeme_last_result") {
  console.log(`[Storage] Attempting to save to ${storageKey}...`);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = blobUrl;
    });

    console.log(`[Storage] Image decoded. Original size: ${img.width}x${img.height}`);

    const canvas = document.createElement("canvas");
    let { width, height } = img;
    // Scale down to max 800px on the longest side to ensure JPEG fits in localStorage safely (< 5MB)
    const MAX_DIM = 800;
    if (width > MAX_DIM || height > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
      width *= ratio;
      height *= ratio;
    }
    canvas.width = width;
    canvas.height = height;
    
    console.log(`[Storage] Compressing to ${width}x${height} JPEG...`);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("[Storage] Failed to get 2D canvas context.");
      return;
    }
    ctx.drawImage(img, 0, 0, width, height);
    
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    console.log(`[Storage] Compressed JPEG size: ${dataUrl.length} characters.`);
    
    localStorage.setItem(storageKey, dataUrl);
    console.log(`[Storage] Successfully saved to ${storageKey}!`);
  } catch (err) {
    console.error(`[Storage] FATAL ERROR trying to save ${storageKey}:`, err);
  }
}

// ── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ stage }: { stage: Stage }) {
  const steps = ["🗂 Browse Memes", "🧑 Add Your Face", "✅ Result"];
  return (
    <div class="step-indicator">
      {steps.map((label, i) => (
        <div key={i} style="display: contents;">
          <div class={`step ${stage === i ? "step-active" : stage > i ? "step-done" : "step-pending"}`}>
            <span class="step-num">{stage > i ? "✓" : i + 1}</span>
            <span class="step-label">{label}</span>
          </div>
          {i < steps.length - 1 && <div class={`step-line ${stage > i ? "step-line-done" : ""}`} />}
        </div>
      ))}
    </div>
  );
}

// ── Imgflip Grid ─────────────────────────────────────────────────────────────

function ImgflipGrid({ onSelect }: { onSelect: (url: string, name: string) => void }) {
  const memes = useSignal<ImgflipMeme[]>([]);
  const loading = useSignal(true);
  const search = useSignal("");

  useEffect(() => {
    fetch("/api/memes").then((r) => r.json())
      .then((d) => { memes.value = d; loading.value = false; })
      .catch(() => { loading.value = false; });
  }, []);

  const filtered = memes.value.filter((m) =>
    m.name.toLowerCase().includes(search.value.toLowerCase())
  );

  return (
    <div class="browse-tab-panel">
      <div class="browse-search-row">
        <input id="imgflip-search" type="search" class="search-input" placeholder="Search popular memes…" aria-label="Search popular memes"
          value={search.value} onInput={(e: Event) => { search.value = (e.target as HTMLInputElement).value; }} />
      </div>
      <div class="meme-grid-scroll">
        {loading.value
          ? <div class="grid-loading"><span class="spinner"></span>Loading…</div>
          : filtered.length === 0
            ? <p class="grid-empty">No memes match "{search.value}"</p>
            : (
              <div class="meme-grid">
                {filtered.map((m) => (
                  <button key={m.id} class="meme-card" title={m.name} onClick={() => onSelect(m.url, m.name)}>
                    <img src={m.url} alt={m.name} class="meme-thumb" loading="lazy" />
                    <span class="meme-name">{m.name}</span>
                  </button>
                ))}
              </div>
            )}
      </div>
    </div>
  );
}

// ── Memegen Flow ──────────────────────────────────────────────────────────────
// Grid → (click) → Text Config → Generate

function MemegenFlow({ onSelect }: { onSelect: (url: string, name: string) => void }) {
  const templates = useSignal<MemegenTemplate[]>([]);
  const loading = useSignal(true);
  const search = useSignal("");
  const selected = useSignal<MemegenTemplate | null>(null);
  const lines = useSignal<string[]>(["", ""]);

  useEffect(() => {
    fetch("/api/memegen").then((r) => r.json())
      .then((d) => { templates.value = d; loading.value = false; })
      .catch(() => { loading.value = false; });
  }, []);

  function pickTemplate(t: MemegenTemplate) {
    selected.value = t;
    lines.value = Array.from({ length: Math.max(t.lines, 2) }, (_, i) => t.example.text[i] ?? "");
  }

  const previewUrl = selected.value ? memegenUrl(selected.value.id, lines.value) : null;

  // ── Config sub-view ──
  if (selected.value) {
    const t = selected.value;
    return (
      <div class="browse-tab-panel">
        <div class="config-topbar">
          <button id="memegen-back-btn" type="button" class="back-btn" onClick={() => { selected.value = null; }}>← Back</button>
          <span class="config-tpl-name">✏️ {t.name}</span>
        </div>
        <div class="memegen-config-layout">
          <div class="config-preview-col">
            {previewUrl && <img id="memegen-preview-img" src={previewUrl} alt="Meme preview" class="config-preview-img" />}
          </div>
          <div class="config-inputs-col">
            <p class="config-hint">Edit the text, then click Generate to use this meme.</p>
            {lines.value.map((val, i) => (
              <div key={i} class="config-field">
                <label class="config-label" for={`mg-line-${i}`}>
                  {i === 0 ? "Top text" : i === lines.value.length - 1 ? "Bottom text" : `Line ${i + 1}`}
                </label>
                <input id={`mg-line-${i}`} type="text" class="search-input"
                  placeholder={t.example.text[i] ?? ""}
                  value={val}
                  onInput={(e: Event) => {
                    const next = [...lines.value];
                    next[i] = (e.target as HTMLInputElement).value;
                    lines.value = next;
                  }} />
              </div>
            ))}
            <button id="generate-memegen-btn" type="button" class="use-meme-btn"
              onClick={() => previewUrl && onSelect(previewUrl, t.name)}>
              ✨ Generate &amp; Use This Meme
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Template grid ──
  const filtered = templates.value.filter((t) =>
    t.name.toLowerCase().includes(search.value.toLowerCase())
  );

  return (
    <div class="browse-tab-panel">
      <div class="browse-search-row">
        <input id="memegen-search" type="search" class="search-input" placeholder="Search 200+ meme templates…" aria-label="Search meme templates"
          value={search.value} onInput={(e: Event) => { search.value = (e.target as HTMLInputElement).value; }} />
      </div>
      <div class="meme-grid-scroll">
        {loading.value
          ? <div class="grid-loading"><span class="spinner"></span>Loading…</div>
          : filtered.length === 0
            ? <p class="grid-empty">No templates match "{search.value}"</p>
            : (
              <div class="meme-grid">
                {filtered.map((t) => (
                  <button key={t.id} class="meme-card" title={t.name} onClick={() => pickTemplate(t)}>
                    <img src={t.blank} alt={t.name} class="meme-thumb" loading="lazy" />
                    <span class="meme-name">{t.name}</span>
                    <span class="meme-edit-hint">✏️ Add text</span>
                  </button>
                ))}
              </div>
            )}
      </div>
    </div>
  );
}

// ── Stage 0: Browse ───────────────────────────────────────────────────────────

function BrowseStage({ onMemeSelected, lastMemeUrl, onClearLast }: {
  onMemeSelected: (url: string, name: string) => void;
  lastMemeUrl: string;
  onClearLast: () => void;
}) {
  const activeTab = useSignal<"imgflip" | "memegen">("imgflip");

  return (
    <div class="stage-panel browse-stage">
      <div class="stage-header">
        <h2 class="stage-title">Pick a meme</h2>
        <p class="stage-subtitle">Choose from popular memes or create a custom one with your own text.</p>
      </div>

      {lastMemeUrl && (
        <div class="last-meme-banner">
          <img src={lastMemeUrl} alt="Last creation" class="last-meme-img" />
          <div class="last-meme-content">
            <h3 class="last-meme-title">Your last creation</h3>
            <p class="last-meme-subtitle">Saved locally to your browser.</p>
            <div class="last-meme-actions">
              <a href={lastMemeUrl} download="swapped_meme.jpeg" class="download-btn">⬇ Download</a>
              <button type="button" class="back-btn" onClick={onClearLast}>✕ Clear</button>
            </div>
          </div>
        </div>
      )}

      <div class="browse-tabs">
        <button id="tab-imgflip" type="button"
          class={`tab-btn ${activeTab.value === "imgflip" ? "active" : ""}`}
          onClick={() => { activeTab.value = "imgflip"; }}>
          🔥 Popular Memes
        </button>
        <button id="tab-memegen" type="button"
          class={`tab-btn ${activeTab.value === "memegen" ? "active" : ""}`}
          onClick={() => { activeTab.value = "memegen"; }}>
          ✏️ Custom Text
        </button>
      </div>
      {activeTab.value === "imgflip"
        ? <ImgflipGrid onSelect={onMemeSelected} />
        : <MemegenFlow onSelect={onMemeSelected} />}
    </div>
  );
}

// ── Stage 1: Add Face + Swap ──────────────────────────────────────────────────

function FaceStage(props: {
  memePreview: string;
  memeName: string;
  initialFaces?: string[];
  onFaceChange: (files: File[], previews: string[]) => void;
  onBack: () => void;
  onResult: (url: string) => void;
  onClearFaces: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useSignal(false);
  
  // Track multiple uploaded faces
  const facePreviews = useSignal<string[]>(props.initialFaces || []);
  const faceFiles = useSignal<File[]>([]);
  
  // The face currently "active" or selected from the uploaded list
  const activeFaceIndex = useSignal<number | null>(null);
  
  // Maps a meme face index to a source face index. e.g. {0: 1, 1: 0}
  const faceMapping = useSignal<Record<number, number>>({});

  const swapping = useSignal(false);
  const error = useSignal<string | null>(null);
  const memeLoading = useSignal(true);
  const tosAccepted = useSignal(false);
  const validatingFaces = useSignal(false);

  const imageRef = useRef<HTMLImageElement>(null);
  const detectedFaces = useSignal<FaceBox[]>([]);
  const selectedFaceIndex = useSignal<number | null>(null);
  const detectingFaces = useSignal(false);
  const imgDims = useSignal({ cw: 1, ch: 1, nw: 1, nh: 1 });

  // Manual face drawing state
  const manualFaces = useSignal<FaceBox[]>([]);
  const drawing = useSignal(false);
  const drawStart = useSignal<{ x: number, y: number } | null>(null);
  const drawCurrent = useSignal<{ x: number, y: number } | null>(null);

  // Moving custom faces
  const movingFaceIndex = useSignal<number | null>(null);
  const moveStart = useSignal<{ x: number, y: number } | null>(null);
  const originalBox = useSignal<[number, number, number, number] | null>(null);
  const isDraggingFace = useSignal(false);

  useEffect(() => {
    async function detect() {
      if (!props.memePreview) return;
      detectingFaces.value = true;
      try {
        const res = await fetch(props.memePreview);
        const blob = await res.blob();
        const formData = new FormData();
        formData.append("meme_file", new File([blob], "meme.png", { type: blob.type }));
        
        const apiRes = await fetch("/api/detect_faces", { method: "POST", body: formData });
        if (apiRes.ok) {
          const data = await apiRes.json();
          detectedFaces.value = data.faces || [];
          // Auto-map if exactly one meme face and one source face exists
          if (detectedFaces.value.length === 1 && faceFiles.value.length === 1) {
            faceMapping.value = { 0: 0 };
          }
        }
      } catch (err) {
        console.error("Face detection failed", err);
      } finally {
        detectingFaces.value = false;
      }
    }
    detect();
  }, [props.memePreview]);

  useEffect(() => {
    const handleResize = () => {
      if (imageRef.current) {
        imgDims.value = {
          cw: imageRef.current.clientWidth,
          ch: imageRef.current.clientHeight,
          nw: imageRef.current.naturalWidth,
          nh: imageRef.current.naturalHeight,
        };
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // If we have initial faces from localStorage (Data URL), convert them back to Files
  useEffect(() => {
    if (props.initialFaces && props.initialFaces.length > 0 && faceFiles.value.length === 0) {
      Promise.all(props.initialFaces.map(url => fetch(url).then(res => res.blob())))
        .then(blobs => {
          const files = blobs.map((blob, i) => new File([blob], `restored_face_${i}.jpeg`, { type: blob.type }));
          faceFiles.value = files;
          // Auto-map if only 1 face loaded and 1 face detected
          if (files.length === 1 && detectedFaces.value.length === 1) {
              faceMapping.value = { 0: 0 };
          }
          if (files.length > 0) {
              activeFaceIndex.value = 0;
          }
        })
        .catch(() => {
          // If decoding fails somehow, clear the previews
          facePreviews.value = [];
        });
    }
  }, [props.initialFaces]);

  async function handleFiles(files: FileList | null) {
      if (!files) return;
      const validFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
      if (validFiles.length === 0) return;

      validatingFaces.value = true;
      error.value = null;

      const newPreviews: string[] = [];
      const newFiles: File[] = [];
      let anyFailed = false;

      for (const file of validFiles) {
          const formData = new FormData();
          formData.append("meme_file", file);
          try {
              const apiRes = await fetch("/api/detect_faces", { method: "POST", body: formData });
              if (apiRes.ok) {
                  const data = await apiRes.json();
                  if (data.faces && data.faces.length > 0) {
                      newFiles.push(file);
                      const dataUrl = await new Promise<string>((resolve) => {
                          const reader = new FileReader();
                          reader.onload = (e) => resolve(e.target?.result as string);
                          reader.readAsDataURL(file);
                      });
                      newPreviews.push(dataUrl);
                  } else {
                      anyFailed = true;
                      error.value = `No face detected in "${file.name}". Photo not added.`;
                  }
              } else {
                  anyFailed = true;
                  error.value = `Error checking face in "${file.name}".`;
              }
          } catch (err) {
              console.error("Face detection failed", err);
              anyFailed = true;
              error.value = `Connection error checking "${file.name}".`;
          }
      }

      validatingFaces.value = false;

      if (newFiles.length > 0) {
          const updatedPreviews = [...facePreviews.value, ...newPreviews];
          const updatedFiles = [...faceFiles.value, ...newFiles];
          facePreviews.value = updatedPreviews;
          faceFiles.value = updatedFiles;
          
          activeFaceIndex.value = updatedFiles.length - newFiles.length;
          
          if (updatedFiles.length === 1 && detectedFaces.value.length === 1) {
              faceMapping.value = { 0: 0 };
          }

          props.onFaceChange(updatedFiles, updatedPreviews);
      }
  }

  function removeFace(index: number) {
      const updatedPreviews = [...facePreviews.value];
      const updatedFiles = [...faceFiles.value];
      updatedPreviews.splice(index, 1);
      updatedFiles.splice(index, 1);
      
      facePreviews.value = updatedPreviews;
      faceFiles.value = updatedFiles;
      
      // Update mapping: remove assignments to the deleted face, and shift indices > index
      const newMapping: Record<number, number> = {};
      for (const [memeIdx, srcIdx] of Object.entries(faceMapping.value)) {
          if (srcIdx === index) continue; // Face was removed
          newMapping[Number(memeIdx)] = srcIdx > index ? srcIdx - 1 : srcIdx;
      }
      faceMapping.value = newMapping;
      
      if (activeFaceIndex.value === index) {
          activeFaceIndex.value = updatedFiles.length > 0 ? 0 : null;
      } else if (activeFaceIndex.value !== null && activeFaceIndex.value > index) {
          activeFaceIndex.value--;
      }

      props.onFaceChange(updatedFiles, updatedPreviews);
  }

  async function handleSwap() {
    if (faceFiles.value.length === 0) {
        error.value = "Please upload at least one face source.";
        return;
    }
    
    // We no longer require mapping at least one face.
    // The backend handles empty face_map by doing a random assignment algorithm 
    // that clusters similar faces.
    swapping.value = true;
    error.value = null;

    // Fetch the meme as a blob to send to the backend
    let memeBlob: Blob;
    try {
      const res = await fetch(props.memePreview);
      memeBlob = await res.blob();
    } catch {
      error.value = "Failed to fetch the meme image. Try again.";
      swapping.value = false;
      return;
    }

    const formData = new FormData();
    formData.append("meme_file", new File([memeBlob], "meme.png", { type: memeBlob.type }));
    
    const usedFaceIndices = new Set<number>();
    const isMappingActive = Object.keys(faceMapping.value).length > 0;

    if (isMappingActive) {
        Object.values(faceMapping.value).forEach((idx) => usedFaceIndices.add(idx as number));
    } else {
        // Fallback or random mode: all files might be used
        faceFiles.value.forEach((f: File, idx: number) => usedFaceIndices.add(idx));
    }

    const fileIndexMap = new Map<number, number>();
    let newIndex = 0;
    
    faceFiles.value.forEach((file: File, oldIdx: number) => {
        if (usedFaceIndices.has(oldIdx)) {
            formData.append("face_file", file);
            fileIndexMap.set(oldIdx, newIndex);
            newIndex++;
        }
    });

    console.log("[handleSwap] faceMapping.value keys length:", Object.keys(faceMapping.value).length);
    console.log("[handleSwap] faceMapping.value:", faceMapping.value);
    
    if (isMappingActive) {
        const remapped: Record<number, number> = {};
        for (const [mIdx, oldIdx] of Object.entries(faceMapping.value)) {
            remapped[Number(mIdx)] = fileIndexMap.get(oldIdx)!;
        }
        const fmStr = JSON.stringify(remapped);
        console.log("[handleSwap] Appending face_map string:", fmStr);
        formData.append("face_map", fmStr);
    } else {
        console.log("[handleSwap] NOT appending face_map because faceMapping is empty!");
    }

    if (manualFaces.value.length > 0) {
        const manualFacesArr = manualFaces.value.map(f => f.box);
        formData.append("manual_faces", JSON.stringify(manualFacesArr));
    }

    try {
      const res = await fetch("/api/swap", { method: "POST", body: formData });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try { const j = await res.json(); msg = j.error ?? msg; } catch (_) { /* ignore */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      props.onResult(URL.createObjectURL(blob));
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      swapping.value = false;
    }
  }

  return (
    <div class="stage-panel face-stage">
      <div class="stage-header">
        <h2 class="stage-title">Add your face</h2>
        <p class="stage-subtitle">Upload a photo — every face in the meme will be replaced with this one.</p>
      </div>

      <div class="face-stage-grid">
        {/* Selected meme */}
        <div class="face-stage-meme">
          <p class="zone-label">🎭 Selected meme {detectingFaces.value && <span class="spinner" style="width: 12px; height: 12px; border-width: 2px; border-top-color: var(--valiant);"></span>} <span style="font-size: 0.8em; font-weight: normal; opacity: 0.8;">(Draw a box if a face wasn't found)</span></p>
          <div class="meme-preview-box"
               onMouseDown={(e: MouseEvent) => {
                 if (memeLoading.value || imgDims.value.nw <= 1 || !imageRef.current) return;
                 const rect = imageRef.current.getBoundingClientRect();
                 const x = e.clientX - rect.left;
                 const y = e.clientY - rect.top;
                 if (x < 0 || x > rect.width || y < 0 || y > rect.height) return; // Disallow drawing outside image
                 drawing.value = true;
                 drawStart.value = { x, y };
                 drawCurrent.value = { x, y };
               }}
               onMouseMove={(e: MouseEvent) => {
                 if (movingFaceIndex.value !== null && moveStart.value && originalBox.value) {
                     const dx = e.clientX - moveStart.value.x;
                     const dy = e.clientY - moveStart.value.y;
                     if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                         isDraggingFace.value = true;
                     }
                     
                     const scaleX = imgDims.value.nw / imgDims.value.cw;
                     const scaleY = imgDims.value.nh / imgDims.value.ch;
                     const deltaX = dx * scaleX;
                     const deltaY = dy * scaleY;
                     
                     const [ox1, oy1, ox2, oy2] = originalBox.value;
                     const width = ox2 - ox1;
                     const height = oy2 - oy1;
                     
                     let nx1 = ox1 + deltaX;
                     let ny1 = oy1 + deltaY;
                     let nx2 = ox2 + deltaX;
                     let ny2 = oy2 + deltaY;
                     
                     if (nx1 < 0) { nx1 = 0; nx2 = width; }
                     if (ny1 < 0) { ny1 = 0; ny2 = height; }
                     if (nx2 > imgDims.value.nw) { nx2 = imgDims.value.nw; nx1 = imgDims.value.nw - width; }
                     if (ny2 > imgDims.value.nh) { ny2 = imgDims.value.nh; ny1 = imgDims.value.nh - height; }
                     
                     const copy = [...manualFaces.value];
                     copy[movingFaceIndex.value] = { box: [nx1, ny1, nx2, ny2] };
                     manualFaces.value = copy;
                     return;
                 }

                 if (!drawing.value || !imageRef.current) return;
                 const rect = imageRef.current.getBoundingClientRect();
                 drawCurrent.value = {
                   x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
                   y: Math.max(0, Math.min(e.clientY - rect.top, rect.height))
                 };
               }}
               onMouseUp={(e: MouseEvent) => {
                 if (movingFaceIndex.value !== null) {
                     movingFaceIndex.value = null;
                     moveStart.value = null;
                     originalBox.value = null;
                     setTimeout(() => isDraggingFace.value = false, 0);
                     return;
                 }

                 if (!drawing.value || !drawStart.value || !drawCurrent.value) return;
                 drawing.value = false;
                 
                 const x1 = Math.min(drawStart.value.x, drawCurrent.value.x);
                 const y1 = Math.min(drawStart.value.y, drawCurrent.value.y);
                 const x2 = Math.max(drawStart.value.x, drawCurrent.value.x);
                 const y2 = Math.max(drawStart.value.y, drawCurrent.value.y);
                 
                 // Minimum box size
                 if (x2 - x1 > 10 && y2 - y1 > 10) {
                     // Convert client display coordinates to natural image coordinates
                     const scaleX = imgDims.value.nw / imgDims.value.cw;
                     const scaleY = imgDims.value.nh / imgDims.value.ch;
                     manualFaces.value = [...manualFaces.value, { box: [x1 * scaleX, y1 * scaleY, x2 * scaleX, y2 * scaleY] }];
                 }
                 
                 drawStart.value = null;
                 drawCurrent.value = null;
               }}
               onMouseLeave={(e: MouseEvent) => {
                 if (movingFaceIndex.value !== null) {
                     movingFaceIndex.value = null;
                     moveStart.value = null;
                     originalBox.value = null;
                     setTimeout(() => isDraggingFace.value = false, 0);
                 }
                 // Stop drawing if leaving the box area
                 if (drawing.value) {
                     drawing.value = false;
                     drawStart.value = null;
                     drawCurrent.value = null;
                 }
               }}
          >
            <div style="position: relative; display: inline-block; max-width: 100%; pointer-events: none;">
              <img ref={imageRef} src={props.memePreview} alt={props.memeName}
                class="meme-preview-img" style="pointer-events: auto; user-select: none; -webkit-user-drag: none;"
              onLoad={(e) => { 
                memeLoading.value = false; 
                const img = e.currentTarget;
                imgDims.value = {
                  cw: img.clientWidth,
                  ch: img.clientHeight,
                  nw: img.naturalWidth,
                  nh: img.naturalHeight,
                };
              }} />
            {memeLoading.value && <div class="meme-preview-loading"><span class="spinner"></span></div>}
            
            {/* Draw active drag box */}
            {drawing.value && drawStart.value && drawCurrent.value && (
               <div style={{
                   position: 'absolute',
                   border: '2px dashed #00ffff',
                   backgroundColor: 'rgba(0, 255, 255, 0.1)',
                   left: Math.min(drawStart.value.x, drawCurrent.value.x) + 'px',
                   top: Math.min(drawStart.value.y, drawCurrent.value.y) + 'px',
                   width: Math.abs(drawCurrent.value.x - drawStart.value.x) + 'px',
                   height: Math.abs(drawCurrent.value.y - drawStart.value.y) + 'px',
                   pointerEvents: 'none',
                   zIndex: 10,
               }} />
            )}

            {!memeLoading.value && !detectingFaces.value && detectedFaces.value.length === 0 && manualFaces.value.length === 0 && (
                <div class="no-faces-hint" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.75); color: white; padding: 16px 24px; border-radius: 12px; pointer-events: none; text-align: center; border: 2px dashed rgba(255,255,255,0.4); backdrop-filter: blur(4px); box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                    <div style="font-size: 2em; margin-bottom: 8px;">✏️</div>
                    <div style="font-weight: bold; font-size: 1.1em; margin-bottom: 4px;">No auto-detected faces</div>
                    <div style="font-size: 0.95em; opacity: 0.9;">Click and drag to draw a box <br/>where you want the face to go</div>
                </div>
            )}

            {!memeLoading.value && [...detectedFaces.value, ...manualFaces.value].map((face, index) => {
               if (imgDims.value.nw <= 1) return null;
               const scaleX = imgDims.value.cw / imgDims.value.nw;
               const scaleY = imgDims.value.ch / imgDims.value.nh;
               const [x1, y1, x2, y2] = face.box;
               const left = x1 * scaleX;
               const top = y1 * scaleY;
               const width = (x2 - x1) * scaleX;
               const height = (y2 - y1) * scaleY;
               const isSelected = faceMapping.value[index] !== undefined;
               const assignedFaceIndex = faceMapping.value[index];
               const assignedFaceUrl = assignedFaceIndex !== undefined ? facePreviews.value[assignedFaceIndex] : null;
               const isManual = index >= detectedFaces.value.length;
               
               return (
                 <div
                   key={index}
                   class={`face-selection-box ${isSelected ? "selected" : ""} ${isManual ? "manual-face" : ""}`}
                   style={`left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; pointer-events: auto; ${isManual ? "cursor: move;" : ""}`}
                   onMouseDown={(e) => {
                     e.stopPropagation();
                     if (isManual) {
                         movingFaceIndex.value = index - detectedFaces.value.length;
                         moveStart.value = { x: e.clientX, y: e.clientY };
                         originalBox.value = [...manualFaces.value[index - detectedFaces.value.length].box] as [number, number, number, number];
                     }
                   }}
                   onClick={(e) => {
                     e.preventDefault();
                     e.stopPropagation();
                     
                     if (isDraggingFace.value) {
                         return;
                     }
                     
                     if (isSelected) {
                         // Click again to unassign
                         const newMapping = { ...faceMapping.value };
                         delete newMapping[index];
                         faceMapping.value = newMapping;
                     } else {
                         // Assign active face to this box
                         if (activeFaceIndex.value !== null) {
                             faceMapping.value = { ...faceMapping.value, [index]: activeFaceIndex.value };
                         } else {
                             // If no face uploaded yet, no-op or error
                             alert("Upload and select a source face first!");
                         }
                     }
                   }}
                 >
                     {isManual && (
                         <button class="remove-face-btn" style="position: absolute; top: -14px; right: -14px; z-index: 10;" onClick={(e: MouseEvent) => {
                             e.preventDefault();
                             e.stopPropagation();
                             const mIdx = index - detectedFaces.value.length;
                             const newManual = [...manualFaces.value];
                             newManual.splice(mIdx, 1);
                             manualFaces.value = newManual;
                             const newMap = { ...faceMapping.value };
                             delete newMap[index];
                             // Shift indices for face mapping
                             const updatedMap: Record<number, number> = {};
                             for (const k in newMap) {
                                 const kNum = Number(k);
                                 if (kNum > index) {
                                     updatedMap[kNum - 1] = newMap[kNum];
                                 } else {
                                     updatedMap[kNum] = newMap[kNum];
                                 }
                             }
                             faceMapping.value = updatedMap;
                         }}>✕</button>
                     )}
                     {assignedFaceUrl && (
                         <div class="assigned-face-badge">
                             <img src={assignedFaceUrl} alt={`Assign ${assignedFaceIndex}`} />
                         </div>
                     )}
                 </div>
               );
            })}
            </div>
            {memeLoading.value && <div class="meme-preview-loading"><span class="spinner"></span></div>}
          </div>
          <button id="change-meme-btn" type="button" class="back-btn change-meme-btn" onClick={props.onBack}>
            ← Change meme
          </button>
        </div>

        {/* Face upload */}
        <div class="face-stage-upload">
          <p class="zone-label">🧑 Face sources</p>
          
          <div class="uploaded-faces-gallery">
            {facePreviews.value.map((src, i) => (
                <div 
                    class={`uploaded-face-item ${activeFaceIndex.value === i ? "active" : ""}`} 
                    key={i}
                    onClick={() => activeFaceIndex.value = i}
                >
                    <img src={src} alt="Uploaded face" />
                    <button class="remove-face-btn" onClick={(e) => { e.stopPropagation(); removeFace(i); }}>✕</button>
                    {activeFaceIndex.value === i && <div class="active-face-badge">Active</div>}
                </div>
            ))}
          </div>
          
          {facePreviews.value.length > 0 && (
            <button 
              type="button" 
              class="back-btn" 
              style="margin-bottom: 12px; font-size: 0.9em; padding: 4px 12px;" 
              onClick={(e) => {
                e.stopPropagation();
                props.onClearFaces();
              }}
            >
              🗑️ Clear saved faces
            </button>
          )}

          <div
            id="face-drop-zone"
            class={`upload-zone ${dragging.value ? "drag-over" : ""} multi-upload ${validatingFaces.value ? "disabled" : ""}`}
            onClick={() => !validatingFaces.value && inputRef.current?.click()}
            onDragOver={(e: DragEvent) => { e.preventDefault(); dragging.value = true; }}
            onDragLeave={() => { dragging.value = false; }}
            onDrop={(e: DragEvent) => {
              e.preventDefault(); dragging.value = false;
              if (!validatingFaces.value) handleFiles(e.dataTransfer?.files || null);
            }}
          >
             <div class="upload-placeholder">
               {validatingFaces.value ? (
                 <>
                   <span class="spinner" style="width: 24px; height: 24px; border-width: 3px; border-top-color: var(--valiant); margin-bottom: 8px;"></span>
                   <p class="upload-main-text">Validating faces...</p>
                 </>
               ) : (
                 <>
                   <span class="upload-icon">➕</span>
                   <p class="upload-main-text">Add another photo</p>
                   <p class="upload-hint">JPEG, PNG or WebP · max 20 MB</p>
                 </>
               )}
             </div>
          </div>
          <input ref={inputRef} id="face-file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple
            class="visually-hidden" onChange={(e: Event) => {
              handleFiles((e.target as HTMLInputElement).files);
            }} />
        </div>
      </div>

      {error.value && (
        <div id="swap-error-banner" class="error-banner" role="alert">
          <span class="error-icon">⚠️</span><span>{error.value}</span>
        </div>
      )}

      <div class="tos-checkbox-row">
        <label class="tos-label">
          <input 
            type="checkbox" 
            checked={tosAccepted.value} 
            onChange={(e) => tosAccepted.value = (e.target as HTMLInputElement).checked} 
          />
          <span>I agree to the <a href="/tos" target="_blank" style="text-decoration: underline; color: inherit;">Terms of Service</a>, confirm I will not generate non-consensual explicit content or use this for harassment, and understand my photos are <strong>never stored</strong> by the servers.</span>
        </label>
      </div>

      <div class="swap-action-row">
        <button id="swap-btn" type="button" class={`swap-btn ${swapping.value ? "loading" : ""}`}
          disabled={faceFiles.value.length === 0 || swapping.value || !tosAccepted.value}
          onClick={handleSwap}>
          {swapping.value
            ? <><span class="spinner"></span>Swapping faces…</>
            : <>✨ Swap Faces!</>}
        </button>
      </div>
    </div>
  );
}

// ── Stage 2: Result ───────────────────────────────────────────────────────────

function ResultStage({ resultUrl, onStartOver }: { resultUrl: string; onStartOver: () => void }) {
  return (
    <div class="stage-panel result-stage">
      <div class="result-header">
        <h2 class="result-title">🎉 Face Swap Complete!</h2>
        <div class="result-actions">
          <a id="download-btn" href={resultUrl} download="swapped_meme.png" class="download-btn">⬇ Download</a>
          <button id="start-over-btn" type="button" class="back-btn" onClick={onStartOver}>↺ Start Over</button>
        </div>
      </div>
      <div class="result-image-wrapper">
        <img id="result-image" src={resultUrl} alt="Face-swapped meme" class="result-image" />
      </div>
    </div>
  );
}

// ── Main Island ───────────────────────────────────────────────────────────────

export default function SwapForm() {
  const stage = useSignal<Stage>(0);
  const memeUrl = useSignal<string>("");
  const memeName = useSignal<string>("");
  const resultUrl = useSignal<string>("");
  
  // Last seen meme state
  const lastResultUrl = useSignal<string>("");
  // Last uploaded faces state
  const lastFaceUrls = useSignal<string[]>([]);

  useEffect(() => {
    const savedResult = localStorage.getItem("cmeme_last_result");
    if (savedResult) lastResultUrl.value = savedResult;
    
    // Attempt migrating from old single string to new array storage
    try {
        const savedFaces = localStorage.getItem("cmeme_last_faces");
        if (savedFaces) {
            lastFaceUrls.value = JSON.parse(savedFaces);
        } else {
            const oldSavedFace = localStorage.getItem("cmeme_last_face");
            if (oldSavedFace) lastFaceUrls.value = [oldSavedFace];
        }
    } catch {
        const oldSavedFace = localStorage.getItem("cmeme_last_face");
        if (oldSavedFace) lastFaceUrls.value = [oldSavedFace];
    }
  }, []);

  async function handleMemeSelected(url: string, name: string) {
    memeUrl.value = url;
    memeName.value = name;
    stage.value = 1;
  }

  function handleResult(url: string) {
    resultUrl.value = url;
    stage.value = 2;
    // Compress and save to localStorage
    saveResultToStorage(url, "cmeme_last_result").then(() => {
      const saved = localStorage.getItem("cmeme_last_result");
      if (saved) lastResultUrl.value = saved;
    });
  }

  function handleFaceSelected(files: File[], previews: string[]) {
    // Save multiple faces to localStorage as JSON
    const promises = previews.map((preview, i) => saveResultToStorage(preview, `cmeme_temp_face_${i}`));
    Promise.all(promises).then(() => {
        const savedDataUrls = previews.map((_, i) => localStorage.getItem(`cmeme_temp_face_${i}`) || "");
        localStorage.setItem("cmeme_last_faces", JSON.stringify(savedDataUrls));
        lastFaceUrls.value = savedDataUrls.filter(u => u !== "");
    });
  }

  function handleStartOver() {
    memeUrl.value = "";
    memeName.value = "";
    resultUrl.value = "";
    stage.value = 0;
  }

  function handleClearLast() {
    localStorage.removeItem("cmeme_last_result");
    lastResultUrl.value = "";
  }

  function handleClearFaces() {
    // Remove the face references
    localStorage.removeItem("cmeme_last_faces");
    localStorage.removeItem("cmeme_last_face");
    
    // Attempt to remove individual temp faces stored to construct the array
    for (let i = 0; i < 10; i++) {
        localStorage.removeItem(`cmeme_temp_face_${i}`);
    }
    
    // Clear state
    lastFaceUrls.value = [];
    
    // If we're currently in the FaceStage with faces loaded, this change needs to also
    // trigger a reload or be handled by the FaceStage itself. Since the FaceStage 
    // initializes its state from `initialFaces` but manages it internally afterwards,
    // we'll actually force a re-mount by briefly shifting the stage out and back, 
    // OR we pass an empty array, but FaceStage has already mounted.
    // The cleanest way in Preact without changing the whole arch is to just clear the array,
    // and let the FaceStage clear its internal state since we passed the prop.
    // Wait, FaceStage needs to clear its internal signal. Let's just reset the form to stage 0 for a clean slate.
    stage.value = 0;
  }

  return (
    <div class="swap-wizard">
      <StepIndicator stage={stage.value} />

      {stage.value === 0 && (
        <BrowseStage 
          onMemeSelected={handleMemeSelected} 
          lastMemeUrl={lastResultUrl.value} 
          onClearLast={handleClearLast} 
        />
      )}

      {stage.value === 1 && (
        <FaceStage
          memePreview={memeUrl.value}
          memeName={memeName.value}
          initialFaces={lastFaceUrls.value}
          onFaceChange={handleFaceSelected}
          onBack={() => { stage.value = 0; }}
          onResult={handleResult}
          onClearFaces={handleClearFaces}
        />
      )}

      {stage.value === 2 && (
        <ResultStage resultUrl={resultUrl.value} onStartOver={handleStartOver} />
      )}
    </div>
  );
}
