import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pipeline  # noqa: E402
import registry  # noqa: E402
from detection import Face  # noqa: E402
from geometry import (TEMPLATES, box_mask, estimate_similarity, paste_back,  # noqa: E402
                      rect_to_rect, warp_face)


def _face(embedding=None, x=0.0):
    return Face(bbox=np.array([x, 0, x + 10, 10], np.float32), embedding=embedding)


def test_similarity_recovers_known_transform():
    src = TEMPLATES["arcface_128"] * 128
    angle, scale, shift = 0.3, 1.7, np.array([40.0, -12.0])
    rot = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    dst = scale * src @ rot.T + shift
    m = estimate_similarity(src, dst)
    assert np.allclose(m[:, :2], scale * rot, atol=1e-4)
    assert np.allclose(m[:, 2], shift, atol=1e-3)


def test_paste_back_roundtrip_only_touches_face_region():
    rng = np.random.default_rng(0)
    frame = rng.integers(0, 255, (300, 400, 3), dtype=np.uint8)
    kps = TEMPLATES["arcface_128"] * 90 + (150, 100)
    crop, m = warp_face(frame, kps.astype(np.float32), "arcface_128", 128)
    white = np.full_like(crop, 255)
    out = paste_back(frame, white, box_mask(128), m)
    assert np.array_equal(out[:40], frame[:40])            # far from the face: untouched
    assert out[145, 195].min() > 250                        # centre of the face: replaced
    assert frame is not out and frame[145, 195].min() <= 250


def test_paste_back_outside_frame_is_noop():
    frame = np.zeros((50, 50, 3), np.uint8)
    m = np.array([[1, 0, -500], [0, 1, -500]], np.float32)
    assert paste_back(frame, np.full((32, 32, 3), 255, np.uint8), box_mask(32), m) is frame


def test_rect_to_rect_limits_stretch():
    m = rect_to_rect((0, 0, 10, 10), (0, 0, 100, 20))
    assert m[1, 1] == pytest.approx(2.0)
    assert m[0, 0] == pytest.approx(2.5)                    # capped at 1.25× the other axis
    assert m[0, 2] + m[0, 0] * 5 == pytest.approx(50)       # still centred


def test_same_person_gets_same_source():
    a, b = np.eye(512, dtype=np.float32)[:2]
    faces = [_face(a), _face(b), _face(a * 3), _face(None)]
    assert pipeline.cluster_identities(faces) == [[0, 2], [1], [3]]
    assert pipeline.auto_assign(faces, 2) == {0: 0, 2: 0, 1: 1, 3: 0}


def test_face_map_validation():
    assert pipeline._parse_face_map({"1": 0}, 2, 1) == {1: 0}
    with pytest.raises(ValueError):
        pipeline._parse_face_map({"2": 0}, 2, 1)
    with pytest.raises(ValueError):
        pipeline._parse_face_map({"0": 1}, 2, 1)
    with pytest.raises(ValueError):
        pipeline._parse_face_map({"x": 0}, 2, 1)


def test_manual_face_is_clamped_and_validated():
    face = pipeline._manual_face([-20, 10, 80, 500], 100, 100)
    assert face.bbox.tolist() == [0, 10, 80, 100] and face.kind == "manual"
    with pytest.raises(ValueError):
        pipeline._manual_face([5, 5, 6, 6], 100, 100)


def test_decode_rejects_garbage():
    with pytest.raises(ValueError):
        pipeline.decode_image(b"not an image")


def test_catalog_is_consistent():
    assert registry.default_id("swapper") == "inswapper_128"
    for spec in registry.CATALOG.values():
        assert spec.files and all(f.url.startswith("https://") for f in spec.files)
    with pytest.raises(ValueError):
        registry.get_spec("gfpgan_1.4", "swapper")


needs_models = pytest.mark.skipif(
    any(not registry.CATALOG[i].installed for i in ("scrfd_10g", "arcface_w600k_r50")),
    reason="core models not downloaded",
)


@needs_models
def test_blank_image_has_no_faces_and_swap_reports_it():
    ok, buf = cv2.imencode(".png", np.full((64, 64, 3), 200, np.uint8))
    blank = buf.tobytes()
    assert pipeline.detect(blank, "source") == []
    with pytest.raises(ValueError, match="No face detected in source photo #1"):
        pipeline.swap(blank, [blank])
