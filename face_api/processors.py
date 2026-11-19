"""Model wrappers: face swappers, face restorers, occlusion masks, upscalers."""
from __future__ import annotations

import cv2
import numpy as np

import registry
from detection import Face
from geometry import (FFHQ_FACE_RECT, box_mask, ellipse_mask, paste_back,
                      rect_to_rect, warp_face)


def _cast(session, index: int, array: np.ndarray) -> np.ndarray:
    """Match the dtype an ONNX input expects (some models are half precision)."""
    kind = session.get_inputs()[index].type
    dtype = {"tensor(float16)": np.float16, "tensor(double)": np.float64}.get(kind, np.float32)
    return array.astype(dtype)


def _run(session, feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
    inputs = session.get_inputs()
    return session.run(None, {
        i.name: _cast(session, n, feeds[i.name]) for n, i in enumerate(inputs)
    })


def _to_blob(crop_bgr: np.ndarray, mean, std) -> np.ndarray:
    rgb = crop_bgr[:, :, ::-1].astype(np.float32) / 255.0
    rgb = (rgb - np.array(mean, np.float32)) / np.array(std, np.float32)
    return rgb.transpose(2, 0, 1)[None]


def _from_blob(out: np.ndarray, mean=(0, 0, 0), std=(1, 1, 1)) -> np.ndarray:
    rgb = out.astype(np.float32).transpose(1, 2, 0)
    rgb = rgb * np.array(std, np.float32) + np.array(mean, np.float32)
    return (rgb.clip(0, 1)[:, :, ::-1] * 255).round().astype(np.uint8)


# ── Occlusion mask ───────────────────────────────────────────────────────────

class Occluder:
    def __init__(self, model_id: str):
        self.spec = registry.get_spec(model_id, "occluder")
        registry.model_path(model_id)  # raises ModelNotInstalled early

    def mask(self, crop_bgr: np.ndarray) -> np.ndarray:
        """1.0 where the face is visible, 0.0 where something covers it."""
        session = registry.get_session(self.spec.id)
        size = self.spec.options["size"]
        blob = cv2.resize(crop_bgr, (size, size)).astype(np.float32)[None] / 255.0
        out = _run(session, {session.get_inputs()[0].name: blob})[0][0]
        mask = out.astype(np.float32).reshape(size, size).clip(0, 1)
        mask = cv2.resize(mask, crop_bgr.shape[1::-1])
        return ((cv2.GaussianBlur(mask, (0, 0), 5).clip(0.5, 1) - 0.5) * 2).astype(np.float32)


# ── Face swappers ────────────────────────────────────────────────────────────

class Swapper:
    def __init__(self, model_id: str):
        self.spec = registry.get_spec(model_id, "swapper")
        self.opt = self.spec.options
        for i in range(len(self.spec.files)):
            registry.model_path(model_id, i)

    def _emap(self) -> np.ndarray:
        """InSwapper's embedding projection, stored as the graph's last initializer."""
        path = registry.model_path(self.spec.id)
        cache = path.with_suffix(".emap.npy")
        if cache.is_file():
            return np.load(cache)
        import onnx
        from onnx import numpy_helper
        emap = numpy_helper.to_array(onnx.load(str(path)).graph.initializer[-1]).astype(np.float32)
        try:
            np.save(cache, emap)
        except OSError:
            pass
        return emap

    def _source_embedding(self, source: Face) -> np.ndarray:
        kind = self.opt["type"]
        if kind == "inswapper":
            if not hasattr(self, "_emap_cached"):
                self._emap_cached = self._emap()
            latent = source.normed_embedding.reshape(1, -1) @ self._emap_cached
            return latent / np.linalg.norm(latent)
        if kind == "hyperswap":
            return source.normed_embedding.reshape(1, -1)
        if kind == "simswap":
            converter = registry.get_session(self.spec.id, 1)
            emb = _run(converter, {converter.get_inputs()[0].name: source.embedding.reshape(1, -1)})[0]
            return emb / np.linalg.norm(emb)
        raise ValueError(f"Unsupported swapper type '{kind}'")

    def swap(self, frame: np.ndarray, original: np.ndarray, target: Face, source: Face,
             occluder: Occluder | None = None) -> np.ndarray:
        """Swap `source`'s identity onto `target` in `frame`.

        `original` is the untouched meme, used for the occlusion mask so an
        earlier swap of an overlapping face doesn't confuse it.
        """
        session = registry.get_session(self.spec.id)
        size = self.opt["size"]
        crop, m = warp_face(frame, target.kps, self.opt["template"], size)
        feeds = {}
        for inp in session.get_inputs():
            if inp.name == "source":
                feeds[inp.name] = self._source_embedding(source)
            else:
                feeds[inp.name] = _to_blob(crop, self.opt["mean"], self.opt["std"])
        outputs = _run(session, feeds)
        out = next(o for o in outputs if o.ndim == 4 and o.shape[1] == 3)[0]
        if self.opt["type"] == "hyperswap":
            swapped = _from_blob(out, self.opt["mean"], self.opt["std"])
        else:
            swapped = _from_blob(out)

        mask = box_mask(size)
        if occluder is not None:
            original_crop, _ = warp_face(original, target.kps, self.opt["template"], size)
            mask = np.minimum(mask, occluder.mask(original_crop))
        return paste_back(frame, swapped, mask, m)


# ── Face restorers ───────────────────────────────────────────────────────────

class Enhancer:
    def __init__(self, model_id: str):
        self.spec = registry.get_spec(model_id, "enhancer")
        registry.model_path(model_id)

    def enhance(self, frame: np.ndarray, face: Face, blend: float = 0.8) -> np.ndarray:
        session = registry.get_session(self.spec.id)
        size = self.spec.options["size"]
        crop, m = warp_face(frame, face.kps, self.spec.options["template"], size)
        feeds = {}
        for inp in session.get_inputs():
            if inp.name == "weight":  # CodeFormer fidelity knob
                feeds[inp.name] = np.array([1.0])
            else:
                feeds[inp.name] = _to_blob(crop, (0.5, 0.5, 0.5), (0.5, 0.5, 0.5))
        out = _run(session, feeds)[0][0]
        restored = _from_blob(out.clip(-1, 1), (0.5, 0.5, 0.5), (0.5, 0.5, 0.5))
        return paste_back(frame, restored, box_mask(size) * float(np.clip(blend, 0, 1)), m)


# ── Whole-image upscaler ─────────────────────────────────────────────────────

class Upscaler:
    MAX_INPUT_PIXELS = 1600 * 1600
    TILE = 256
    PAD = 16

    def __init__(self, model_id: str):
        self.spec = registry.get_spec(model_id, "upscaler")
        registry.model_path(model_id)

    def upscale(self, img: np.ndarray) -> np.ndarray:
        h, w = img.shape[:2]
        if h * w > self.MAX_INPUT_PIXELS:
            raise ValueError("This image is already large — upscaling is limited to images under 1600×1600.")
        session = registry.get_session(self.spec.id)
        name = session.get_inputs()[0].name
        scale = self.spec.options["scale"]
        tile, pad = self.TILE, self.PAD
        step = tile - 2 * pad
        rows, cols = -(-h // step), -(-w // step)
        padded = cv2.copyMakeBorder(img, pad, rows * step - h + pad, pad, cols * step - w + pad, cv2.BORDER_REFLECT_101)
        out = np.zeros((rows * step * scale, cols * step * scale, 3), dtype=np.uint8)
        for r in range(rows):
            for c in range(cols):
                y, x = r * step, c * step
                blob = _to_blob(padded[y:y + tile, x:x + tile], (0, 0, 0), (1, 1, 1))
                big = _from_blob(_run(session, {name: blob})[0][0])
                inner = big[pad * scale:(tile - pad) * scale, pad * scale:(tile - pad) * scale]
                out[y * scale:(y + step) * scale, x * scale:(x + step) * scale] = inner
        return out[:h * scale, :w * scale]


# ── Direct paste for cartoon / hand-drawn boxes ──────────────────────────────

def paste_face(frame: np.ndarray, target: Face, source_img: np.ndarray, source: Face) -> np.ndarray:
    """Place the real source face inside a box that has no usable landmarks.

    The source is aligned upright first, so the result is level and centred
    in the box regardless of how the source photo was framed.
    """
    size = 512
    aligned, _ = warp_face(source_img, source.kps, "ffhq_512", size)
    face_rect = tuple(v * size for v in FFHQ_FACE_RECT)
    # paste_back expects frame→crop, so build crop→frame and invert it.
    crop_to_frame = rect_to_rect(face_rect, tuple(float(v) for v in target.bbox))
    frame_to_crop = cv2.invertAffineTransform(crop_to_frame)
    return paste_back(frame, aligned, ellipse_mask(size, FFHQ_FACE_RECT), frame_to_crop)
