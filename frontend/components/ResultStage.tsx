import { useSignal } from "@preact/signals";
import type { SwapResult } from "../lib/client.ts";

export default function ResultStage(props: {
  result: SwapResult;
  originalUrl: string;
  onTweak: () => void;
  onStartOver: () => void;
}) {
  const { result } = props;
  const split = useSignal(100); // % of the width showing the swapped image
  const notice = useSignal("");
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const canCopy = typeof ClipboardItem !== "undefined";

  function flash(message: string) {
    notice.value = message;
    setTimeout(() => notice.value = "", 2500);
  }

  async function copy() {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": result.blob }),
      ]);
      flash("Copied to clipboard");
    } catch {
      flash("Couldn't copy — use Download instead");
    }
  }

  async function share() {
    const file = new File([result.blob], "swapped_meme.png", {
      type: "image/png",
    });
    try {
      await navigator.share(
        navigator.canShare?.({ files: [file] })
          ? { files: [file] }
          : { title: "CMeme", url: location.href },
      );
    } catch { /* user cancelled */ }
  }

  const info = result.info;

  return (
    <div class="stage-panel result-stage">
      <div class="result-header">
        <h2 class="result-title">🎉 Face Swap Complete!</h2>
        <div class="result-actions">
          <a
            id="download-btn"
            href={result.url}
            download="swapped_meme.png"
            class="download-btn"
          >
            ⬇ Download
          </a>
          {canCopy && (
            <button type="button" class="back-btn" onClick={copy}>
              📋 Copy
            </button>
          )}
          {canShare && (
            <button type="button" class="back-btn" onClick={share}>
              🔗 Share
            </button>
          )}
          <button
            id="tweak-btn"
            type="button"
            class="back-btn"
            onClick={props.onTweak}
          >
            🎛 Tweak &amp; retry
          </button>
          <button
            id="start-over-btn"
            type="button"
            class="back-btn"
            onClick={props.onStartOver}
          >
            ↺ New meme
          </button>
        </div>
      </div>

      {notice.value && <p class="result-notice" role="status">{notice.value}</p>}

      <div class="result-image-wrapper">
        <div class="compare">
          <img
            src={props.originalUrl}
            alt="Original meme"
            class="result-image compare-original"
          />
          <img
            id="result-image"
            src={result.url}
            alt="Face-swapped meme"
            class="result-image compare-result"
            style={`clip-path: inset(0 ${100 - split.value}% 0 0)`}
          />
          {split.value < 100 && (
            <div class="compare-divider" style={`left: ${split.value}%`} />
          )}
        </div>
      </div>

      <label class="compare-control" for="compare-range">
        <span>Original</span>
        <input
          id="compare-range"
          type="range"
          min="0"
          max="100"
          value={split.value}
          onInput={(e) =>
            split.value = Number((e.target as HTMLInputElement).value)}
        />
        <span>Swapped</span>
      </label>

      {info && (
        <p class="result-meta">
          {info.faces_swapped} face{info.faces_swapped === 1 ? "" : "s"} ·{" "}
          {info.swap_model}
          {info.enhancer !== "none" && ` + ${info.enhancer}`}
          {info.occlusion && " + occlusion mask"}
          {info.upscaler !== "none" && ` + ${info.upscaler}`} ·{" "}
          {(info.ms / 1000).toFixed(1)}s on {info.device.toUpperCase()}
        </p>
      )}
    </div>
  );
}
