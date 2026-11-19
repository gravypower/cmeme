import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import BrowseStage from "../components/BrowseStage.tsx";
import FaceStage from "../components/FaceStage.tsx";
import ResultStage from "../components/ResultStage.tsx";
import { type SwapResult, toJpegDataUrl } from "../lib/client.ts";

type Stage = 0 | 1 | 2; // 0 = browse, 1 = add face, 2 = result

const LAST_RESULT_KEY = "cmeme_last_result";

function StepIndicator({ stage }: { stage: Stage }) {
  const steps = ["🗂 Pick a Meme", "🧑 Add Your Face", "✅ Result"];
  return (
    <div class="step-indicator">
      {steps.map((label, i) => (
        <div key={i} style="display: contents;">
          <div
            class={`step ${
              stage === i ? "step-active" : stage > i ? "step-done" : "step-pending"
            }`}
          >
            <span class="step-num">{stage > i ? "✓" : i + 1}</span>
            <span class="step-label">{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div class={`step-line ${stage > i ? "step-line-done" : ""}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function SwapForm() {
  const stage = useSignal<Stage>(0);
  const memeUrl = useSignal("");
  const memeName = useSignal("");
  const result = useSignal<SwapResult | null>(null);
  const lastResultUrl = useSignal("");

  useEffect(() => {
    lastResultUrl.value = localStorage.getItem(LAST_RESULT_KEY) ?? "";
  }, []);

  function handleResult(next: SwapResult) {
    if (result.value) URL.revokeObjectURL(result.value.url);
    result.value = next;
    stage.value = 2;
    document.querySelector(".swap-wizard")?.scrollIntoView({ block: "start" });
    // Keep a compressed copy so it survives a reload (best-effort).
    toJpegDataUrl(next.url).then((dataUrl) => {
      try {
        localStorage.setItem(LAST_RESULT_KEY, dataUrl);
        lastResultUrl.value = dataUrl;
      } catch { /* storage full or blocked */ }
    }).catch(() => {});
  }

  return (
    <div class="swap-wizard">
      <StepIndicator stage={stage.value} />

      {stage.value === 0 && (
        <BrowseStage
          onMemeSelected={(url, name) => {
            memeUrl.value = url;
            memeName.value = name;
            stage.value = 1;
          }}
          lastMemeUrl={lastResultUrl.value}
          onClearLast={() => {
            localStorage.removeItem(LAST_RESULT_KEY);
            lastResultUrl.value = "";
          }}
        />
      )}

      {/* Stays mounted behind the result so "Tweak & retry" keeps every choice. */}
      {stage.value >= 1 && (
        <FaceStage
          key={memeUrl.value}
          memeUrl={memeUrl.value}
          memeName={memeName.value}
          hidden={stage.value === 2}
          onBack={() => stage.value = 0}
          onResult={handleResult}
        />
      )}

      {stage.value === 2 && result.value && (
        <ResultStage
          result={result.value}
          originalUrl={memeUrl.value}
          onTweak={() => stage.value = 1}
          onStartOver={() => stage.value = 0}
        />
      )}
    </div>
  );
}
