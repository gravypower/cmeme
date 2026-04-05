import os
import urllib.request
import cv2
import numpy as np
import insightface
from insightface.app import FaceAnalysis
import hashlib
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
        face = type("AnimeFace", (), {"bbox": bbox, "kps": kps, "det_score": 0.5, "is_manual": True})()
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


# ── In-Memory Caching ─────────────────────────────────────────────────────────

_mem_cache = {}

def _get_cached_faces(meme_data: bytes):
    """Return cached faces for the given image bytes, or None if not cached."""
    h = hashlib.md5(meme_data).hexdigest()
    return _mem_cache.get(h)

def _set_cached_faces(meme_data: bytes, faces: list):
    """Save detected faces to the in-memory cache."""
    # Prevent unbounded growth by keeping it small
    if len(_mem_cache) > 500:
        _mem_cache.clear()
    h = hashlib.md5(meme_data).hexdigest()
    _mem_cache[h] = faces

def _get_meme_faces(meme_data: bytes, face_analyser) -> list:
    """Get faces from cache, or detect and cache them."""
    cached = _get_cached_faces(meme_data)
    if cached is not None:
        print("[face_swap] Loaded meme faces from cache! ✓")
        return cached

    meme_img = decode_image(meme_data)
    meme_faces = face_analyser.get(meme_img)
    if not meme_faces:
        print("[face_swap] InsightFace found no faces — trying anime cascade fallback…")
        meme_faces = _detect_anime_faces(meme_img)
        if meme_faces:
            print(f"[face_swap] Anime cascade found {len(meme_faces)} face(s) ✓")

    if meme_faces:
        _set_cached_faces(meme_data, meme_faces)
        
    return meme_faces


# ── Core swap logic ───────────────────────────────────────────────────────────

def detect_faces_info(meme_data: bytes) -> list[dict]:
    """
    Detect all faces in `meme_data` and return their bounding boxes.
    Returns a list of dicts: `[{"box": [x1, y1, x2, y2]}, ...]`.
    """
    face_analyser, _ = get_models()
    meme_faces = _get_meme_faces(meme_data, face_analyser)
    
    if not meme_faces:
        return []

    res = []
    for face in meme_faces:
        res.append({
            "box": [float(x) for x in face.bbox]
        })
    return res

def swap_faces(meme_data: bytes, face_data_list: list[bytes], face_map: dict[str, int] = None, target_face_index: int = None, manual_faces: list[list[float]] = None) -> bytes:
    """
    Replaces faces in `meme_data` using source faces from `face_data_list`.
    
    If `face_map` is provided, it maps stringified meme face indices to source face indices.
    E.g. {"0": 1, "2": 0} -> replace meme face 0 with source face 1, meme face 2 with source face 0.
    Any unmapped faces are untouched.
    
    If `face_map` is NOT provided, it falls back to the old behavior:
      Replaces all faces (or just `target_face_index`) with the FIRST source face (`face_data_list[0]`).

    If `manual_faces` is provided, it must be a list of lists of floats `[[x1, y1, x2, y2], ...]`.
    These boxes will be added as estimated faces to `meme_faces`.

    Raises ValueError if no face is found in source images, or if indices are out of bounds.
    Returns the result image as PNG bytes.
    """
    face_analyser, swapper = get_models()

    meme_img = decode_image(meme_data)
    
    # ── Parse source faces ─────────────────────────────────────────────────────
    source_faces = []
    for i, f_data in enumerate(face_data_list):
        f_img = decode_image(f_data)
        faces = face_analyser.get(f_img)
        if not faces:
            raise ValueError(f"No face detected in source face image #{i+1}.")
        # Store original image so we can extract crops manually later
        faces[0].raw_img = f_img
        source_faces.append(faces[0])

    if not source_faces:
        raise ValueError("No source face images provided.")

    # ── Get meme faces ─────────────────────────────────────────────────────────
    meme_faces_raw = _get_meme_faces(meme_data, face_analyser)
    meme_faces = list(meme_faces_raw) if meme_faces_raw else []

    # Inject manual faces
    if manual_faces:
        for m_face_box in manual_faces:
            fx, fy, fx2, fy2 = [float(c) for c in m_face_box]
            fw, fh = fx2 - fx, fy2 - fy
            bbox = np.array([fx, fy, fx2, fy2], dtype=np.float32)

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
            manual_face = type("ManualFace", (), {"bbox": bbox, "kps": kps, "det_score": 1.0, "is_manual": True})()
            meme_faces.append(manual_face)

    if not meme_faces:
        raise ValueError(
            "No face detected in the meme image. "
            "InsightFace and the anime cascade both found nothing. "
            "Try a clearer image with a visible face, or manually draw a face box."
        )

    result = meme_img.copy()

    # ── Swap logic ─────────────────────────────────────────────────────────────
    if face_map:
        print(f"[face_swap] Entering MULTI-FACE MAPPING MODE with face_map: {face_map}", flush=True)
        # Multi-face mapping mode
        for m_idx_str, s_idx in face_map.items():
            print(f"[face_swap] Swapping meme face {m_idx_str} with source face {s_idx}", flush=True)
            m_idx = int(m_idx_str)
            if m_idx < 0 or m_idx >= len(meme_faces):
                raise ValueError(f"Meme face index {m_idx} out of bounds.")
            if s_idx < 0 or s_idx >= len(source_faces):
                raise ValueError(f"Source face index {s_idx} out of bounds.")
            
            meme_face = meme_faces[m_idx]
            src_face = source_faces[s_idx]
            
            if getattr(meme_face, "is_manual", False):
                result = _replace_and_blend_face(result, meme_face, src_face)
            else:
                result = swapper.get(result, meme_face, src_face, paste_back=True)
            
    else:
        print("[face_swap] Entering SINGLE FALLBACK MODE because face_map was falsey", flush=True)
        # Old mode: apply the first source face to all (or one) meme face
        
        target_meme_faces = meme_faces
        if target_face_index is not None:
            if target_face_index < 0 or target_face_index >= len(meme_faces):
                raise ValueError(f"target_face_index {target_face_index} is out of bounds for {len(meme_faces)} detected faces.")
            src_face = source_faces[0]
            
            meme_face = meme_faces[target_face_index]
            if getattr(meme_face, "is_manual", False):
                result = _replace_and_blend_face(result, meme_face, src_face)
            else:
                result = swapper.get(result, meme_face, src_face, paste_back=True)
        else:
            # If no map and no target index, random assignment with identity clustering
            import random
            
            clusters = []
            for m_idx, m_face in enumerate(meme_faces):
                if getattr(m_face, 'embedding', None) is None:
                    clusters.append([m_idx])
                    continue
                    
                found_cluster = False
                for cluster in clusters:
                    rep_face = meme_faces[cluster[0]]
                    if getattr(rep_face, 'embedding', None) is None:
                        continue
                        
                    emb1 = m_face.embedding
                    emb2 = rep_face.embedding
                    # InsightFace embeddings are usually l2 normalized, but we normalize to be safe
                    sim = np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2) + 1e-8)
                    
                    if sim > 0.4:  # Threshold for same person
                        cluster.append(m_idx)
                        found_cluster = True
                        break
                        
                if not found_cluster:
                    clusters.append([m_idx])
                    
            print(f"[face_swap] Clustered {len(meme_faces)} faces into {len(clusters)} unique identities.", flush=True)
            for cluster in clusters:
                s_idx = random.randint(0, len(source_faces) - 1)
                for m_idx in cluster:
                    print(f"[face_swap] Auto-random mapped meme face {m_idx} -> src face {s_idx}", flush=True)
                    meme_face = meme_faces[m_idx]
                    src_face = source_faces[s_idx]
                    
                    if getattr(meme_face, "is_manual", False):
                        result = _replace_and_blend_face(result, meme_face, src_face)
                    else:
                        result = swapper.get(result, meme_face, src_face, paste_back=True)

    return encode_image(result)


def _replace_and_blend_face(meme_img: np.ndarray, meme_face, src_face) -> np.ndarray:
    """
    Fallback method for manual face boxes: Crops the source face, resizes it to fit
    the target bounding box, and blends it seamlessly into the meme image.
    """
    try:
        # 1. Extract the source face crop
        s_bbox = src_face.bbox.astype(int)
        # Add a little padding to the source face crop so it blends better
        pad_x = int((s_bbox[2] - s_bbox[0]) * 0.15)
        pad_y = int((s_bbox[3] - s_bbox[1]) * 0.15)
        
        sh, sw = src_face.raw_img.shape[:2]
        sx1 = max(0, s_bbox[0] - pad_x)
        sy1 = max(0, s_bbox[1] - pad_y)
        sx2 = min(sw, s_bbox[2] + pad_x)
        sy2 = min(sh, s_bbox[3] + pad_y)
        
        src_crop = src_face.raw_img[sy1:sy2, sx1:sx2]
        
        # 2. Get target box dimensions
        m_bbox = meme_face.bbox.astype(int)
        mh, mw = meme_img.shape[:2]
        
        # Ensure target box is within bounds
        mx1 = max(0, m_bbox[0])
        my1 = max(0, m_bbox[1])
        mx2 = min(mw, m_bbox[2])
        my2 = min(mh, m_bbox[3])
        
        tw = mx2 - mx1
        th = my2 - my1
        
        if tw <= 0 or th <= 0:
            return meme_img # Box is outside bounds somehow
            
        # 3. Resize source crop to exactly fit the target bounding box
        resized_crop = cv2.resize(src_crop, (tw, th))
        
        # 4. Create an elliptical mask for smooth blending
        mask = np.zeros((th, tw), dtype=np.uint8)
        center = (tw // 2, th // 2)
        axes = (int(tw * 0.45), int(th * 0.45))
        cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
        
        # Blur the mask so edges blend softly
        mask = cv2.GaussianBlur(mask, (21, 21), 11)
        
        # Create an alpha mask [0.0, 1.0]
        alpha = mask.astype(float) / 255.0
        
        # 5. Alpha blending (keeps source likeness 100% strong without color bleeds)
        res = meme_img.copy()
        
        # Expand alpha dimensions to match color channels (tw, th, 3)
        alpha_3d = np.expand_dims(alpha, axis=2)
        
        # Blend the region
        roi = res[my1:my2, mx1:mx2]
        res[my1:my2, mx1:mx2] = roi * (1 - alpha_3d) + resized_crop * alpha_3d
        
        return res
        
    except Exception as e:
        print(f"[face_swap] replace_and_blend_face fallback failed: {e}", flush=True)
        return meme_img
