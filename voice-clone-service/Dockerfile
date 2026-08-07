# Built and run on-demand (docker run --rm) per clone request, not as a
# persistent service — see clone.py for why.
FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

# CPU-only torch — the CUDA build is several GB and useless without a GPU.
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir TTS==0.22.0

COPY clone.py .

# Bake the model weights into the image at build time — this container runs
# fresh per request, so without this every single request would re-download
# them, which is both slow and wasteful.
RUN python3 -c "from TTS.api import TTS; TTS('tts_models/multilingual/multi-dataset/your_tts', progress_bar=False, gpu=False)"

ENTRYPOINT ["python3", "clone.py"]
