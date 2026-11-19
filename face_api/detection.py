"""Face detection (SCRFD), identity embeddings (ArcFace) and the cartoon fallback."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

import registry
from geometry import warp_face

DET_SIZE = 640
DET_THRESH = 0.35  # a little under the usual 0.5 to catch stylised meme faces
NMS_THRESH = 0.4
_STRIDES = (8, 16, 32)
_ANCHORS_PER_CELL = 2


@dataclass
class Face:
    bbox: np.ndarray                    # float32 [x1, y1, x2, y2]
    kps: np.ndarray | None = None       # float32 (5, 2); None for cartoon/manual
    score: float = 1.0
    kind: str = "real"                  # real | cartoon | manual
    embedding: np.ndarray | None = None

    @property
    def normed_embedding(self) -> np.ndarray:
        return self.embedding / (np.linalg.norm(self.embedding) + 1e-8)

    @property
    def area(self) -> float:
        return float((self.bbox[2] - self.bbox[0]) * (self.bbox[3] - self.bbox[1]))


def _nms(boxes: np.ndarray, scores: np.ndarray, thresh: float) -> list[int]:
    x1, y1, x2, y2 = boxes.T
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        rest = order[1:]
        w = np.maximum(0, np.minimum(x2[i], x2[rest]) - np.maximum(x1[i], x1[rest]))
        h = np.maximum(0, np.minimum(y2[i], y2[rest]) - np.maximum(y1[i], y1[rest]))
        iou = w * h / (areas[i] + areas[rest] - w * h + 1e-8)
        order = rest[iou <= thresh]
    return keep


def _detect_scrfd(img: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Run SCRFD. Returns (boxes Nx4, scores N, kps Nx5x2) in image coordinates."""
    session = registry.get_session("scrfd_10g")
    h, w = img.shape[:2]
    scale = DET_SIZE / max(h, w)
    new_w, new_h = max(int(round(w * scale)), 1), max(int(round(h * scale)), 1)
    canvas = np.zeros((DET_SIZE, DET_SIZE, 3), dtype=np.uint8)
    canvas[:new_h, :new_w] = cv2.resize(img, (new_w, new_h))
    blob = cv2.dnn.blobFromImage(canvas, 1 / 128.0, (DET_SIZE, DET_SIZE), (127.5, 127.5, 127.5), swapRB=True)
    outputs = session.run(None, {session.get_inputs()[0].name: blob})

    n = len(_STRIDES)
    all_boxes, all_scores, all_kps = [], [], []
    for i, stride in enumerate(_STRIDES):
        scores = outputs[i].reshape(-1)
        deltas = outputs[i + n].reshape(-1, 4) * stride
        kps_deltas = outputs[i + 2 * n].reshape(-1, 10) * stride
        cells = DET_SIZE // stride
        ys, xs = np.mgrid[:cells, :cells]
        centers = np.stack([xs, ys], axis=-1).reshape(-1, 2).astype(np.float32) * stride
        centers = np.repeat(centers, _ANCHORS_PER_CELL, axis=0)
        keep = scores >= DET_THRESH
        if not keep.any():
            continue
        c, d, k = centers[keep], deltas[keep], kps_deltas[keep]
        all_boxes.append(np.stack([c[:, 0] - d[:, 0], c[:, 1] - d[:, 1], c[:, 0] + d[:, 2], c[:, 1] + d[:, 3]], axis=1))
        all_kps.append(k.reshape(-1, 5, 2) + c[:, None, :])
        all_scores.append(scores[keep])

    if not all_boxes:
        return np.zeros((0, 4), np.float32), np.zeros(0, np.float32), np.zeros((0, 5, 2), np.float32)
    boxes = np.concatenate(all_boxes) / scale
    scores = np.concatenate(all_scores)
    kps = np.concatenate(all_kps) / scale
    keep = _nms(boxes, scores, NMS_THRESH)
    return boxes[keep].astype(np.float32), scores[keep], kps[keep].astype(np.float32)


def _embed(img: np.ndarray, kps: np.ndarray) -> np.ndarray:
    session = registry.get_session("arcface_w600k_r50")
    crop, _ = warp_face(img, kps, "arcface_112_v2", 112)
    blob = cv2.dnn.blobFromImage(crop, 1 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
    return session.run(None, {session.get_inputs()[0].name: blob})[0].ravel()


def detect_real_faces(img: np.ndarray) -> list[Face]:
    """Detect photographic faces, ordered left to right, with embeddings."""
    boxes, scores, kps = _detect_scrfd(img)
    faces = [
        Face(bbox=b, kps=k, score=float(s), kind="real", embedding=_embed(img, k))
        for b, s, k in zip(boxes, scores, kps)
    ]
    faces.sort(key=lambda f: (f.bbox[0] + f.bbox[2], f.bbox[1]))
    return faces


_cascade: cv2.CascadeClassifier | None = None


def detect_cartoon_faces(img: np.ndarray) -> list[Face]:
    """LBP-cascade fallback for anime / cartoon faces (boxes only)."""
    global _cascade
    if _cascade is None:
        _cascade = cv2.CascadeClassifier(str(registry.model_path("animeface_cascade")))
    gray = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    found = _cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24))
    faces = [
        Face(bbox=np.array([x, y, x + w, y + h], dtype=np.float32), score=0.5, kind="cartoon")
        for x, y, w, h in (found if len(found) else [])
    ]
    faces.sort(key=lambda f: (f.bbox[0] + f.bbox[2], f.bbox[1]))
    return faces


def detect_meme_faces(img: np.ndarray) -> list[Face]:
    """Real faces if there are any, otherwise whatever the cartoon cascade finds."""
    faces = detect_real_faces(img)
    if not faces:
        try:
            faces = detect_cartoon_faces(img)
        except registry.ModelNotInstalled:
            faces = []
    return faces
