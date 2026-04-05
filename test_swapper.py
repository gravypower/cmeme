import cv2
import pickle
import numpy as np

# Create dummy image
img = np.zeros((100, 100, 3), dtype=np.uint8)

# Import models
from face_api.models.face_utils import get_models
face_analyser, swapper = get_models()

print("Models loaded. Waiting for test images...")
