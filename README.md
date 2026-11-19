# CMeme – AI Meme Face Swapper

Put anyone's face into any meme. Pick a popular meme, caption a template or
upload your own image, add one or more face photos, and choose which face goes
where. A choice of swap, restoration and upscaling models controls the quality.

```
┌─────────────────────────────┐
│   Deno Fresh  (port 8000)   │  ← UI + thin proxy (routes/api/*)
└──────────┬──────────────────┘
           │ multipart / JSON
           ▼
┌─────────────────────────────┐
│  Python FastAPI (port 8001) │  ← ONNX Runtime pipeline
│  detect → swap → restore →  │
│  upscale                    │
└─────────────────────────────┘
```

## Models

Everything runs locally on ONNX Runtime. The three core models are downloaded
automatically on first start (~700 MB); the rest are optional and are fetched
when you click **Download** next to them in the *Models & quality* panel.

| Kind | Models | What it does |
|------|--------|--------------|
| Face detection | SCRFD 10G, anime-face cascade (fallback) | Finds faces; you can also draw boxes by hand |
| Face swap | **InSwapper 128** (default), InSwapper 128 FP16, HyperSwap 1A/1B/1C 256, SimSwap 256 | Replaces the identity of a face |
| Face restoration | GFPGAN 1.4, CodeFormer, GPEN-BFR 512, RestoreFormer++ | Sharpens the swapped face (adjustable strength) |
| Occlusion mask | XSeg | Keeps hands, glasses, hair or text in front of the face |
| Upscaling | Real-ESRGAN ×2 / ×4 | Enlarges the finished meme |

Hand-drawn boxes and cartoon faces have no landmarks to swap onto, so the
source face is aligned and blended into the box instead.

> **Licences:** most of these weights (InSwapper, the InsightFace detector and
> recogniser, SimSwap, CodeFormer, GPEN, HyperSwap) are released for
> **non-commercial / research use only**. Check each model's licence before
> running this as a public or monetised service.

## Run with Docker

```powershell
docker compose up --build
```

Open **http://localhost:8000**. Models are stored in `face_api/models/` on the
host, so they survive rebuilds.

| Variant | Command |
|---------|---------|
| NVIDIA GPU | `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build` |
| Frontend hot reload | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` |
| Public Cloudflare Tunnel | copy `.env.example` to `.env`, set the token, then `docker compose --profile tunnel up` |

## Run without Docker

Needs Python 3.10+ and Deno 2.

```powershell
# Backend
cd face_api
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn main:app --port 8001

# Frontend (second terminal)
cd frontend
deno task start
```

For an NVIDIA GPU without Docker, install `onnxruntime-gpu[cuda,cudnn]`
instead of `onnxruntime`.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKEND_URL` (frontend) | `http://localhost:8001` | Where the proxy sends requests |
| `MODELS_DIR` | `face_api/models` | Where model files are stored |
| `ALLOW_MODEL_DOWNLOAD` | `1` | Set `0` so the server never downloads models (recommended when public) |
| `MAX_LOADED_MODELS` | `4` | Optional models kept in memory at once |
| `ORT_PROVIDERS` | `auto` | Force ONNX Runtime providers, e.g. `CPUExecutionProvider` |

## API

Interactive docs: http://localhost:8001/docs

| Endpoint | Purpose |
|----------|---------|
| `GET /models` | Catalog with install status and download progress |
| `POST /models/{id}/download` | Start downloading an optional model |
| `POST /detect_faces` | Face boxes for an image (`purpose=meme` or `source`) |
| `POST /swap` | Swap faces; options: `swap_model`, `enhancer`, `enhancer_blend`, `occlusion`, `upscaler`, `face_map`, `manual_faces` |

## Tests

```powershell
cd face_api
.venv\Scripts\pip install pytest
.venv\Scripts\python -m pytest
```

## Project structure

```
cmeme/
├── docker-compose.yml          (+ .gpu.yml and .dev.yml overrides)
├── face_api/                   ← Python backend
│   ├── main.py                 ← FastAPI endpoints
│   ├── pipeline.py             ← detect → assign → swap → restore → upscale
│   ├── registry.py             ← model catalog, downloads, session cache
│   ├── detection.py            ← SCRFD + ArcFace + cartoon fallback
│   ├── processors.py           ← swappers, restorers, occluder, upscaler
│   ├── geometry.py             ← alignment, masks, paste-back
│   └── models/                 ← downloaded weights (gitignored)
└── frontend/                   ← Deno Fresh app
    ├── islands/SwapForm.tsx    ← the wizard
    ├── components/             ← Browse / Face / Options / Result stages
    ├── lib/                    ← client helpers + backend proxy
    └── routes/api/             ← proxies to the Python API
```
