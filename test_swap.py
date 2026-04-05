import requests
import json

url = "http://localhost:8001/swap"
files = [
    ("meme_file", ("meme.png", open("meme.png", "wb").write(b"fake image data") or open("meme.png", "rb"), "image/png")),
    ("face_file", ("face.png", open("face.png", "wb").write(b"fake image data") or open("face.png", "rb"), "image/png")),
]
data = {
    "face_map": '{"1": 0}'
}
resp = requests.post(url, files=files, data=data)
print(resp.status_code, resp.text)
