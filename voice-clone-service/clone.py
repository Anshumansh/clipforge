#!/usr/bin/env python3
"""On-demand voice cloning: given a reference audio sample and target text,
synthesizes speech in the reference speaker's voice.

Run per-request via `docker run --rm` (see lib/providers/voice-clone.ts) rather
than as a persistent service — the model only occupies memory for the
duration of one render, not 24/7 on an already resource-constrained VPS.

Uses Coqui TTS's YourTTS model: free, open source, zero-shot voice cloning
from a single short reference clip, and meaningfully lighter than XTTS-v2
(fewer parameters, faster CPU inference) — the right tradeoff on a 4-vCPU
box with no GPU.
"""
import sys
import json


def main():
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: clone.py <reference_audio> <text> <output_path>"}), file=sys.stderr)
        sys.exit(1)

    reference_audio, text, output_path = sys.argv[1], sys.argv[2], sys.argv[3]

    try:
        from TTS.api import TTS
    except ImportError as e:
        print(json.dumps({"error": f"TTS library not available: {e}"}), file=sys.stderr)
        sys.exit(1)

    try:
        tts = TTS("tts_models/multilingual/multi-dataset/your_tts", progress_bar=False, gpu=False)
        tts.tts_to_file(
            text=text,
            speaker_wav=reference_audio,
            language="en",
            file_path=output_path,
        )
        print(json.dumps({"ok": True, "output": output_path}))
    except Exception as e:  # noqa: BLE001 - report any failure back to the caller as JSON
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
