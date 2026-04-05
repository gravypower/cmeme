import requests
import json
import cv2
import numpy as np

# Create valid 10x10 dummy image
img = np.zeros((10, 10, 3), dtype=np.uint8)
cv2.imwrite("test_img.png", img)

url = "http://localhost:8001/swap"
files = [
    ("meme_file", ("m.png", open("test_img.png", "rb"), "image/png")),
    ("face_file", ("f.png", open("test_img.png", "rb"), "image/png")),
]
data = {
    "face_map": '{"1": 0}'
}

print("Sending request...")
resp = requests.post(url, files=files, data=data)
print(resp.status_code)
if resp.status_code != 200:
    print(resp.text)
