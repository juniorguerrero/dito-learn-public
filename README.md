# Dito Learn 🧠✨

**Multimodal AI learning engine.** Upload a PDF, Word doc, or paste text — Dito builds a
**Learning Blueprint** with Claude, then generates a coherent set of learning outputs from that
single blueprint: mind map, flashcards, an illustrated story, a two-voice podcast, a narrated
audio story, a playable game, a video storyboard, and a study song.

> The core idea: **don't just summarize the PDF.** Every output is generated from the same
> Learning Blueprint, so the whole experience feels like one coherent course.

## Quick start

```bash
npm install
cp .env.example .env.local   # already done; add your keys
npm run dev                  # http://localhost:3000
```

**Works with zero keys.** Without `ANTHROPIC_API_KEY` the app uses built-in mock generators, and
without RunPod endpoints it serves mock images (gradient SVGs) and mock audio (synthesized WAV
melodies) — so the entire UI is demoable offline. Add keys to make it real.

### Make it real

| Capability | Env var | Model |
| --- | --- | --- |
| Blueprint + all scripts | `ANTHROPIC_API_KEY` | Claude (`claude-sonnet-5`) |
| Images | `RUNPOD_IMAGE_ENDPOINT` | FLUX.2 klein / FLUX.1-dev |
| Video | `RUNPOD_VIDEO_ENDPOINT` | Wan2.2 TI2V 5B |
| TTS | `RUNPOD_TTS_ENDPOINT` | Kokoro-82M |
| Music | `RUNPOD_MUSIC_ENDPOINT` | ACE-Step 1.5 / MusicGen |

Each RunPod var is the full endpoint URL (e.g. `https://api.runpod.ai/v2/<id>/runsync`) and is
called with `{ input: {...} }`. Wrappers accept either a returned URL or base64 payload and, for
base64, save the asset to `public/generated/`.

## Architecture

- **Frontend/Backend:** Next.js 14 (App Router) + React + TypeScript + Tailwind.
- **Orchestration:** Claude turns the document into a `LearningBlueprint`, then each output is a
  separate Claude call seeded with that blueprint (`src/lib/generators.ts`).
- **Generation wrappers:** one thin function per RunPod model (`src/lib/runpod.ts`), each with a
  local mock fallback.
- **Storage:** filesystem JSON store in `./data/projects` (`src/lib/store.ts`) — swap for Supabase
  without touching the API surface.
- **Parsing:** `pdf-parse` (PDF), `mammoth` (DOCX), raw text otherwise (`src/lib/parse.ts`).
  Docling is the production upgrade path.
- **Game:** Phaser 3 stage (animated hero + FX) overlaid with a React-driven quiz/matching/boss
  quest (`src/components/tabs/GameTab.tsx`).

## API surface

```
POST /api/upload                        -> parse + build blueprint, returns { id, blueprint }
GET  /api/projects/[id]                 -> full project
POST /api/projects/[id]/generate        -> { type } generates & caches one output
POST /api/projects/[id]/audio           -> { type: podcast|story_audio } synthesizes TTS
POST /api/generate/{image,video,tts,music}  -> direct model wrappers
```

## Pages

- `/upload` — drop a file or paste text, set grade level / goal / style / study time.
- `/dashboard/[id]` — blueprint overview + tabs for all eight outputs, each with its own
  generation status and loading state.

Built for a hackathon: fast, playful, and every output ties back to one blueprint.

## License

Project code is available under the [MIT License](LICENSE).
Bundled Geist fonts use the SIL Open Font License 1.1; see
[third-party notices](THIRD_PARTY_NOTICES.txt) and [the font license](src/app/fonts/OFL.txt).

This repository contains a sanitized source snapshot. Local environment values,
saved user data, generated media, dependency folders, and private Git history
are excluded. API credentials are optional for the built-in mock mode.
