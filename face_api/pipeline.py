"""The swap pipeline: decode → detect → assign → swap → restore → upscale → encode."""
from __future__ import annotations

import hashlib
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass

import cv2
import numpy as np

import registry
from detection import Face, detect_meme_faces, detect_real_faces
from processors import Enhancer, Occluder, Swapper, Upscaler, paste_face

MAX_PIXELS = 36_000_000
SAME_PERSON_SIMILARITY = 0.4

# One inference at a time: keeps memory predictable and model loading simple.
_lock = threading.Lock()


@dataclass
class SwapOptions:
    swap_model: str = ""
    enhancer: str = "none"
    enhancer_blend: float = 0.8
    occlusion: bool = False
    upscaler: str = "none"


def decode_image(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image — make sure it is a valid JPEG, PNG or WebP.")
    if img.shape[0] * img.shape[1] > MAX_PIXELS:
        raise ValueError("Image is too large (max 36 megapixels).")
    return img


def encode_image(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("Could not encode result image.")
    return buf.tobytes()


# ── Detection cache (the UI detects first, then swaps the same image) ────────

_cache: OrderedDict[str, list[Face]] = OrderedDict()
_CACHE_SIZE = 64


def _meme_faces(data: bytes, img: np.ndarray) -> list[Face]:
    key = hashlib.sha1(data).hexdigest()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    faces = detect_meme_faces(img)
    _cache[key] = faces
    while len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return faces


def detect(data: bytes, purpose: str = "meme") -> list[dict]:
    """Faces in an image. purpose='source' only accepts real, swappable faces."""
    img = decode_image(data)
    with _lock:
        faces = detect_real_faces(img) if purpose == "source" else _meme_faces(data, img)
    return [{"box": [float(v) for v in f.bbox], "score": f.score, "kind": f.kind} for f in faces]


# ── Assignment ───────────────────────────────────────────────────────────────

def cluster_identities(faces: list[Face]) -> list[list[int]]:
    """Group face indices that look like the same person (e.g. multi-panel memes)."""
    clusters: list[list[int]] = []
    for idx, face in enumerate(faces):
        if face.embedding is not None:
            for cluster in clusters:
                rep = faces[cluster[0]]
                if rep.embedding is not None and float(
                    face.normed_embedding @ rep.normed_embedding
                ) > SAME_PERSON_SIMILARITY:
                    cluster.append(idx)
                    break
            else:
                clusters.append([idx])
        else:
            clusters.append([idx])
    return clusters


def auto_assign(faces: list[Face], n_sources: int) -> dict[int, int]:
    """No explicit mapping: give each distinct person the next source face in turn."""
    mapping = {}
    for n, cluster in enumerate(cluster_identities(faces)):
        for idx in cluster:
            mapping[idx] = n % n_sources
    return mapping


def _parse_face_map(face_map: dict, n_faces: int, n_sources: int) -> dict[int, int]:
    mapping = {}
    for key, value in face_map.items():
        try:
            m_idx, s_idx = int(key), int(value)
        except (TypeError, ValueError):
            raise ValueError("face_map must map meme face indices to source face indices.") from None
        if not 0 <= m_idx < n_faces:
            raise ValueError(f"Meme face index {m_idx} is out of range ({n_faces} faces).")
        if not 0 <= s_idx < n_sources:
            raise ValueError(f"Source face index {s_idx} is out of range ({n_sources} sources).")
        mapping[m_idx] = s_idx
    return mapping


def _manual_face(box, width: int, height: int) -> Face:
    try:
        x1, y1, x2, y2 = (float(v) for v in box)
    except (TypeError, ValueError):
        raise ValueError("manual_faces must be a list of [x1, y1, x2, y2] boxes.") from None
    x1, x2 = sorted((min(max(x1, 0), width), min(max(x2, 0), width)))
    y1, y2 = sorted((min(max(y1, 0), height), min(max(y2, 0), height)))
    if x2 - x1 < 4 or y2 - y1 < 4:
        raise ValueError("A manually drawn face box is too small.")
    return Face(bbox=np.array([x1, y1, x2, y2], dtype=np.float32), kind="manual")


# ── Swap ─────────────────────────────────────────────────────────────────────

def swap(meme_data: bytes, source_data: list[bytes], face_map: dict | None = None,
         manual_faces: list | None = None, options: SwapOptions | None = None) -> tuple[bytes, dict]:
    """Run the full pipeline. Returns (PNG bytes, info dict)."""
    options = options or SwapOptions()
    started = time.perf_counter()
    if not source_data:
        raise ValueError("No source face images provided.")

    # Resolve every model up front so a missing one fails before any work.
    swapper = Swapper(options.swap_model or registry.default_id("swapper"))
    enhancer = Enhancer(options.enhancer) if options.enhancer not in ("", "none") else None
    occluder = Occluder("xseg_1") if options.occlusion else None
    upscaler = Upscaler(options.upscaler) if options.upscaler not in ("", "none") else None

    meme = decode_image(meme_data)
    source_imgs = [decode_image(d) for d in source_data]

    with _lock:
        sources: list[Face] = []
        for i, img in enumerate(source_imgs):
            found = detect_real_faces(img)
            if not found:
                raise ValueError(f"No face detected in source photo #{i + 1}.")
            sources.append(max(found, key=lambda f: f.area))

        height, width = meme.shape[:2]
        faces = list(_meme_faces(meme_data, meme))
        faces += [_manual_face(b, width, height) for b in (manual_faces or [])]
        if not faces:
            raise ValueError(
                "No face found in the meme. Draw a box around the face you want to replace."
            )

        mapping = (_parse_face_map(face_map, len(faces), len(sources)) if face_map
                   else auto_assign(faces, len(sources)))

        result = meme.copy()
        for m_idx, s_idx in sorted(mapping.items()):
            target, source = faces[m_idx], sources[s_idx]
            if target.kind == "real":
                result = swapper.swap(result, meme, target, source, occluder)
            else:
                result = paste_face(result, target, source_imgs[s_idx], source)

        if enhancer is not None:
            for m_idx in sorted(mapping):
                if faces[m_idx].kind == "real":
                    result = enhancer.enhance(result, faces[m_idx], options.enhancer_blend)

        if upscaler is not None:
            result = upscaler.upscale(result)

    info = {
        "faces_swapped": len(mapping),
        "swap_model": swapper.spec.id,
        "enhancer": enhancer.spec.id if enhancer else "none",
        "occlusion": occluder is not None,
        "upscaler": upscaler.spec.id if upscaler else "none",
        "device": registry.device(),
        "ms": round((time.perf_counter() - started) * 1000),
    }
    return encode_image(result), info
