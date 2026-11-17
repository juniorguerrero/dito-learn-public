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
- **Parsing:** `pdf-parse` (PDF) and `mammoth` (DOCX) in an isolated worker thread
  (`src/workers/parse-document.worker.mjs`, driven by `src/lib/parse.ts`); TXT / Markdown are decoded
  as strict UTF-8. See [Uploading lesson material](#uploading-lesson-material). Docling is the
  production upgrade path.
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

## Uploading lesson material

Both upload paths — the standalone page `/upload` (`POST /api/upload`) and the teacher's classroom
uploader (`POST /api/classrooms/[id]/lessons`) — use the same rules (`src/lib/uploadRules.ts`, shared
by browser and server) and the same server intake (`src/lib/documentIntake.ts`).

| Rule | Limit / behavior |
| --- | --- |
| File types | **PDF, DOCX, TXT, Markdown** (`.pdf`, `.docx`, `.txt`, `.md`, `.markdown`). Legacy `.doc`, images, RTF and anything else are refused with a message saying what to do instead. |
| File size | **10 MiB** (10,485,760 bytes), checked on the file's *actual* bytes. The request body is read with a byte cap (10 MiB + 512 KiB for form fields) and reading stops as soon as it is exceeded; a declared `Content-Length` over the cap is refused before reading. |
| Lesson text | **50 to 60,000 characters** of extracted text — exactly what the Learning Blueprint reads, so nothing accepted is silently left out. Longer material is rejected with a request to split it. |
| Either / or | A file **or** pasted text. Submitting both is rejected with a request to choose one. |
| Text files | Must be **UTF-8** (a UTF-8 BOM is fine). Windows-1252/Latin-1 or UTF-16 files get instructions for re-saving as UTF-8. Binary content with a `.txt`/`.md` name is refused. |
| Real content | PDF must start with `%PDF`, DOCX must be a complete ZIP with Word parts; a file whose bytes don't match its name is refused. Damaged, password-protected and image-only (scanned) PDFs each get their own explanation — scans need selectable text, i.e. OCR first. |

**How the 60,000-character limit is measured:** on the extracted text *after* normalization (byte-order
mark removed, line endings unified to `\n`, control characters removed, trailing spaces trimmed, 3+
blank lines collapsed to one, ends trimmed; PDF page markers are never added). The count is the
JavaScript string length (UTF-16 code units): letters — including accented ones — digits, spaces and
punctuation count 1; most emoji count 2. Pasted text is measured the same way and the upload forms
show the live count.

**Errors:** every rejection returns `{ error, code }` with 400 (bad request / both inputs / empty),
413 (too large), 415 (wrong type or binary) or 422 (unreadable content, no text, too long, parse
stopped). Internal parser messages go to the server log only. Nothing is written unless the upload
is accepted and the blueprint was built; a rejected upload never creates a lesson or changes
existing data.

**Parsing is contained.** Each PDF/DOCX is parsed in its own worker thread (plain JS file loaded from
disk, never bundled by Next.js — bundling pdf-parse is what broke PDF uploads in `next dev` and
`next start` before):

- a **20 s deadline** (`DITO_PARSE_TIMEOUT_MS`); on timeout the thread is *terminated* (V8 stops it even
  in a tight loop) and the teacher is told only after it has exited;
- **V8 heap limits** per worker (256 MB old / 32 MB young generation); exceeding them stops the worker;
- at most **2 parses at once**, 8 waiting; beyond that the upload gets 503 "try again";
- PDFs are read 10 pages at a time and reading **stops once the text read so far exceeds 60,000
  characters after normalization** — the same measure as the limit itself (blank pages, for example,
  add newlines that normalization removes, so raw length would reject documents that fit). Stopping
  early is safe because normalization never makes a longer text shorter than its beginning;
- DOCX files whose Word XML would unpack to more than 32 MB are refused before parsing.

Remaining limitations: worker threads share the server process, so memory outside the V8 heap
(ArrayBuffers, native allocations inside pdf.js) is not capped by the heap limits, and a crash in
native code would affect the whole server; running the parser in a separate OS process (with an OS
memory limit) would close that gap. The upload body (≤ 10.5 MiB) is held in memory while it is
validated. The lesson tutor still reads only the first 12,000 characters of a lesson
(`lessonChat`), which is unchanged here.

Checking uploads:

```bash
npm test                                   # unit + route tests (both upload routes, boundaries, containment)
npm run fixtures:documents -- --at-limit   # optional: exactly-10-MiB DOCX for the HTTP boundary check
npm run fixtures:documents -- --oversized  # optional: 10 MiB + 1 byte file
DITO_DATA_DIR=$(mktemp -d) npm run dev     # or: npm run build && DITO_DATA_DIR=$(mktemp -d) npm start
BASE=http://localhost:3000 npm run smoke:uploads            # every fixture, both routes, real server; prints "<passed>/<total> checks passed"
BASE=http://localhost:3000 python3 tests/browser/upload_workflows.py   # browser workflows (Playwright for Python)
```

Synthetic test documents (valid and invalid) are in `tests/fixtures/documents/` — see its README.

## Managing lessons (teacher)

On a classroom page (`/teacher/[id]`) each lesson card has **Edit**, **Archive** and, for archived
lessons, **Restore** (`src/components/teacher/LessonManager.tsx`, `src/lib/lessons.ts`).

```
PATCH /api/classrooms/[id]/lessons/[lessonId]   { title?, summary?, archived? } -> { lesson, changed }
GET   /api/classrooms/[id]/lessons/[lessonId]   -> { lesson }
GET   /api/classrooms/[id]                      -> { classroom, lessons (active), archived_lessons, students }
```

- **Edit title / summary.** Title 1–120 characters (one line), summary 1–1,000 characters. The new
  text is what teachers and students see everywhere (lists, lesson page, progress views, tutor).
  Nothing is regenerated: the lesson id, source text, generated formats and every student's progress
  stay as they are.
  **Limitation:** formats generated *before* the edit keep the wording they were made with — e.g.
  the title in the mind map's centre node, a podcast intro or song lyrics. Regenerating a format from
  the lesson dashboard uses the new title; the edit form says this.
- **Archive.** Students no longer see the lesson in their class, and opening a link to it shows an
  "archived" notice instead of the lesson. A student who already has it open can keep working: saves
  and "I got this" are still recorded. Teachers keep the lesson under "Archived lessons" and keep its
  progress history in each student's detail view, labelled *Archived*. Class analytics keep all
  history.
- **Restore** puts the lesson back in its original position with all progress, including anything
  saved while it was archived.
- **Safe to repeat.** Archiving an archived lesson (or restoring an active one, or saving unchanged
  text) writes nothing and keeps the original archive time, so double-clicks, retries and several
  open tabs can't duplicate or reorder anything. Archiving only sets `archived_at` on the lesson —
  `classroom.lesson_ids` is never modified.
- **Isolation.** A lesson can only be changed through its own classroom (the classroom must list it
  *and* the lesson must belong to it); anything else is a 404 and changes nothing.

There is no teacher login in this app (unchanged), so like the other teacher routes these endpoints
are open to anyone who can reach the server.

```bash
npm test                                                       # incl. tests/lessonManagement.api.test.ts
BASE=http://localhost:3000 python3 tests/browser/lesson_management.py  # browser workflow (Playwright for Python)
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

- `/upload` — drop or choose a file (or paste text), set grade level / goal / style / study time.
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
