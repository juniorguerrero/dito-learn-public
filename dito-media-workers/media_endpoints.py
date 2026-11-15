"""
Dito Learn — RunPod Flash media workers.

Four GPU @Endpoint workers that power Dito's media outputs:

    dito-image  -> FLUX.1-schnell        (story slides, game art, video keyframes, hero image)
    dito-tts    -> Kokoro-82M            (podcast voices, story narration)
    dito-music  -> ACE-Step v1 3.5B      (study songs with lyrics)
    dito-video  -> Wan2.2 TI2V 5B        (image-to-video scenes)

Deploy pattern mirrors the runpod-hackathon gateway workers exactly:
each returns a plain dict, and Dito calls it via  /v2/<id>/runsync.

Every worker supports DEMO_SAFE_MODE=1 (default): it still runs on a real Flash
GPU but returns a lightweight placeholder asset instead of downloading multi-GB
weights — so you can deploy, wire, and demo the full pipeline immediately.
Set DEMO_SAFE_MODE=0 (+ HF_TOKEN for gated models) to load real weights.

Output contract (what Dito's runpod.ts reads):
    image -> {"image_base64": "<png b64>"}
    tts   -> {"audio_base64": "<wav b64>"}
    music -> {"audio_base64": "<wav b64>"}
    video -> {"video_base64": "<mp4 b64>"}
"""
from __future__ import annotations

import base64
import io
import math
import os
import struct
import zlib

# --- Flash decorator shim (same trick the gateway workers use) --------------
if os.getenv("RUNPOD_ENDPOINT_ID"):
    class _RuntimeGpuType:
        NVIDIA_GEFORCE_RTX_4090 = "NVIDIA_GEFORCE_RTX_4090"
        NVIDIA_RTX_A6000 = "NVIDIA_RTX_A6000"
        NVIDIA_H200 = "NVIDIA_H200"

    class PodTemplate:
        def __init__(self, **_kwargs):
            pass

    def Endpoint(**_kwargs):
        def decorator(func):
            return func
        return decorator

    GpuType = _RuntimeGpuType
else:
    from runpod_flash import Endpoint, GpuType, PodTemplate


# torch/torchvision/torchaudio come from the Flash GPU base image (we --exclude them at build).
IMAGE_DEPS = ["diffusers>=0.32.0", "transformers>=4.44.0", "accelerate>=0.33.0", "sentencepiece", "protobuf", "Pillow"]
TTS_DEPS = ["kokoro>=0.9.2", "soundfile", "numpy"]
MUSIC_DEPS = ["transformers>=4.44.0", "accelerate>=0.33.0", "scipy", "soundfile", "numpy"]
VIDEO_DEPS = ["diffusers>=0.32.0", "transformers>=4.44.0", "accelerate>=0.33.0", "ftfy", "imageio", "imageio-ffmpeg", "Pillow"]


def _demo_safe() -> bool:
    return os.getenv("DEMO_SAFE_MODE", "1") == "1"


def _ensure(pkgs: list[tuple[str, str]]) -> None:
    """Install missing pip packages at runtime (torch is already in the base image).
    pkgs = [(import_name, pip_spec), ...]. Installs once per warm worker."""
    import importlib
    import subprocess
    import sys

    missing = []
    for mod, spec in pkgs:
        try:
            importlib.import_module(mod)
        except Exception:
            missing.append(spec)
    if missing:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check", *missing]
        )


# ---------------------------------------------------------------------------
# Placeholder asset generators (used in DEMO_SAFE_MODE — no heavy deps needed)
# ---------------------------------------------------------------------------

def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def _placeholder_png(width: int, height: int, prompt: str) -> str:
    """A real gradient PNG built with pure stdlib (zlib) — no Pillow needed."""
    seed = (sum(ord(c) for c in prompt) if prompt else 0) % 256
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 for this scanline
        for x in range(width):
            r = (x * 255 // max(1, width) + seed) % 256
            g = (y * 255 // max(1, height) + seed // 2) % 256
            b = ((x + y) * 255 // max(1, width + height) + seed) % 256
            raw += bytes((r, g, b))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit truecolor RGB
    idat = zlib.compress(bytes(raw), 6)
    png = sig + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", b"")
    return base64.b64encode(png).decode()


def _sine_wav(seconds: float, freq: float = 330.0, sample_rate: int = 22050) -> str:
    """A short WAV tone so audio players work before real TTS/music weights load."""
    n = int(seconds * sample_rate)
    frames = bytearray()
    for i in range(n):
        env = math.sin(math.pi * i / n)  # fade in/out
        val = int(0.3 * env * 32767 * math.sin(2 * math.pi * freq * i / sample_rate))
        frames += struct.pack("<h", val)
    data = bytes(frames)
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE" + b"fmt " + struct.pack(
        "<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16
    ) + b"data" + struct.pack("<I", len(data))
    return base64.b64encode(header + data).decode()


def _placeholder_mp4(seconds: int, width: int = 512, height: int = 288) -> str:
    """Pre-baked tiny MP4 constant so <video> works before Wan2.2 loads — no deps."""
    try:
        from _demo_assets import DEMO_MP4_B64
        return DEMO_MP4_B64
    except Exception:
        return ""


def _fetch_image(image_url: str | None):
    if not image_url:
        return None
    try:
        import requests
        from PIL import Image
        if image_url.startswith("http"):
            return Image.open(io.BytesIO(requests.get(image_url, timeout=30).content)).convert("RGB")
    except Exception:
        return None
    return None


# ---------------------------------------------------------------------------
# 1) IMAGE — FLUX.1-schnell
# ---------------------------------------------------------------------------
_IMAGE_PIPE = None


@Endpoint(
    name="dito-image",
    gpu=GpuType.NVIDIA_GEFORCE_RTX_4090,
    gpu_count=1,
    workers=(0, 1),
    idle_timeout=300,
    dependencies=IMAGE_DEPS,
    template=PodTemplate(containerDiskInGb=60),
    env={"MODEL_ID": "stabilityai/sdxl-turbo", "DEMO_SAFE_MODE": "0"},
)
async def dito_image(prompt: str, aspect_ratio: str = "16:9", width: int = 1024, height: int = 576, steps: int = 4) -> dict:
    if _demo_safe():
        return {"image_base64": _placeholder_png(min(width, 768), min(height, 432), prompt), "mock_worker": True}
    try:
        global _IMAGE_PIPE
        _ensure([("diffusers", "diffusers>=0.32.0"), ("transformers", "transformers>=4.44.0"),
                 ("accelerate", "accelerate>=0.33.0"), ("PIL", "Pillow")])
        import torch
        from diffusers import AutoPipelineForText2Image

        # SDXL wants multiples of 8
        w = max(512, (width // 8) * 8)
        h = max(512, (height // 8) * 8)
        model_id = os.getenv("MODEL_ID", "stabilityai/sdxl-turbo")
        if _IMAGE_PIPE is None:
            try:
                _IMAGE_PIPE = AutoPipelineForText2Image.from_pretrained(model_id, torch_dtype=torch.float16, variant="fp16")
            except Exception:
                _IMAGE_PIPE = AutoPipelineForText2Image.from_pretrained(model_id, torch_dtype=torch.float16)
            _IMAGE_PIPE.to("cuda")
        image = _IMAGE_PIPE(
            prompt=prompt,
            num_inference_steps=max(1, min(steps, 6)),
            guidance_scale=0.0,  # turbo models use no guidance
            width=w,
            height=h,
        ).images[0]
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return {"image_base64": base64.b64encode(buf.getvalue()).decode(), "model": model_id}
    except Exception as e:
        return {"image_base64": _placeholder_png(min(width, 768), min(height, 432), prompt), "fallback": True, "note": f"{type(e).__name__}: {e}"[:400]}


# ---------------------------------------------------------------------------
# 2) TTS — Kokoro-82M
# ---------------------------------------------------------------------------
_TTS_PIPES: dict = {}


@Endpoint(
    name="dito-tts",
    gpu=GpuType.NVIDIA_GEFORCE_RTX_4090,
    gpu_count=1,
    workers=(0, 1),
    idle_timeout=300,
    dependencies=TTS_DEPS,
    template=PodTemplate(containerDiskInGb=30),
    env={"MODEL_ID": "hexgrad/Kokoro-82M", "DEMO_SAFE_MODE": "0"},
)
async def dito_tts(text: str, voice: str = "af_heart") -> dict:
    def _tone():
        seconds = max(1.5, min(8.0, len(text) / 60))
        freq = 300.0 if voice.startswith("af") else 200.0 if voice.startswith("am") else 360.0
        return _sine_wav(seconds, freq)

    if _demo_safe():
        return {"audio_base64": _tone(), "mock_worker": True}
    try:
        _ensure([("numpy", "numpy"), ("soundfile", "soundfile"), ("kokoro", "kokoro>=0.9.2")])
        import numpy as np
        import soundfile as sf
        from kokoro import KPipeline

        lang = voice[0] if voice else "a"  # 'a' american, 'b' british, ...
        if lang not in _TTS_PIPES:
            _TTS_PIPES[lang] = KPipeline(lang_code=lang)
        chunks = [audio for _, _, audio in _TTS_PIPES[lang](text, voice=voice)]
        audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype="float32")
        buf = io.BytesIO()
        sf.write(buf, audio, 24000, format="WAV")
        return {"audio_base64": base64.b64encode(buf.getvalue()).decode(), "model": "Kokoro-82M"}
    except Exception as e:
        return {"audio_base64": _tone(), "fallback": True, "note": f"{type(e).__name__}: {e}"[:400]}


# ---------------------------------------------------------------------------
# 3) MUSIC — MusicGen (text -> music). Reliable transformers install.
# ---------------------------------------------------------------------------
_MUSIC_MODEL = None
_MUSIC_PROC = None


@Endpoint(
    name="dito-music",
    gpu=GpuType.NVIDIA_GEFORCE_RTX_4090,
    gpu_count=1,
    workers=(0, 1),
    idle_timeout=300,
    dependencies=MUSIC_DEPS,
    template=PodTemplate(containerDiskInGb=40),
    env={"MODEL_ID": "facebook/musicgen-small", "DEMO_SAFE_MODE": "0"},
)
async def dito_music(prompt: str, lyrics: str = "", duration: int = 60) -> dict:
    if _demo_safe():
        return {"audio_base64": _sine_wav(min(10.0, max(3.0, duration / 8)), 262.0), "mock_worker": True}
    try:
        global _MUSIC_MODEL, _MUSIC_PROC
        _ensure([("transformers", "transformers>=4.44.0"), ("accelerate", "accelerate>=0.33.0"),
                 ("scipy", "scipy"), ("soundfile", "soundfile"), ("numpy", "numpy")])
        import io as _io
        import numpy as np
        import soundfile as sf
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration

        model_id = os.getenv("MODEL_ID", "facebook/musicgen-small")
        if _MUSIC_MODEL is None:
            _MUSIC_PROC = AutoProcessor.from_pretrained(model_id)
            _MUSIC_MODEL = MusicgenForConditionalGeneration.from_pretrained(model_id).to("cuda")
        inputs = _MUSIC_PROC(text=[prompt], padding=True, return_tensors="pt").to("cuda")
        secs = max(5, min(30, int(duration)))
        tokens = int(secs * 50)  # MusicGen ~50 tokens/sec
        with torch.no_grad():
            wav = _MUSIC_MODEL.generate(**inputs, max_new_tokens=tokens, do_sample=True, guidance_scale=3.0)
        sr = _MUSIC_MODEL.config.audio_encoder.sampling_rate
        audio = wav[0, 0].cpu().numpy().astype("float32")
        buf = _io.BytesIO()
        sf.write(buf, audio, sr, format="WAV")
        return {"audio_base64": base64.b64encode(buf.getvalue()).decode(), "model": model_id}
    except Exception as e:
        return {"audio_base64": _sine_wav(min(10.0, max(3.0, duration / 8)), 262.0), "fallback": True, "note": f"{type(e).__name__}: {e}"[:400]}


# ---------------------------------------------------------------------------
# 4) VIDEO — Wan2.2 TI2V 5B (image-to-video)
# ---------------------------------------------------------------------------
_VIDEO_PIPE = None


@Endpoint(
    name="dito-video",
    gpu=GpuType.NVIDIA_H200,
    gpu_count=1,
    workers=(0, 1),
    idle_timeout=600,
    dependencies=VIDEO_DEPS,
    template=PodTemplate(containerDiskInGb=140),
    env={"MODEL_ID": "Wan-AI/Wan2.2-TI2V-5B-Diffusers", "DEMO_SAFE_MODE": "0"},
)
async def dito_video(prompt: str, image_url: str | None = None, duration: int = 5, aspect_ratio: str = "16:9") -> dict:
    if _demo_safe():
        return {"video_base64": _placeholder_mp4(duration), "mock_worker": True}
    try:
        global _VIDEO_PIPE
        _ensure([("diffusers", "diffusers>=0.32.0"), ("transformers", "transformers>=4.44.0"),
                 ("accelerate", "accelerate>=0.33.0"), ("ftfy", "ftfy"),
                 ("imageio", "imageio"), ("imageio_ffmpeg", "imageio-ffmpeg")])
        import torch
        from diffusers import WanPipeline
        from diffusers.utils import export_to_video

        model_id = os.getenv("MODEL_ID", "Wan-AI/Wan2.2-TI2V-5B-Diffusers")
        if _VIDEO_PIPE is None:
            _VIDEO_PIPE = WanPipeline.from_pretrained(model_id, torch_dtype=torch.bfloat16, token=os.getenv("HF_TOKEN"))
            _VIDEO_PIPE.to("cuda")
        h, w = (704, 1280) if aspect_ratio == "16:9" else (704, 704)
        num_frames = max(24, min(121, int(duration) * 24 + 1))
        frames = _VIDEO_PIPE(prompt=prompt, height=h, width=w, num_frames=num_frames, num_inference_steps=40).frames[0]
        out_path = "/tmp/dito_video.mp4"
        export_to_video(frames, out_path, fps=24)
        with open(out_path, "rb") as f:
            return {"video_base64": base64.b64encode(f.read()).decode(), "model": "Wan2.2-TI2V-5B"}
    except Exception as e:
        return {"video_base64": _placeholder_mp4(duration), "fallback": True, "note": f"{type(e).__name__}: {e}"[:400]}
