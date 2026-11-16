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

GET  /api/lessons/[id]/progress?student_id=  -> { progress } saved progress for one student + lesson
PUT  /api/lessons/[id]/progress              -> { student_id, rev, flashcards } saves flashcard choices + position
POST /api/lessons/[id]/progress/complete     -> { student_id, modality } idempotent "I got this"
```

## Student progress

Each student's progress is saved per lesson in `data/progress/<studentId>/<lessonId>.json`
(`src/lib/progress.ts`). This covers flashcard choices (known / review), the current card, and
completed learning formats. It is restored when the student comes back or refreshes the page.

- **Completions count once.** A student/lesson/format completion is recorded the first time only.
  Repeat clicks, retries and refreshes are no-ops, both on the new endpoint and on the legacy
  `POST /api/events` `modality_complete` path. Teacher totals also count *unique*
  student/lesson/format completions, so duplicate events already in an older `events.jsonl`
  no longer inflate totals. The log itself is never rewritten.
- **Existing data:** completions logged before this feature are carried into the student's
  restored progress, so the student view and the teacher view agree.
- **Save ordering:** each flashcard snapshot carries a revision number, assigned when the student
  clicks. The server only applies a snapshot newer than the one it has, so a slow or retried
  request that arrives late can't roll progress back. The browser also keeps a copy of the newest
  unconfirmed snapshot in `localStorage` and re-sends it on the next visit. This covers saves lost
  to a reload or a quick navigate-away. The copy is cleared once the server confirms it.
- **Regenerated decks:** saved card positions are tied to a fingerprint of the flashcard deck.
  If the deck is regenerated with different cards, the student starts that deck fresh.
- **No identity / not enrolled / offline (static demo):** the lesson still works with in-memory
  state, and a small notice says progress isn't being saved.

## Joining a class and where data is kept

- **Students** join with the class code. Spaces, dashes and lowercase are fine (`abc 123`,
  `ABC-123`). The browser remembers the student (in `localStorage`), and everything else lives
  on the server in `./data`: profile, classes, progress. A returning student joins another class
  with just the code and keeps the same profile and progress. If the browser remembers a student
  the server no longer has, joining creates a fresh profile instead of failing.
- **Professors** see each student's saved progress per lesson in the Students tab (formats done,
  flashcards known). Students who join while the page is open show up without a reload. When a
  professor practises flashcards on a lesson page (`/dashboard/[id]`), that progress is saved in
  the browser per lesson, since professors have no account.
- **Load demo data** adds a demo classroom next to your own data and never deletes anything.
  Clicking it again opens the same demo.
- The static export (`scripts/static-export.sh`) has no server, so joining and saving are
  unavailable there. Use `npm run dev` / `npm start` for the full app.

## Many students at the same time

Every student response is recorded exactly once, even when a whole class acts at the same moment:

- **Flashcard answers / "I got this":** each student has their own progress file per lesson.
  Saves are ordered by revision and completions are idempotent, so out-of-order, repeated or
  simultaneous requests can't lose or double-count anything.
- **Questions, messages, activity:** append-only logs, one line per write.
- **Formats generated on first open** (shared by the whole class): simultaneous requests for the
  same format share one generation, so everyone gets the same deck. Results are merged into the
  *current* lesson file, so formats generated at the same time by other students are never
  overwritten (`updateProject` in `src/lib/store.ts`). Audio and video clips are only attached if
  their script wasn't regenerated in the meantime.
- All records are written atomically (temp file + rename), so nobody ever reads a half-written file.

Check it yourself against a running server (synthetic students, its own classroom):

```bash
MOCK_GENERATION_DELAY_MS=1500 npm start   # mock mode with realistic AI latency
npm run load-test -- 100                   # 100 students; verifies every record
```

These guarantees hold for one server process, which is what `npm start` runs with the file
store. Running several instances would need a shared database.

## Tests

```bash
npm test    # vitest: synthetic students + built-in mock generators, isolated temp data dir
```

Tests set `DITO_DATA_DIR` to a temp directory, so they never touch `./data`.

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
