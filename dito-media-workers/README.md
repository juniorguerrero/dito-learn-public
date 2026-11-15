# Dito Media Workers (RunPod Flash)

Four GPU workers that turn Dito's media outputs real. Same deploy pattern as the
`runpod-hackathon` gateway workers.

| Worker | Model | Powers | GPU |
| --- | --- | --- | --- |
| `dito-image` | FLUX.1-schnell | Story slides, game art, video keyframes, student hero image | RTX 4090 |
| `dito-tts` | Kokoro-82M | Podcast voices, story narration | RTX 4090 |
| `dito-music` | ACE-Step v1 3.5B | Study songs (with lyrics) | L40S |
| `dito-video` | Wan2.2 TI2V 5B | Image-to-video scenes | H200 |

Everything ships with `DEMO_SAFE_MODE=1`: the worker runs on a real Flash GPU and
returns a lightweight placeholder asset (real PNG / WAV / MP4) so you can deploy,
wire, and demo the whole pipeline **before** downloading multi-GB weights. Flip to
real inference with `DEMO_SAFE_MODE=0` (and `HF_TOKEN` for gated models).

## 1. Deploy (you run this — it needs your RunPod account)

```bash
cd dito-learn/runpod-workers
pip install runpod-flash                 # if not already installed
export RUNPOD_API_KEY="<your-runpod-key>"

flash deploy --app dito-media-workers --env production \
  --exclude torch,torchvision,torchaudio --python-version 3.12
```

## 2. Copy the endpoint IDs

```bash
flash app get dito-media-workers         # prints one endpoint id per worker
```

## 3. Wire them into Dito

Put the IDs (or full `/runsync` URLs) into `dito-learn/.env.local`:

```bash
RUNPOD_API_KEY=<your-runpod-key>
RUNPOD_IMAGE_ENDPOINT=<dito-image endpoint id>
RUNPOD_TTS_ENDPOINT=<dito-tts endpoint id>
RUNPOD_MUSIC_ENDPOINT=<dito-music endpoint id>
RUNPOD_VIDEO_ENDPOINT=<dito-video endpoint id>
```

Restart `npm run dev`. Dito now calls the workers via
`https://api.runpod.ai/v2/<id>/runsync` and saves returned assets into
`public/generated/`. Any endpoint you leave blank keeps using the local mock.

## 4. Go fully real (per worker, when ready)

In the RunPod dashboard set that worker's env `DEMO_SAFE_MODE=0` and redeploy.
For gated models add `HF_TOKEN`. Bump `workersMin` to `1` for the endpoint you'll
show live so there's no cold start during the demo.

## Output contract (what Dito reads)

```
dito-image -> { "image_base64": "<png>" }   (or image_url)
dito-tts   -> { "audio_base64": "<wav>" }   (or audio_url)
dito-music -> { "audio_base64": "<wav>" }   (or audio_url)
dito-video -> { "video_base64": "<mp4>" }   (or video_url)
```

Dito's `src/lib/runpod.ts` already handles base64 **or** URL, sync **or** async
(`/status` polling), so you don't need to change app code.
