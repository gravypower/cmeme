import {
  type ModelInfo,
  type ModelKind,
  type ModelsResponse,
  OCCLUDER_ID,
  type SwapOptions,
} from "../lib/client.ts";

/** Ids of the models the current options need. */
export function requiredModels(options: SwapOptions): string[] {
  const ids = [options.swapModel];
  if (options.enhancer !== "none") ids.push(options.enhancer);
  if (options.occlusion) ids.push(OCCLUDER_ID);
  if (options.upscaler !== "none") ids.push(options.upscaler);
  return ids.filter(Boolean);
}

function ModelStatus(props: {
  model: ModelInfo | undefined;
  downloadsAllowed: boolean;
  onDownload: (id: string) => void;
}) {
  const m = props.model;
  if (!m) return null;
  return (
    <div class="model-status">
      <p class="option-desc">
        {m.description}
        {m.license && <span class="option-license">· {m.license}</span>}
      </p>
      {m.status === "downloading" && (
        <div class="model-progress" role="status">
          <div
            class="model-progress-bar"
            style={`width: ${Math.round((m.progress ?? 0) * 100)}%`}
          />
          <span class="model-progress-label">
            Downloading… {Math.round((m.progress ?? 0) * 100)}%
          </span>
        </div>
      )}
      {(m.status === "missing" || m.status === "error") && (
        props.downloadsAllowed
          ? (
            <div class="model-download-row">
              <button
                type="button"
                class="back-btn"
                onClick={() => props.onDownload(m.id)}
              >
                ⬇ {m.status === "error" ? "Retry download" : "Download"} ·{" "}
                {m.size_mb} MB
              </button>
              {m.status === "error" && (
                <span class="model-error">{m.error}</span>
              )}
            </div>
          )
          : <p class="model-error">Not installed on this server.</p>
      )}
    </div>
  );
}

export default function OptionsPanel(props: {
  models: ModelsResponse | null;
  options: SwapOptions;
  onChange: (next: SwapOptions) => void;
  onDownload: (id: string) => void;
}) {
  const { models, options } = props;
  if (!models) return null;

  const ofKind = (kind: ModelKind) => models.models.filter((m) => m.kind === kind);
  const byId = (id: string) => models.models.find((m) => m.id === id);
  const set = (patch: Partial<SwapOptions>) =>
    props.onChange({ ...options, ...patch });
  const label = (m: ModelInfo) =>
    m.status === "installed" ? m.name : `${m.name} — ${m.size_mb} MB download`;
  const status = (id: string) => (
    <ModelStatus
      model={byId(id)}
      downloadsAllowed={models.downloads_allowed}
      onDownload={props.onDownload}
    />
  );

  return (
    <details class="options-panel" open>
      <summary class="options-summary">
        ⚙️ Models &amp; quality
        <span class="options-device">
          Running on {models.device === "gpu" ? "GPU" : "CPU"}
        </span>
      </summary>
      <div class="options-grid">
        <div class="option-field">
          <label class="config-label" for="opt-swap-model">Swap model</label>
          <select
            id="opt-swap-model"
            class="search-input"
            value={options.swapModel}
            onChange={(e) =>
              set({ swapModel: (e.target as HTMLSelectElement).value })}
          >
            {ofKind("swapper").map((m) => (
              <option key={m.id} value={m.id}>{label(m)}</option>
            ))}
          </select>
          {status(options.swapModel)}
        </div>

        <div class="option-field">
          <label class="config-label" for="opt-enhancer">Face restoration</label>
          <select
            id="opt-enhancer"
            class="search-input"
            value={options.enhancer}
            onChange={(e) =>
              set({ enhancer: (e.target as HTMLSelectElement).value })}
          >
            <option value="none">Off</option>
            {ofKind("enhancer").map((m) => (
              <option key={m.id} value={m.id}>{label(m)}</option>
            ))}
          </select>
          {options.enhancer !== "none" && (
            <>
              <label class="option-range" for="opt-enhancer-blend">
                <span>Strength {options.enhancerBlend}%</span>
                <input
                  id="opt-enhancer-blend"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={options.enhancerBlend}
                  onInput={(e) =>
                    set({
                      enhancerBlend: Number(
                        (e.target as HTMLInputElement).value,
                      ),
                    })}
                />
              </label>
              {status(options.enhancer)}
            </>
          )}
          {options.enhancer === "none" && (
            <p class="option-desc">
              Sharpens the swapped face — recommended for large faces.
            </p>
          )}
        </div>

        <div class="option-field">
          <label class="config-label" for="opt-upscaler">Upscale result</label>
          <select
            id="opt-upscaler"
            class="search-input"
            value={options.upscaler}
            onChange={(e) =>
              set({ upscaler: (e.target as HTMLSelectElement).value })}
          >
            <option value="none">Off</option>
            {ofKind("upscaler").map((m) => (
              <option key={m.id} value={m.id}>{label(m)}</option>
            ))}
          </select>
          {options.upscaler !== "none"
            ? status(options.upscaler)
            : (
              <p class="option-desc">
                Enlarges the whole finished meme with Real-ESRGAN.
              </p>
            )}
        </div>

        <div class="option-field">
          <span class="config-label">Occlusions</span>
          <label class="option-check">
            <input
              id="opt-occlusion"
              type="checkbox"
              checked={options.occlusion}
              onChange={(e) =>
                set({ occlusion: (e.target as HTMLInputElement).checked })}
            />
            <span>Keep things covering the face</span>
          </label>
          {options.occlusion
            ? status(OCCLUDER_ID)
            : (
              <p class="option-desc">
                Hands, glasses, hair or text in front of a face stay on top.
              </p>
            )}
        </div>
      </div>
    </details>
  );
}
