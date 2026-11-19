import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

type ImgflipMeme = { id: string; name: string; url: string };
type MemegenTemplate = {
  id: string;
  name: string;
  lines: number;
  example: { text: string[]; url: string };
  blank: string;
};
type OnSelect = (url: string, name: string) => void;

function memegenEncode(text: string): string {
  if (!text.trim()) return "_";
  return text
    .replace(/_/g, "__").replace(/-/g, "--").replace(/ /g, "_")
    .replace(/\?/g, "~q").replace(/&/g, "~a").replace(/%/g, "~p")
    .replace(/#/g, "~h").replace(/\//g, "~s").replace(/\\/g, "~b");
}

function memegenUrl(id: string, lines: string[]): string {
  return `https://api.memegen.link/images/${id}/${
    lines.map(memegenEncode).join("/")
  }.png`;
}

/** Load a JSON list from one of our API routes, tracking loading/failure. */
function useList<T>(url: string) {
  const items = useSignal<T[]>([]);
  const state = useSignal<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    fetch(url)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => {
        items.value = d;
        state.value = "ready";
      })
      .catch(() => {
        state.value = "failed";
      });
  }, []);
  return { items, state };
}

function Grid<T extends { id: string; name: string }>(props: {
  items: T[];
  state: "loading" | "ready" | "failed";
  search: string;
  thumb: (item: T) => string;
  hint?: string;
  onPick: (item: T) => void;
}) {
  const filtered = props.items.filter((m) =>
    m.name.toLowerCase().includes(props.search.toLowerCase())
  );
  if (props.state === "loading") {
    return (
      <div class="grid-loading">
        <span class="spinner"></span>Loading…
      </div>
    );
  }
  if (props.state === "failed") {
    return (
      <p class="grid-empty">
        Couldn't load memes — try the Upload tab instead.
      </p>
    );
  }
  if (filtered.length === 0) {
    return <p class="grid-empty">Nothing matches "{props.search}"</p>;
  }
  return (
    <div class="meme-grid">
      {filtered.map((m) => (
        <button
          key={m.id}
          type="button"
          class="meme-card"
          title={m.name}
          onClick={() => props.onPick(m)}
        >
          <img
            src={props.thumb(m)}
            alt={m.name}
            class="meme-thumb"
            loading="lazy"
          />
          <span class="meme-name">{m.name}</span>
          {props.hint && <span class="meme-edit-hint">{props.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function SearchRow(
  props: { id: string; placeholder: string; value: string; onInput: (v: string) => void },
) {
  return (
    <div class="browse-search-row">
      <input
        id={props.id}
        type="search"
        class="search-input"
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        value={props.value}
        onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}

function ImgflipGrid({ onSelect }: { onSelect: OnSelect }) {
  const { items, state } = useList<ImgflipMeme>("/api/memes");
  const search = useSignal("");
  return (
    <div class="browse-tab-panel">
      <SearchRow
        id="imgflip-search"
        placeholder="Search popular memes…"
        value={search.value}
        onInput={(v) => search.value = v}
      />
      <div class="meme-grid-scroll">
        <Grid
          items={items.value}
          state={state.value}
          search={search.value}
          thumb={(m) => m.url}
          onPick={(m) => onSelect(m.url, m.name)}
        />
      </div>
    </div>
  );
}

function MemegenFlow({ onSelect }: { onSelect: OnSelect }) {
  const { items, state } = useList<MemegenTemplate>("/api/memegen");
  const search = useSignal("");
  const selected = useSignal<MemegenTemplate | null>(null);
  const lines = useSignal<string[]>(["", ""]);

  if (selected.value) {
    const t = selected.value;
    const previewUrl = memegenUrl(t.id, lines.value);
    return (
      <div class="browse-tab-panel">
        <div class="config-topbar">
          <button
            id="memegen-back-btn"
            type="button"
            class="back-btn"
            onClick={() => selected.value = null}
          >
            ← Back
          </button>
          <span class="config-tpl-name">✏️ {t.name}</span>
        </div>
        <div class="memegen-config-layout">
          <div class="config-preview-col">
            <img
              id="memegen-preview-img"
              src={previewUrl}
              alt="Meme preview"
              class="config-preview-img"
            />
          </div>
          <div class="config-inputs-col">
            <p class="config-hint">
              Edit the text, then use the meme. Faces are swapped next.
            </p>
            {lines.value.map((val, i) => (
              <div key={i} class="config-field">
                <label class="config-label" for={`mg-line-${i}`}>
                  {i === 0
                    ? "Top text"
                    : i === lines.value.length - 1
                    ? "Bottom text"
                    : `Line ${i + 1}`}
                </label>
                <input
                  id={`mg-line-${i}`}
                  type="text"
                  class="search-input"
                  placeholder={t.example.text[i] ?? ""}
                  value={val}
                  onInput={(e) => {
                    const next = [...lines.value];
                    next[i] = (e.target as HTMLInputElement).value;
                    lines.value = next;
                  }}
                />
              </div>
            ))}
            <button
              id="generate-memegen-btn"
              type="button"
              class="use-meme-btn"
              onClick={() => onSelect(previewUrl, t.name)}
            >
              ✨ Use This Meme
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="browse-tab-panel">
      <SearchRow
        id="memegen-search"
        placeholder="Search meme templates…"
        value={search.value}
        onInput={(v) => search.value = v}
      />
      <div class="meme-grid-scroll">
        <Grid
          items={items.value}
          state={state.value}
          search={search.value}
          thumb={(t) => t.blank}
          hint="✏️ Add text"
          onPick={(t) => {
            selected.value = t;
            lines.value = Array.from(
              { length: Math.max(t.lines, 2) },
              (_, i) => t.example.text[i] ?? "",
            );
          }}
        />
      </div>
    </div>
  );
}

function UploadMeme({ onSelect }: { onSelect: OnSelect }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useSignal(false);
  const error = useSignal("");

  function take(file: File | null | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      error.value = "Please use a JPEG, PNG or WebP image.";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      error.value = "That image is over the 20 MB limit.";
      return;
    }
    onSelect(URL.createObjectURL(file), file.name.replace(/\.[^.]+$/, ""));
  }

  // Paste an image straight from the clipboard while this tab is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith("image/")
      );
      if (file) take(file);
    };
    globalThis.addEventListener("paste", onPaste);
    return () => globalThis.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div class="browse-tab-panel upload-meme-panel">
      <div
        id="meme-drop-zone"
        class={`upload-zone ${dragging.value ? "drag-over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          dragging.value = true;
        }}
        onDragLeave={() => dragging.value = false}
        onDrop={(e) => {
          e.preventDefault();
          dragging.value = false;
          take(e.dataTransfer?.files?.[0]);
        }}
      >
        <div class="upload-placeholder">
          <span class="upload-icon">🖼️</span>
          <p class="upload-main-text">
            Drop an image here, <span class="upload-link">browse</span>, or
            paste with Ctrl+V
          </p>
          <p class="upload-hint">JPEG, PNG or WebP · max 20 MB</p>
        </div>
      </div>
      <input
        ref={inputRef}
        id="meme-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="visually-hidden"
        onChange={(e) => take((e.target as HTMLInputElement).files?.[0])}
      />
      {error.value && (
        <div class="error-banner" role="alert">
          <span class="error-icon">⚠️</span>
          <span>{error.value}</span>
        </div>
      )}
    </div>
  );
}

type Tab = "imgflip" | "memegen" | "upload";
const TABS: { id: Tab; label: string }[] = [
  { id: "imgflip", label: "🔥 Popular Memes" },
  { id: "memegen", label: "✏️ Custom Text" },
  { id: "upload", label: "📤 Upload Your Own" },
];

export default function BrowseStage(props: {
  onMemeSelected: OnSelect;
  lastMemeUrl: string;
  onClearLast: () => void;
}) {
  const activeTab = useSignal<Tab>("imgflip");

  return (
    <div class="stage-panel browse-stage">
      <div class="stage-header">
        <h2 class="stage-title">Pick a meme</h2>
        <p class="stage-subtitle">
          Choose a popular meme, caption a template, or bring your own image.
        </p>
      </div>

      {props.lastMemeUrl && (
        <div class="last-meme-banner">
          <img
            src={props.lastMemeUrl}
            alt="Last creation"
            class="last-meme-img"
          />
          <div class="last-meme-content">
            <h3 class="last-meme-title">Your last creation</h3>
            <p class="last-meme-subtitle">Saved locally in your browser.</p>
            <div class="last-meme-actions">
              <a
                href={props.lastMemeUrl}
                download="swapped_meme.jpeg"
                class="download-btn"
              >
                ⬇ Download
              </a>
              <button type="button" class="back-btn" onClick={props.onClearLast}>
                ✕ Clear
              </button>
            </div>
          </div>
        </div>
      )}

      <div class="browse-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab.value === t.id}
            class={`tab-btn ${activeTab.value === t.id ? "active" : ""}`}
            onClick={() => activeTab.value = t.id}
          >
            {t.label}
          </button>
        ))}
      </div>
      {activeTab.value === "imgflip" && (
        <ImgflipGrid onSelect={props.onMemeSelected} />
      )}
      {activeTab.value === "memegen" && (
        <MemegenFlow onSelect={props.onMemeSelected} />
      )}
      {activeTab.value === "upload" && (
        <UploadMeme onSelect={props.onMemeSelected} />
      )}
    </div>
  );
}
