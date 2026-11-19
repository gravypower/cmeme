FROM python:3.12-slim

WORKDIR /app

# ORT_PACKAGE lets docker-compose.gpu.yml swap in the CUDA build
# ("onnxruntime-gpu[cuda,cudnn]" bundles the CUDA libraries as pip wheels).
ARG ORT_PACKAGE=onnxruntime
COPY requirements.txt .
RUN grep -v '^onnxruntime' requirements.txt > /tmp/requirements.txt \
    && pip install --no-cache-dir -r /tmp/requirements.txt "${ORT_PACKAGE}"

COPY . .

# Models live in a volume so they survive rebuilds; missing core models are
# downloaded at startup.
ENV MODELS_DIR=/app/models
RUN mkdir -p /app/models

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
