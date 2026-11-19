"""Model catalog, on-demand downloads and ONNX session cache.

Every model the API can use is declared in CATALOG. Core models (detector,
recogniser, default swapper) are fetched at startup when missing; optional
ones are downloaded only when someone asks for them via POST /models/{id}/download.
"""
from __future__ import annotations

import logging
import os
import threading
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

import onnxruntime as ort

logger = logging.getLogger("cmeme.registry")
ort.set_default_logger_severity(3)  # hide per-model graph warnings

MODELS_DIR = Path(os.environ.get("MODELS_DIR") or Path(__file__).parent / "models")
ALLOW_DOWNLOAD = os.environ.get("ALLOW_MODEL_DOWNLOAD", "1").lower() not in ("0", "false", "no")
# Optional (non-core) sessions kept in memory at once; the oldest is evicted.
MAX_LOADED_MODELS = int(os.environ.get("MAX_LOADED_MODELS", "4"))

_FF = "https://huggingface.co/facefusion/{repo}/resolve/main/{file}"
_INSIGHTFACE = "https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/{file}"

NON_COMMERCIAL = "Non-commercial research use only"


@dataclass(frozen=True)
class ModelFile:
    filename: str
    url: str
    size_mb: int
    # Other places (relative to MODELS_DIR) the file may already live.
    legacy_paths: tuple[str, ...] = ()

    def path(self) -> Path | None:
        """Existing location of this file, or None when it is not installed."""
        for rel in (self.filename, *self.legacy_paths):
            p = MODELS_DIR / rel
            if p.is_file():
                return p
        return None


@dataclass(frozen=True)
class ModelSpec:
    id: str
    kind: str  # detector | recognizer | cascade | swapper | enhancer | occluder | upscaler
    name: str
    description: str
    files: tuple[ModelFile, ...]
    options: dict = field(default_factory=dict)
    core: bool = False
    default: bool = False
    license: str = ""

    @property
    def size_mb(self) -> int:
        return sum(f.size_mb for f in self.files)

    @property
    def installed(self) -> bool:
        return all(f.path() is not None for f in self.files)


def _ff(repo: str, file: str, size_mb: int, legacy: tuple[str, ...] = ()) -> ModelFile:
    return ModelFile(file, _FF.format(repo=repo, file=file), size_mb, legacy)


_HALF = {"mean": (0.5, 0.5, 0.5), "std": (0.5, 0.5, 0.5)}

_SPECS = [
    # ── Core ────────────────────────────────────────────────────────────────
    ModelSpec(
        "scrfd_10g", "detector", "SCRFD 10G", "Face detector with 5-point landmarks.",
        (ModelFile("det_10g.onnx", _INSIGHTFACE.format(file="det_10g.onnx"), 16,
                   ("models/buffalo_l/det_10g.onnx",)),),
        core=True, license=NON_COMMERCIAL,
    ),
    ModelSpec(
        "arcface_w600k_r50", "recognizer", "ArcFace R50", "Identity embedding used by every swap model.",
        (ModelFile("w600k_r50.onnx", _INSIGHTFACE.format(file="w600k_r50.onnx"), 166,
                   ("models/buffalo_l/w600k_r50.onnx", "arcface_w600k_r50.onnx")),),
        core=True, license=NON_COMMERCIAL,
    ),
    ModelSpec(
        "animeface_cascade", "cascade", "Anime face cascade", "Fallback detector for cartoon faces.",
        (ModelFile(
            "lbpcascade_animeface.xml",
            "https://raw.githubusercontent.com/nagadomi/lbpcascade_animeface/master/lbpcascade_animeface.xml",
            1),),
        core=True, license="MIT",
    ),
    # ── Face swappers ───────────────────────────────────────────────────────
    ModelSpec(
        "inswapper_128", "swapper", "InSwapper 128",
        "The classic. Strong likeness, but only 128px — pair it with a face restorer.",
        (_ff("models-3.0.0", "inswapper_128.onnx", 530),),
        {"type": "inswapper", "template": "arcface_128", "size": 128,
         "mean": (0.0, 0.0, 0.0), "std": (1.0, 1.0, 1.0)},
        core=True, default=True, license=NON_COMMERCIAL,
    ),
    ModelSpec(
        "inswapper_128_fp16", "swapper", "InSwapper 128 (half precision)",
        "Same output as InSwapper 128 at half the size and memory.",
        (_ff("models-3.0.0", "inswapper_128_fp16.onnx", 265),),
        {"type": "inswapper", "template": "arcface_128", "size": 128,
         "mean": (0.0, 0.0, 0.0), "std": (1.0, 1.0, 1.0)},
        license=NON_COMMERCIAL,
    ),
    ModelSpec(
        "hyperswap_1a_256", "swapper", "HyperSwap 1A 256",
        "Newer 256px model. Sharper than InSwapper without a restorer.",
        (_ff("models-3.3.0", "hyperswap_1a_256.onnx", 384),),
        {"type": "hyperswap", "template": "arcface_128", "size": 256, **_HALF},
        license="ResearchRAIL-MS",
    ),
    ModelSpec(
        "hyperswap_1b_256", "swapper", "HyperSwap 1B 256",
        "HyperSwap variant — a slightly different look, try it if 1A misses.",
        (_ff("models-3.3.0", "hyperswap_1b_256.onnx", 384),),
        {"type": "hyperswap", "template": "arcface_128", "size": 256, **_HALF},
        license="ResearchRAIL-MS",
    ),
    ModelSpec(
        "hyperswap_1c_256", "swapper", "HyperSwap 1C 256",
        "HyperSwap variant — a slightly different look, try it if 1A misses.",
        (_ff("models-3.3.0", "hyperswap_1c_256.onnx", 384),),
        {"type": "hyperswap", "template": "arcface_128", "size": 256, **_HALF},
        license="ResearchRAIL-MS",
    ),
    ModelSpec(
        "simswap_256", "swapper", "SimSwap 256",
        "Keeps more of the original expression and lighting; weaker likeness.",
        (_ff("models-3.0.0", "simswap_256.onnx", 210),
         _ff("models-3.0.0", "arcface_converter_simswap.onnx", 20)),
        {"type": "simswap", "template": "arcface_112_v1", "size": 256,
         "mean": (0.485, 0.456, 0.406), "std": (0.229, 0.224, 0.225)},
        license=NON_COMMERCIAL,
    ),
    # ── Face restorers ──────────────────────────────────────────────────────
    ModelSpec(
        "gfpgan_1.4", "enhancer", "GFPGAN 1.4",
        "Sharpens and cleans up swapped faces. Good all-rounder.",
        (_ff("models-3.0.0", "gfpgan_1.4.onnx", 325),),
        {"template": "ffhq_512", "size": 512}, license="Apache-2.0 (bundled components non-commercial)",
    ),
    ModelSpec(
        "codeformer", "enhancer", "CodeFormer",
        "Strongest restoration; can drift from the likeness on small faces.",
        (_ff("models-3.0.0", "codeformer.onnx", 359),),
        {"template": "ffhq_512", "size": 512}, license="S-Lab 1.0 (non-commercial)",
    ),
    ModelSpec(
        "gpen_bfr_512", "enhancer", "GPEN-BFR 512",
        "Crisp skin detail with a slightly more 'photographic' look.",
        (_ff("models-3.0.0", "gpen_bfr_512.onnx", 271),),
        {"template": "ffhq_512", "size": 512}, license=NON_COMMERCIAL,
    ),
    ModelSpec(
        "restoreformer_plus_plus", "enhancer", "RestoreFormer++",
        "Gentle restoration that stays close to the swapped face.",
        (_ff("models-3.0.0", "restoreformer_plus_plus.onnx", 281),),
        {"template": "ffhq_512", "size": 512}, license="Apache-2.0",
    ),
    # ── Occlusion masking ───────────────────────────────────────────────────
    ModelSpec(
        "xseg_1", "occluder", "XSeg occlusion mask",
        "Keeps hands, glasses, hair and text that cover the face on top of the swap.",
        (_ff("models-3.1.0", "xseg_1.onnx", 67),),
        {"size": 256},
    ),
    # ── Whole-image upscalers ───────────────────────────────────────────────
    ModelSpec(
        "real_esrgan_x2", "upscaler", "Real-ESRGAN ×2",
        "Doubles the resolution of the finished meme.",
        (_ff("models-3.0.0", "real_esrgan_x2_fp16.onnx", 34),),
        {"scale": 2}, license="BSD-3-Clause",
    ),
    ModelSpec(
        "real_esrgan_x4", "upscaler", "Real-ESRGAN ×4",
        "Quadruples the resolution. Slow on CPU for large memes.",
        (_ff("models-3.0.0", "real_esrgan_x4_fp16.onnx", 34),),
        {"scale": 4}, license="BSD-3-Clause",
    ),
]

CATALOG: dict[str, ModelSpec] = {s.id: s for s in _SPECS}
USER_KINDS = ("swapper", "enhancer", "occluder", "upscaler")


class ModelNotInstalled(Exception):
    def __init__(self, spec: ModelSpec):
        self.spec = spec
        super().__init__(
            f"Model '{spec.name}' is not installed yet (~{spec.size_mb} MB). Download it first."
        )


def get_spec(model_id: str, kind: str | None = None) -> ModelSpec:
    spec = CATALOG.get(model_id)
    if spec is None or (kind is not None and spec.kind != kind):
        valid = ", ".join(s.id for s in CATALOG.values() if kind is None or s.kind == kind)
        raise ValueError(f"Unknown {kind or 'model'} '{model_id}'. Valid options: {valid}")
    return spec


def default_id(kind: str) -> str:
    return next(s.id for s in CATALOG.values() if s.kind == kind and s.default)


def model_path(model_id: str, file_index: int = 0) -> Path:
    spec = CATALOG[model_id]
    path = spec.files[file_index].path()
    if path is None:
        raise ModelNotInstalled(spec)
    return path


# ── Downloads ────────────────────────────────────────────────────────────────

_downloads: dict[str, dict] = {}
_download_lock = threading.Lock()


def _download_file(f: ModelFile, progress: dict) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    dest = MODELS_DIR / f.filename
    part = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(f.url, headers={"User-Agent": "cmeme-model-fetch"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res, open(part, "wb") as out:
            expected = int(res.headers.get("Content-Length") or 0)
            written = 0
            while chunk := res.read(1 << 20):
                out.write(chunk)
                written += len(chunk)
                progress["done_bytes"] += len(chunk)
        if written == 0 or (expected and written != expected):
            raise IOError(f"Incomplete download of {f.filename} ({written} of {expected} bytes)")
        os.replace(part, dest)
    finally:
        part.unlink(missing_ok=True)


def _download_model(spec: ModelSpec, progress: dict) -> None:
    try:
        for f in spec.files:
            if f.path() is None:
                logger.info("Downloading %s (~%d MB)", f.filename, f.size_mb)
                _download_file(f, progress)
        progress["status"] = "installed"
        logger.info("Model %s installed", spec.id)
    except Exception as e:  # noqa: BLE001 - surfaced to the client via /models
        logger.exception("Download of %s failed", spec.id)
        progress.update(status="error", error=str(e))


def start_download(model_id: str, wait: bool = False) -> dict:
    """Begin downloading a model in the background (no-op when installed)."""
    spec = get_spec(model_id)
    if spec.installed:
        return {"status": "installed"}
    if not ALLOW_DOWNLOAD:
        raise PermissionError("Model downloads are disabled on this server (ALLOW_MODEL_DOWNLOAD=0).")
    with _download_lock:
        progress = _downloads.get(model_id)
        if progress is None or progress["status"] == "error":
            missing = [f for f in spec.files if f.path() is None]
            progress = {"status": "downloading", "done_bytes": 0,
                        "total_bytes": sum(f.size_mb for f in missing) << 20, "error": None}
            _downloads[model_id] = progress
            thread = threading.Thread(target=_download_model, args=(spec, progress), daemon=True)
            thread.start()
            if wait:
                thread.join()
    return progress


def ensure_core_models() -> list[str]:
    """Fetch any missing core model. Returns the ids that are still missing."""
    for spec in CATALOG.values():
        if spec.core and not spec.installed and ALLOW_DOWNLOAD:
            start_download(spec.id, wait=True)
    return [s.id for s in CATALOG.values() if s.core and not s.installed]


def describe(spec: ModelSpec) -> dict:
    progress = _downloads.get(spec.id)
    status = "installed" if spec.installed else "missing"
    info = {
        "id": spec.id, "kind": spec.kind, "name": spec.name,
        "description": spec.description, "size_mb": spec.size_mb,
        "license": spec.license, "default": spec.default, "status": status,
    }
    if status == "missing" and progress and progress["status"] in ("downloading", "error"):
        info["status"] = progress["status"]
        info["error"] = progress["error"]
        total = progress["total_bytes"] or 1
        info["progress"] = min(0.99, progress["done_bytes"] / total)
    return info


def list_models() -> list[dict]:
    return [describe(s) for s in CATALOG.values() if s.kind in USER_KINDS]


# ── ONNX sessions ────────────────────────────────────────────────────────────

def _pick_providers() -> list[str]:
    wanted = os.environ.get("ORT_PROVIDERS", "auto")
    available = ort.get_available_providers()
    if wanted != "auto":
        return [p for p in wanted.split(",") if p in available] or ["CPUExecutionProvider"]
    if "CUDAExecutionProvider" in available:
        # onnxruntime-gpu installed with the [cuda,cudnn] extras ships its
        # libraries as pip wheels; preload them so no system CUDA is needed.
        try:
            ort.preload_dlls()
        except Exception:  # noqa: BLE001 - older onnxruntime or no wheels
            pass
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


PROVIDERS = _pick_providers()

_sessions: OrderedDict[tuple[str, int], ort.InferenceSession] = OrderedDict()
_session_lock = threading.Lock()


def get_session(model_id: str, file_index: int = 0) -> ort.InferenceSession:
    key = (model_id, file_index)
    with _session_lock:
        if key in _sessions:
            _sessions.move_to_end(key)
            return _sessions[key]
        path = model_path(model_id, file_index)
        logger.info("Loading %s on %s", path.name, PROVIDERS[0])
        try:
            session = ort.InferenceSession(str(path), providers=PROVIDERS)
        except Exception:  # noqa: BLE001 - e.g. GPU libraries missing at runtime
            if PROVIDERS == ["CPUExecutionProvider"]:
                raise
            logger.exception("Could not load %s on GPU, falling back to CPU", path.name)
            session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        _sessions[key] = session
        optional = [k for k in _sessions if not CATALOG[k[0]].core]
        while len(optional) > MAX_LOADED_MODELS:
            evicted = optional.pop(0)
            logger.info("Unloading %s", evicted[0])
            del _sessions[evicted]
        return session


def device() -> str:
    return "gpu" if PROVIDERS[0] != "CPUExecutionProvider" else "cpu"
