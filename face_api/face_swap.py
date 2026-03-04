import os
import urllib.request
import cv2
import numpy as np
import insightface
from insightface.app import FaceAnalysis

# ── Model paths ───────────────────────────────────────────────────────────────

MODELS_DIR = os.environ.get("MODELS_DIR", "/app/models")
INSWAPPER_MODEL = os.path.join(MODELS_DIR, "inswapper_128.onnx")
ANIME_CASCADE_PATH = os.path.join(MODELS_DIR, "lbpcascade_animeface.xml")
ANIME_CASCADE_URL = (
    "https://raw.githubusercontent.com/nagadomi/"
    "lbpcascade_animeface/master/lbpcascade_animeface.xml"
)


# ── InsightFace models (lazy singletons) ──────────────────────────────────────

def _get_face_analyser():
    """Initialise and return the InsightFace face analyser."""
    app = FaceAnalysis(
        name="buffalo_l",
        root=MODELS_DIR,
        providers=["CPUExecutionProvider"],
    )
    # det_thresh lowered slightly from default 0.5 → 0.35 to catch
    # stylised / partially-obscured real faces.
    app.prepare(ctx_id=0, det_size=(640, 640), det_thresh=0.35)
    return app


def _get_swapper():
    """Load the inswapper_128 ONNX model."""
    if not os.path.exists(INSWAPPER_MODEL):
        raise FileNotFoundError(
            f"inswapper_128.onnx not found at {INSWAPPER_MODEL}. "
            "Please download it and place it in the models/ directory. "
            "See README.md for the download link."
        )
    return insightface.model_zoo.get_model(
        INSWAPPER_MODEL,
        download=False,
        download_zip=False,
    )


_face_analyser = None
_swapper = None


def get_models():
    """Lazy-load and return (face_analyser, swapper) tuple."""
    global _face_analyser, _swapper
    if _face_analyser is None:
        _face_analyser = _get_face_analyser()
    if _swapper is None:
        _swapper = _get_swapper()
    return _face_analyser, _swapper


# ── Anime / cartoon face detection ───────────────────────────────────────────

def _ensure_anime_cascade() -> str:
    """Download lbpcascade_animeface.xml if not already cached."""
    if not os.path.exists(ANIME_CASCADE_PATH):
        print(f"[face_swap] Downloading anime face cascade → {ANIME_CASCADE_PATH}")
        os.makedirs(MODELS_DIR, exist_ok=True)
        urllib.request.urlretrieve(ANIME_CASCADE_URL, ANIME_CASCADE_PATH)
        print("[face_swap] Anime cascade downloaded ✓")
    return ANIME_CASCADE_PATH


def _detect_anime_faces(img_bgr: np.ndarray) -> list:
    """
    Detect cartoon/anime faces using an LBP cascade.

    Returns a list of duck-typed face objects compatible with inswapper_128:
      .bbox  – float32 [x1, y1, x2, y2]
      .kps   – float32 (5, 2) landmark array estimated from the bounding box
                  0: left eye, 1: right eye, 2: nose, 3: left mouth, 4: right mouth
      .det_score – approximate confidence
    """
    cascade_path = _ensure_anime_cascade()
    cascade = cv2.CascadeClassifier(cascade_path)

    # Histogram-equalised greyscale works best for the cascade
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)

    detections = cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(24, 24),
    )

    faces = []
    for x, y, w, h in (detections if len(detections) else []):
        fx, fy, fw, fh = float(x), float(y), float(w), float(h)
        bbox = np.array([fx, fy, fx + fw, fy + fh], dtype=np.float32)

        # Estimate 5 standard facial landmarks from the bounding box.
        # Relative positions chosen to match InsightFace's expected layout.
        kps = np.array(
            [
                [fx + 0.30 * fw, fy + 0.40 * fh],  # left eye
                [fx + 0.70 * fw, fy + 0.40 * fh],  # right eye
                [fx + 0.50 * fw, fy + 0.58 * fh],  # nose tip
                [fx + 0.35 * fw, fy + 0.78 * fh],  # left mouth corner
                [fx + 0.65 * fw, fy + 0.78 * fh],  # right mouth corner
            ],
            dtype=np.float32,
        )

        # Create a minimal duck-typed Face object
        face = type("AnimeFace", (), {"bbox": bbox, "kps": kps, "det_score": 0.5})()
        faces.append(face)

    return faces


# ── Image helpers ─────────────────────────────────────────────────────────────

def decode_image(data: bytes) -> np.ndarray:
    """Decode image bytes to a numpy BGR array."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image — ensure it is a valid JPEG or PNG.")
    return img


def encode_image(img: np.ndarray, fmt: str = ".png") -> bytes:
    """Encode a numpy BGR array to image bytes."""
    success, buf = cv2.imencode(fmt, img)
    if not success:
        raise ValueError("Could not encode result image.")
    return buf.tobytes()


# ── Core swap logic ───────────────────────────────────────────────────────────

def swap_faces(meme_data: bytes, face_data: bytes) -> bytes:
    """
    Detect all faces in `meme_data` and replace each one with the first face
    found in `face_data`.

    Detection strategy (applied to the meme image):
      1. InsightFace buffalo_l — best for real / photographic faces.
      2. lbpcascade_animeface  — fallback for cartoon / anime / stylised faces.

    Raises ValueError if no face is found in either image.
    Returns the result image as PNG bytes.
    """
    face_analyser, swapper = get_models()

    meme_img = decode_image(meme_data)
    face_img = decode_image(face_data)

    # ── Source face (must be a real photo) ────────────────────────────────────
    source_faces = face_analyser.get(face_img)
    if not source_faces:
        raise ValueError("No face detected in the face-source image.")
    source_face = source_faces[0]

    # ── Meme faces — try InsightFace first, fall back to anime cascade ─────────
    meme_faces = face_analyser.get(meme_img)

    if not meme_faces:
        print("[face_swap] InsightFace found no faces — trying anime cascade fallback…")
        meme_faces = _detect_anime_faces(meme_img)
        if meme_faces:
            print(f"[face_swap] Anime cascade found {len(meme_faces)} face(s) ✓")
        else:
            raise ValueError(
                "No face detected in the meme image. "
                "InsightFace and the anime cascade both found nothing. "
                "Try a clearer image with a visible face."
            )

    # ── Swap every meme face with the source face ─────────────────────────────
    result = meme_img.copy()
    for meme_face in meme_faces:
        result = swapper.get(result, meme_face, source_face, paste_back=True)

    return encode_image(result)
