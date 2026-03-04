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
        <input id="imgflip-search" type="search" class="search-input" placeholder="Search popular memes…"
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
        <input id="memegen-search" type="search" class="search-input" placeholder="Search 200+ meme templates…"
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
  initialFace?: string;
  onFaceChange: (file: File, preview: string) => void;
  onBack: () => void;
  onResult: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useSignal(false);
  const facePreview = useSignal<string | null>(props.initialFace || null);
  const faceFile = useSignal<File | null>(null);
  const swapping = useSignal(false);
  const error = useSignal<string | null>(null);
  const memeLoading = useSignal(true);

  // If we have an initial face from localStorage (Data URL), convert it back to a File
  // so the form can instantly submit without a fresh upload.
  useEffect(() => {
    if (props.initialFace && !faceFile.value) {
      fetch(props.initialFace)
        .then((res) => res.blob())
        .then((blob) => {
          faceFile.value = new File([blob], "restored_face.jpeg", { type: blob.type });
        })
        .catch(() => {
          // If decoding fails somehow, clear the preview
          facePreview.value = null;
        });
    }
  }, [props.initialFace]);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        console.log("[FaceStage] Selected face file:", file.name, "Data URL length:", dataUrl.length);
        facePreview.value = dataUrl;
        faceFile.value = file;
        props.onFaceChange(file, dataUrl);
      };
      reader.onerror = () => {
        console.error("[FaceStage] FileReader failed.");
        error.value = "Failed to read face image file.";
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("[FaceStage] Failed to handle face file:", err);
      error.value = "Failed to load selected image.";
    }
  }

  async function handleSwap() {
    if (!faceFile.value) return;
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
    formData.append("face_file", faceFile.value);

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
          <p class="zone-label">🎭 Selected meme</p>
          <div class="meme-preview-box">
            <img src={props.memePreview} alt={props.memeName}
              class="meme-preview-img"
              onLoad={() => { memeLoading.value = false; }} />
            {memeLoading.value && <div class="meme-preview-loading"><span class="spinner"></span></div>}
          </div>
          <button id="change-meme-btn" type="button" class="back-btn change-meme-btn" onClick={props.onBack}>
            ← Change meme
          </button>
        </div>

        {/* Face upload */}
        <div class="face-stage-upload">
          <p class="zone-label">🧑 Face source</p>
          <div
            id="face-drop-zone"
            class={`upload-zone ${dragging.value ? "drag-over" : ""} ${facePreview.value ? "has-preview" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e: DragEvent) => { e.preventDefault(); dragging.value = true; }}
            onDragLeave={() => { dragging.value = false; }}
            onDrop={(e: DragEvent) => {
              e.preventDefault(); dragging.value = false;
              const file = e.dataTransfer?.files[0];
              if (file) handleFile(file);
            }}
          >
            {facePreview.value
              ? (
                <>
                  <img src={facePreview.value} alt="Face preview" class="upload-preview" />
                  <div class="upload-overlay"><span class="upload-change-text">Click to change</span></div>
                </>
              )
              : (
                <div class="upload-placeholder">
                  <span class="upload-icon">📷</span>
                  <p class="upload-main-text">Drop photo here or <span class="upload-link">browse</span></p>
                  <p class="upload-hint">JPEG, PNG or WebP · max 20 MB</p>
                </div>
              )}
          </div>
          <input ref={inputRef} id="face-file-input" type="file" accept="image/jpeg,image/png,image/webp"
            class="visually-hidden" onChange={(e: Event) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) handleFile(f);
            }} />
        </div>
      </div>

      {error.value && (
        <div id="swap-error-banner" class="error-banner" role="alert">
          <span class="error-icon">⚠️</span><span>{error.value}</span>
        </div>
      )}

      <div class="swap-action-row">
        <button id="swap-btn" type="button" class={`swap-btn ${swapping.value ? "loading" : ""}`}
          disabled={!faceFile.value || swapping.value}
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
  // Last uploaded face state
  const lastFaceUrl = useSignal<string>("");

  useEffect(() => {
    const savedResult = localStorage.getItem("cmeme_last_result");
    if (savedResult) lastResultUrl.value = savedResult;
    
    const savedFace = localStorage.getItem("cmeme_last_face");
    if (savedFace) lastFaceUrl.value = savedFace;
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

  function handleFaceSelected(file: File, preview: string) {
    // Compress and save the face to localStorage as well IMMEDIATELY upon selection
    saveResultToStorage(preview, "cmeme_last_face").then(() => {
      const saved = localStorage.getItem("cmeme_last_face");
      if (saved) lastFaceUrl.value = saved;
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
          initialFace={lastFaceUrl.value}
          onFaceChange={handleFaceSelected}
          onBack={() => { stage.value = 0; }}
          onResult={handleResult}
        />
      )}

      {stage.value === 2 && (
        <ResultStage resultUrl={resultUrl.value} onStartOver={handleStartOver} />
      )}
    </div>
  );
}
