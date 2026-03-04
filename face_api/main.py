import io
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from face_swap import swap_faces, get_models

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-load models at startup so the first request isn't slow."""
    logger.info("Loading InsightFace models — this may take a minute on first run...")
    try:
        get_models()
        logger.info("Models loaded successfully.")
    except FileNotFoundError as e:
        logger.warning(f"Model load warning: {e}")
        logger.warning("The /swap endpoint will error until inswapper_128.onnx is placed in models/")
    yield


app = FastAPI(
    title="CMeme Face Swap API",
    description="Replace faces in meme images using InsightFace inswapper.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://localhost:8001",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/swap")
async def swap(
    meme_file: UploadFile = File(..., description="The meme image containing face(s) to replace"),
    face_file: UploadFile = File(..., description="Image containing the source face to use"),
):
    """
    Accepts two images (multipart/form-data):
    - **meme_file**: the meme — all detected faces will be swapped
    - **face_file**: the face-source — the first detected face is used as the replacement

    Returns the result as a PNG image.
    """
    allowed = {"image/jpeg", "image/png", "image/webp"}
    if meme_file.content_type not in allowed:
        raise HTTPException(400, f"meme_file must be JPEG, PNG, or WebP (got {meme_file.content_type})")
    if face_file.content_type not in allowed:
        raise HTTPException(400, f"face_file must be JPEG, PNG, or WebP (got {face_file.content_type})")

    meme_data = await meme_file.read()
    face_data = await face_file.read()

    if len(meme_data) > 20 * 1024 * 1024:
        raise HTTPException(400, "meme_file exceeds 20 MB limit")
    if len(face_data) > 20 * 1024 * 1024:
        raise HTTPException(400, "face_file exceeds 20 MB limit")

    try:
        result_bytes = swap_faces(meme_data, face_data)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.exception("Unexpected error during face swap")
        raise HTTPException(500, f"Internal error: {str(e)}")

    return Response(
        content=result_bytes,
        media_type="image/png",
        headers={"Content-Disposition": "inline; filename=swapped.png"},
    )
