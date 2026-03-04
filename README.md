# CMeme – AI Meme Face Swapper

Replace faces in any meme with someone else's face, powered by **InsightFace** and **Deno Fresh**.

```
┌─────────────────────────────┐
│   Deno Fresh  (port 8000)   │  ← frontend
│   routes/api/swap.ts proxy  │
└──────────┬──────────────────┘
           │ POST /swap (multipart)
           ▼
┌─────────────────────────────┐
│   Python FastAPI (port 8001)│  ← Docker
│   InsightFace inswapper_128 │
└─────────────────────────────┘
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Deno | 1.40+ |
| Docker Desktop | any recent |

---

## Step 1 — Download the inswapper model

Run the included download script — it will create `face_api/models/` and download the ~500 MB model automatically:

```powershell
cd c:\projects\cmeme
.\download_model.ps1
```

It skips the download if the file already exists, so it's safe to run again.

---

## Step 2 — Start everything with Docker Compose

```powershell
cd c:\projects\cmeme
docker compose up --build
```

On first build Docker will download the Deno image and install Python packages — this takes a few minutes.  
On subsequent starts it's fast.

| Service | URL | Purpose |
|---------|-----|---------|
| 🦕 Frontend | **http://localhost:8000** | ← Open this |
| 🐍 API health | http://localhost:8001/health | Backend check |
| 🐍 API docs | http://localhost:8001/docs | Swagger UI |

---

## Using CMeme

1. Upload a **meme image** (JPEG/PNG/WebP, max 20 MB) — the faces in this image will be replaced
2. Upload a **face source image** — the first detected face is used as the replacement
3. Click **✨ Swap Faces!**
4. Download the result with the **⬇ Download** button

---

## GPU Acceleration (optional)

If you have an **NVIDIA GPU** with nvidia-docker installed:

1. In `face_api/requirements.txt`, change:
   ```
   onnxruntime
   ```
   to:
   ```
   onnxruntime-gpu
   ```

2. In `docker-compose.yml`, add under the `face_api` service:
   ```yaml
   deploy:
     resources:
       reservations:
         devices:
           - driver: nvidia
             count: all
             capabilities: [gpu]
   ```

3. Rebuild: `docker compose up --build`

---

## Project Structure

```
cmeme/
├── docker-compose.yml
├── README.md
├── face_api/               ← Python backend (Docker)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py             ← FastAPI app
│   ├── face_swap.py        ← InsightFace logic
│   └── models/             ← Put inswapper_128.onnx here
└── frontend/               ← Deno Fresh app
    ├── deno.json
    ├── routes/
    │   ├── index.tsx       ← Main page
    │   └── api/swap.ts     ← Proxy to Python
    ├── islands/
    │   └── SwapForm.tsx    ← Interactive UI
    └── static/
        └── styles.css
```
