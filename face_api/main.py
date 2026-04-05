import io
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from face_swap import swap_faces, get_models, detect_faces_info

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


@app.post("/detect_faces")
async def detect_faces(
    meme_file: UploadFile = File(..., description="The meme image to detect faces in"),
):
    allowed = {"image/jpeg", "image/png", "image/webp"}
    if meme_file.content_type not in allowed:
        raise HTTPException(400, f"meme_file must be JPEG, PNG, or WebP (got {meme_file.content_type})")

    meme_data = await meme_file.read()

    if len(meme_data) > 20 * 1024 * 1024:
        raise HTTPException(400, "meme_file exceeds 20 MB limit")

    try:
        faces = detect_faces_info(meme_data)
        return {"faces": faces}
    except Exception as e:
        logger.exception("Unexpected error during face detection")
        raise HTTPException(500, f"Internal error: {str(e)}")


@app.post("/swap")
async def swap(
    meme_file: UploadFile = File(..., description="The meme image containing face(s) to replace"),
    face_file: list[UploadFile] = File(..., description="Image(s) containing the source face(s) to use"),
    face_map: str = Form(default=None, description="JSON string mapping meme_face_index to source_face_index (e.g. {'0':1})"),
    target_face_index: int = Form(default=None, description="Legacy: Index of the face in the meme to replace. If none, replaces all."),
    manual_faces: str = Form(default=None, description="JSON string array of bounding boxes [[x1,y1,x2,y2]]"),
):
    """
    Accepts images (multipart/form-data):
    - **meme_file**: the meme
    - **face_file**: one or more face-source images
    - **face_map**: optional JSON string to map multiple source faces to multiple meme faces.
    - **manual_faces**: optional JSON string array of hand-drawn face bounding boxes.

    Returns the result as a PNG image.
    """
    import json
    
    allowed = {"image/jpeg", "image/png", "image/webp"}
    if meme_file.content_type not in allowed:
        raise HTTPException(400, f"meme_file must be JPEG, PNG, or WebP (got {meme_file.content_type})")
        
    for f in face_file:
        if f.content_type not in allowed:
            raise HTTPException(400, f"A face_file must be JPEG, PNG, or WebP (got {f.content_type})")

    meme_data = await meme_file.read()

    face_data_list = []
    for f in face_file:
        data = await f.read()
        if len(data) > 20 * 1024 * 1024:
            raise HTTPException(400, "A face_file exceeds 20 MB limit")
        face_data_list.append(data)

    if len(meme_data) > 20 * 1024 * 1024:
        raise HTTPException(400, "meme_file exceeds 20 MB limit")
        
    print("DEBUG: swap called", flush=True)
    print(f"DEBUG: face_map string received: {repr(face_map)}", flush=True)
    parsed_map = None
    if face_map:
        try:
            parsed_map = json.loads(face_map)
            print(f"DEBUG: parsed_map: {parsed_map}", flush=True)
        except Exception as e:
            raise HTTPException(400, f"Invalid face_map JSON: {e}")
    else:
        print("DEBUG: face_map was falsey (None or empty string)", flush=True)

    print(f"DEBUG: calling swap_faces with target_face_index: {target_face_index} and face_map: {parsed_map}", flush=True)

    parsed_manual_faces = None
    if manual_faces:
        try:
            parsed_manual_faces = json.loads(manual_faces)
            print(f"DEBUG: parsed_manual_faces: {parsed_manual_faces}", flush=True)
        except Exception as e:
            raise HTTPException(400, f"Invalid manual_faces JSON: {e}")

    try:
        result_bytes = swap_faces(meme_data, face_data_list, parsed_map, target_face_index, parsed_manual_faces)
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
