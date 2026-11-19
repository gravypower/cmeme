"""Face alignment, masks and paste-back helpers (pure numpy / OpenCV)."""
from __future__ import annotations

import cv2
import numpy as np

# 5-point landmark templates (left eye, right eye, nose, left mouth, right
# mouth) normalised to a unit square. Multiply by the crop size to use.
TEMPLATES: dict[str, np.ndarray] = {
    "arcface_112_v1": np.array([
        [0.35473214, 0.45658929], [0.64526786, 0.45658929], [0.50000000, 0.61154464],
        [0.37913393, 0.77687500], [0.62086607, 0.77687500]], dtype=np.float32),
    "arcface_112_v2": np.array([
        [0.34191607, 0.46157411], [0.65653393, 0.45983393], [0.50022500, 0.64050536],
        [0.37097589, 0.82469196], [0.63151696, 0.82325089]], dtype=np.float32),
    "arcface_128": np.array([
        [0.36167656, 0.40387734], [0.63696719, 0.40235469], [0.50019687, 0.56044219],
        [0.38710391, 0.72160547], [0.61507734, 0.72034453]], dtype=np.float32),
    "ffhq_512": np.array([
        [0.37691676, 0.46864664], [0.62285697, 0.46912813], [0.50123859, 0.61331904],
        [0.39308822, 0.72541100], [0.61150205, 0.72490465]], dtype=np.float32),
}

# Where a face sits inside an ffhq_512-aligned crop (unit coordinates):
# roughly hairline to chin, cheek to cheek.
FFHQ_FACE_RECT = (0.22, 0.20, 0.78, 0.92)  # x1, y1, x2, y2


def estimate_similarity(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Least-squares similarity transform (Umeyama) mapping src → dst. Returns 2x3."""
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    src_mean, dst_mean = src.mean(0), dst.mean(0)
    src_c, dst_c = src - src_mean, dst - dst_mean
    cov = dst_c.T @ src_c / len(src)
    u, s, vt = np.linalg.svd(cov)
    d = np.ones(2)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        d[-1] = -1
    rot = u @ np.diag(d) @ vt
    scale = (s * d).sum() / src_c.var(0).sum()
    m = np.zeros((2, 3))
    m[:, :2] = scale * rot
    m[:, 2] = dst_mean - scale * rot @ src_mean
    return m.astype(np.float32)


def warp_face(img: np.ndarray, kps: np.ndarray, template: str, size: int) -> tuple[np.ndarray, np.ndarray]:
    """Align a face to `template` at `size`×`size`. Returns (crop, 2x3 matrix)."""
    m = estimate_similarity(kps, TEMPLATES[template] * size)
    crop = cv2.warpAffine(img, m, (size, size), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
    return crop, m


def box_mask(size: int, blur: float = 0.3) -> np.ndarray:
    """Square mask with soft edges so the pasted crop fades into the frame."""
    blur_px = int(size * 0.5 * blur)
    edge = max(blur_px // 2, 1)
    mask = np.ones((size, size), dtype=np.float32)
    mask[:edge, :] = 0
    mask[-edge:, :] = 0
    mask[:, :edge] = 0
    mask[:, -edge:] = 0
    if blur_px > 0:
        mask = cv2.GaussianBlur(mask, (0, 0), blur_px * 0.25)
    return mask


def ellipse_mask(size: int, rect: tuple[float, float, float, float], feather: float = 0.06) -> np.ndarray:
    """Soft ellipse inscribed in `rect` (unit coordinates) of a size×size crop."""
    x1, y1, x2, y2 = (v * size for v in rect)
    mask = np.zeros((size, size), dtype=np.float32)
    center = (int((x1 + x2) / 2), int((y1 + y2) / 2))
    axes = (int((x2 - x1) / 2 * (1 - feather)), int((y2 - y1) / 2 * (1 - feather)))
    cv2.ellipse(mask, center, axes, 0, 0, 360, 1.0, -1)
    return cv2.GaussianBlur(mask, (0, 0), size * feather)


def paste_back(frame: np.ndarray, crop: np.ndarray, mask: np.ndarray, m: np.ndarray) -> np.ndarray:
    """Blend `crop` (in the space of matrix `m`) back into `frame` using `mask`.

    Only the region of the frame the crop actually lands on is touched.
    """
    h, w = frame.shape[:2]
    size_h, size_w = crop.shape[:2]
    inv = cv2.invertAffineTransform(m)
    corners = np.array([[0, 0], [size_w, 0], [size_w, size_h], [0, size_h]], dtype=np.float32)
    mapped = corners @ inv[:, :2].T + inv[:, 2]
    x1, y1 = np.floor(mapped.min(0)).astype(int) - 1
    x2, y2 = np.ceil(mapped.max(0)).astype(int) + 1
    x1, y1, x2, y2 = max(x1, 0), max(y1, 0), min(x2, w), min(y2, h)
    if x2 <= x1 or y2 <= y1:
        return frame
    # Shift the inverse transform so it renders straight into the ROI.
    inv_roi = inv.copy()
    inv_roi[:, 2] -= (x1, y1)
    roi_size = (int(x2 - x1), int(y2 - y1))
    warped = cv2.warpAffine(crop, inv_roi, roi_size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    alpha = cv2.warpAffine(mask, inv_roi, roi_size, flags=cv2.INTER_LINEAR).clip(0, 1)[..., None]
    out = frame.copy()
    roi = out[y1:y2, x1:x2].astype(np.float32)
    out[y1:y2, x1:x2] = (alpha * warped.astype(np.float32) + (1 - alpha) * roi).round().clip(0, 255).astype(np.uint8)
    return out


def rect_to_rect(src: tuple[float, float, float, float], dst: tuple[float, float, float, float],
                 max_stretch: float = 1.25) -> np.ndarray:
    """Affine (scale + translate) fitting rect `src` into `dst`, centred.

    Aspect ratio may bend by up to `max_stretch` so a drawn box is mostly
    filled without squashing the face beyond recognition.
    """
    sw, sh = src[2] - src[0], src[3] - src[1]
    dw, dh = dst[2] - dst[0], dst[3] - dst[1]
    sx, sy = dw / sw, dh / sh
    if sx > sy * max_stretch:
        sx = sy * max_stretch
    elif sy > sx * max_stretch:
        sy = sx * max_stretch
    tx = (dst[0] + dst[2]) / 2 - sx * (src[0] + src[2]) / 2
    ty = (dst[1] + dst[3]) / 2 - sy * (src[1] + src[3]) / 2
    return np.array([[sx, 0, tx], [0, sy, ty]], dtype=np.float32)
