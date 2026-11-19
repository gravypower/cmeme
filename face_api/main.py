import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

import pipeline
import registry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cmeme")

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_SOURCE_FACES = 8
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Fetch missing core models and warm them up so the first request isn't slow."""
    missing = registry.ensure_core_models()
    if missing:
        logger.warning("Core models missing: %s — swaps will fail until they are installed.", ", ".join(missing))
    else:
        for model_id in ("scrfd_10g", "arcface_w600k_r50", registry.default_id("swapper")):
            registry.get_session(model_id)
        logger.info("Models loaded (%s).", registry.device())
    yield


app = FastAPI(
    title="CMeme Face Swap API",
    description="Swap faces in meme images with a choice of swap, restoration and upscaling models.",
    version="2.0.0",
    lifespan=lifespan,
)


def _read(upload: UploadFile, label: str) -> bytes:
    if upload.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"{label} must be JPEG, PNG or WebP (got {upload.content_type}).")
    data = upload.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"{label} exceeds the 20 MB limit.")
    return data


def _parse_json(value: str | None, label: str, expected: type):
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid {label} JSON: {e}") from None
    if not isinstance(parsed, expected):
        raise HTTPException(400, f"{label} has the wrong shape.")
    return parsed


def _run(fn, *args, **kwargs):
    """Translate pipeline errors into HTTP responses."""
    try:
        return fn(*args, **kwargs)
    except registry.ModelNotInstalled as e:
        raise HTTPException(409, str(e)) from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected error in %s", fn.__name__)
        raise HTTPException(500, "Something went wrong while processing the image.") from None


# Endpoints are plain `def` so FastAPI runs the (blocking) inference in its
# thread pool instead of stalling the event loop.

@app.get("/health")
def health():
    return {"status": "ok", "device": registry.device()}


@app.get("/models")
def models():
    return {
        "models": registry.list_models(),
        "device": registry.device(),
        "downloads_allowed": registry.ALLOW_DOWNLOAD,
    }


@app.post("/models/{model_id}/download")
def download_model(model_id: str):
    try:
        spec = registry.get_spec(model_id)
        if spec.kind not in registry.USER_KINDS:
            raise ValueError(f"Unknown model '{model_id}'.")
        registry.start_download(model_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from None
    except PermissionError as e:
        raise HTTPException(403, str(e)) from None
    return registry.describe(spec)


@app.post("/detect_faces")
def detect_faces(
    meme_file: UploadFile = File(..., description="Image to detect faces in"),
    purpose: str = Form("meme", description="'meme' (cartoon fallback allowed) or 'source' (real faces only)"),
):
    data = _read(meme_file, "meme_file")
    return {"faces": _run(pipeline.detect, data, purpose)}


@app.post("/swap")
def swap(
    meme_file: UploadFile = File(..., description="The meme containing the face(s) to replace"),
    face_file: list[UploadFile] = File(..., description="One or more photos of the replacement face(s)"),
    face_map: str | None = Form(None, description='JSON: meme face index → source index, e.g. {"0": 1}'),
    manual_faces: str | None = Form(None, description="JSON: hand-drawn boxes [[x1, y1, x2, y2], ...]"),
    swap_model: str = Form("", description="Swapper id from /models (default: inswapper_128)"),
    enhancer: str = Form("none", description="Face restorer id from /models, or 'none'"),
    enhancer_blend: float = Form(0.8, ge=0, le=1, description="Restorer strength, 0–1"),
    occlusion: bool = Form(False, description="Keep objects covering the face (needs xseg_1)"),
    upscaler: str = Form("none", description="Upscaler id from /models, or 'none'"),
):
    """Swap faces and return the result as a PNG.

    Without `face_map`, every person in the meme gets a source face in turn
    (the same person appearing twice gets the same face). Indices in
    `face_map` cover detected faces first, then `manual_faces`.
    """
    if len(face_file) > MAX_SOURCE_FACES:
        raise HTTPException(400, f"At most {MAX_SOURCE_FACES} source photos are allowed.")
    meme_data = _read(meme_file, "meme_file")
    sources = [_read(f, "face_file") for f in face_file]
    options = pipeline.SwapOptions(swap_model, enhancer, enhancer_blend, occlusion, upscaler)

    png, info = _run(
        pipeline.swap, meme_data, sources,
        _parse_json(face_map, "face_map", dict),
        _parse_json(manual_faces, "manual_faces", list),
        options,
    )
    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Content-Disposition": "inline; filename=swapped.png",
            "X-CMeme-Info": json.dumps(info),
        },
    )
