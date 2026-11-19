import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { dataRoot, writeJsonAtomic } from "./dataDir";
import { getEvents, logEvent } from "./db";
import { Ctx, ProgressError, getLessonProgress, recordCompletion, resolveContext } from "./progress";
import { START_LIVES, canonicalGameContent, checkPlayable, gameVersionKey, isAttemptId, isGameVersionKey, parseTranscript, replayTranscript } from "./gameEngine";
import {
  AttemptDetail,
  AttemptSummary,
  GameAttemptFile,
  GameAttemptRecord,
  GameResultsSummary,
  attemptDetail,
  attemptSummary,
  summarizeAttempts,
} from "./gameResults";
import { GameSpecData, LearningEvent, OutputType } from "./types";

// Concept Quest attempts, one JSON file per (student, lesson):
//   data/game-attempts/<studentId>/<lessonId>.json
// and an immutable snapshot of every game version an attempt was started on:
//   data/game-versions/<lessonId>/<version>.json
//
// - Attempt ids are chosen by the browser when an attempt starts, so a retried
//   or repeated start/finish request names the same attempt and never creates
//   or scores a second one.
// - An attempt is tied to the version it started on. Finishing it replays the
//   transcript against that stored snapshot, even if the lesson's game has
//   been regenerated since. Finished attempts also keep their own review
//   (questions, answers, explanations), so history never depends on the
//   lesson's current game.
// - Scores are derived here from the validated transcript; any score sent by
//   the browser is ignored.
// - Every mutation is synchronous (read -> check -> write, no await), like
//   progress.ts, so concurrent requests can't interleave within the process.
// - Lesson edits/archiving never touch these files. Like progress, a student
//   who has an archived lesson open can still finish and save a game.

export class GameAttemptError extends ProgressError {
  constructor(status: number, public code: string, message: string) {
    super(status, message);
    this.name = "GameAttemptError";
  }
}

const attemptsFile = (studentId: string, lessonId: string) => path.join(dataRoot(), "game-attempts", studentId, `${lessonId}.json`);
const versionFile = (lessonId: string, version: string) => path.join(dataRoot(), "game-versions", lessonId, `${version}.json`);

interface VersionSnapshot {
  version: string;
  lesson_id: string;
  created_at: string;
  game: GameSpecData;
}

const RESULTS_UNAVAILABLE =
  "Your saved game results for this lesson can't be read right now (a storage problem on the server). Nothing was changed. If this keeps happening, tell your teacher.";

const STATUSES = new Set(["in_progress", "interrupted", "finished"]);
const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;

/** Why a stored attempt can't be trusted, or null if it is well-formed. */
function attemptProblem(a: unknown): string | null {
  const r = a as GameAttemptRecord | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return "attempt is not an object";
  if (!isAttemptId(r.id) || r.id !== r.id.toLowerCase()) return "malformed attempt id";
  if (!isGameVersionKey(r.version)) return `attempt ${r.id}: malformed version`;
  if (!STATUSES.has(r.status)) return `attempt ${r.id}: unknown status`;
  if (typeof r.started_at !== "string") return `attempt ${r.id}: no start time`;
  if (r.status !== "finished") return null;
  const ok =
    (r.outcome === "victory" || r.outcome === "game_over") &&
    isInt(r.score) &&
    isInt(r.lives_left, 0, START_LIVES) &&
    isInt(r.levels_total, 1) &&
    isInt(r.levels_cleared, 0, r.levels_total as number) &&
    typeof r.finished_at === "string" &&
    Array.isArray(r.review) &&
    parseTranscript(r.transcript).ok &&
    (r.event_id === undefined || r.event_id === null || typeof r.event_id === "string") &&
    (r.event_logged === undefined || typeof r.event_logged === "boolean");
  return ok ? null : `finished attempt ${r.id} is incomplete or malformed`;
}

/**
 * Why a stored attempt file can't be used for this student + lesson (+ classroom),
 * or null. Valid JSON is not enough: it must be *this* record (a copy of another
 * student's or lesson's file must never be read or written as this one) and
 * every attempt in it must be well-formed.
 */
function attemptFileProblem(v: unknown, expected: { studentId: string; lessonId: string; classroomId?: string }): string | null {
  const f = v as GameAttemptFile | null;
  if (!f || typeof f !== "object" || Array.isArray(f)) return "not an attempt record";
  if (f.student_id !== expected.studentId) return `belongs to student ${String(f.student_id)}`;
  if (f.lesson_id !== expected.lessonId) return `belongs to lesson ${String(f.lesson_id)}`;
  if (typeof f.classroom_id !== "string" || (expected.classroomId !== undefined && f.classroom_id !== expected.classroomId)) {
    return `belongs to classroom ${String(f.classroom_id)}`;
  }
  if (!Array.isArray(f.attempts)) return "attempts is not a list";
  const ids = new Set<string>();
  for (const a of f.attempts) {
    const p = attemptProblem(a);
    if (p) return p;
    if (ids.has(a.id)) return `attempt ${a.id} appears twice`;
    ids.add(a.id);
  }
  return null;
}

type AttemptFileRead = { ok: true; file: GameAttemptFile | null } | { ok: false; error: unknown };

/** Read without side effects: null = no file yet; { ok: false } = it exists but can't be read, parsed or trusted. */
function readAttemptFile(studentId: string, lessonId: string, classroomId?: string): AttemptFileRead {
  const f = attemptsFile(studentId, lessonId);
  let raw: string;
  try {
    raw = fs.readFileSync(f, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { ok: true, file: null };
    return { ok: false, error: err };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: err };
  }
  const problem = attemptFileProblem(parsed, { studentId, lessonId, classroomId });
  return problem ? { ok: false, error: new Error(problem) } : { ok: true, file: parsed as GameAttemptFile };
}

/**
 * The student's attempt file. If it exists but can't be read (damaged,
 * truncated, permission or disk error) this is a 503: the file is never moved
 * aside, replaced or rewritten, so no recorded attempt is lost, and the browser
 * keeps any finished result it is still trying to save and retries later.
 */
function readAttempts(ctx: Ctx): GameAttemptFile {
  const r = readAttemptFile(ctx.student.id, ctx.project.id, ctx.classroomId);
  if (!r.ok) {
    console.error("game attempts: file can't be read; leaving it untouched", attemptsFile(ctx.student.id, ctx.project.id), r.error);
    throw new GameAttemptError(503, "results_unavailable", RESULTS_UNAVAILABLE);
  }
  if (r.file) return r.file;
  const now = new Date().toISOString();
  return { student_id: ctx.student.id, lesson_id: ctx.project.id, classroom_id: ctx.classroomId, attempts: [], created_at: now, updated_at: now };
}

/**
 * Write this student's record for this lesson. The path comes from the request
 * (never from ids inside the file), and a record that isn't this one is refused.
 */
function writeAttempts(ctx: Ctx, file: GameAttemptFile): void {
  if (file.student_id !== ctx.student.id || file.lesson_id !== ctx.project.id || file.classroom_id !== ctx.classroomId) {
    console.error("game attempts: refusing to write a record that belongs elsewhere", ctx.student.id, ctx.project.id);
    throw new GameAttemptError(503, "results_unavailable", RESULTS_UNAVAILABLE);
  }
  file.updated_at = new Date().toISOString();
  writeJsonAtomic(attemptsFile(ctx.student.id, ctx.project.id), file);
}

/**
 * A stored game version. null = not stored; a stored copy that can't be read is
 * a 503 (never overwritten; the attempt can't be scored against anything else).
 */
function readSnapshot(lessonId: string, version: string): VersionSnapshot | null {
  if (!isGameVersionKey(version)) return null;
  const f = versionFile(lessonId, version);
  let raw: string;
  try {
    raw = fs.readFileSync(f, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    console.error("game versions: snapshot can't be read", f, err);
    throw new GameAttemptError(503, "version_unavailable", VERSION_UNAVAILABLE);
  }
  try {
    const snap = JSON.parse(raw) as VersionSnapshot;
    if (!snap || typeof snap !== "object" || snap.version !== version || !snap.game) throw new Error("not a snapshot of this version");
    if (snap.lesson_id !== lessonId) throw new Error(`belongs to lesson ${String(snap.lesson_id)}`);
    // The content must still be exactly the version it is named after: an
    // edited game keeps its file name and version field but not its fingerprint.
    if (gameVersionKey(snap.game) !== version) throw new Error("content no longer matches its version fingerprint");
    const playable = checkPlayable(snap.game);
    if (!playable.ok) throw new Error(`not playable: ${playable.reason}`);
    return snap;
  } catch (err) {
    console.error("game versions: snapshot is damaged; leaving it untouched", f, err);
    throw new GameAttemptError(503, "version_unavailable", VERSION_UNAVAILABLE);
  }
}

const VERSION_UNAVAILABLE =
  "The game version this attempt was played on can't be read right now (a storage problem on the server), so it can't be scored yet. Nothing was changed. If this keeps happening, tell your teacher.";

/** Write-once: a version's snapshot is never changed after it is first stored. */
function ensureSnapshot(lessonId: string, game: GameSpecData): VersionSnapshot {
  const version = gameVersionKey(game);
  const existing = readSnapshot(lessonId, version);
  if (existing) {
    if (canonicalGameContent(existing.game) !== canonicalGameContent(game)) {
      // Two different games with the same 64-bit key: refuse rather than mix them up.
      throw new GameAttemptError(500, "version_conflict", "This game version can't be stored. Please ask your teacher to regenerate the game.");
    }
    return existing;
  }
  const snap: VersionSnapshot = { version, lesson_id: lessonId, created_at: new Date().toISOString(), game: structuredClone(game) };
  writeJsonAtomic(versionFile(lessonId, version), snap);
  return snap;
}

function currentGame(ctx: Ctx) {
  const game = ctx.project.outputs.game;
  if (!game) return { game: null, current_version: null, playable: false, unplayable_reason: "This lesson has no game yet." };
  const p = checkPlayable(game);
  return { game, current_version: gameVersionKey(game), playable: p.ok, unplayable_reason: p.ok ? null : p.reason };
}

function requireAttemptId(attemptId: unknown): string {
  if (!isAttemptId(attemptId)) throw new GameAttemptError(400, "invalid_attempt_id", "A valid attempt_id (UUID) is required");
  return attemptId.toLowerCase();
}

// ---------- Reads ----------

export function getGameResults(studentId: unknown, lessonId: unknown): GameResultsSummary {
  const ctx = resolveContext(studentId, lessonId);
  const cur = currentGame(ctx);
  const file = readAttempts(ctx);
  return summarizeAttempts(file.attempts, cur);
}

export function getGameAttempt(studentId: unknown, lessonId: unknown, attemptId: unknown): AttemptDetail {
  const ctx = resolveContext(studentId, lessonId);
  const id = requireAttemptId(attemptId);
  const a = readAttempts(ctx).attempts.find((x) => x.id === id);
  if (!a || a.status !== "finished") throw new GameAttemptError(404, "attempt_not_found", "No finished attempt with that id for this student and lesson");
  return attemptDetail(a, currentGame(ctx).current_version);
}

// ---------- Start ----------

export interface StartResult {
  attempt: { id: string; version: string; status: GameAttemptRecord["status"]; started_at: string };
  created: boolean; // false = this attempt id was already started (retry / double click)
}

/**
 * Start an attempt on the lesson's current game. `version` is the game the
 * browser is showing; if the lesson's game has changed since, the start is
 * refused (409 game_changed) so nobody plays one version and is scored on another.
 * Repeating the request with the same attempt_id returns the same attempt.
 */
export function startGameAttempt(studentId: unknown, lessonId: unknown, body: { attempt_id?: unknown; version?: unknown }): StartResult {
  const ctx = resolveContext(studentId, lessonId);
  const id = requireAttemptId(body?.attempt_id);

  const file = readAttempts(ctx);
  const existing = file.attempts.find((a) => a.id === id);
  if (existing) {
    return { attempt: { id: existing.id, version: existing.version, status: existing.status, started_at: existing.started_at }, created: false };
  }

  const cur = currentGame(ctx);
  if (!cur.game || !cur.current_version) throw new GameAttemptError(409, "no_game", "This lesson has no game yet.");
  if (!cur.playable) throw new GameAttemptError(422, "game_unplayable", `This game can't be played: ${cur.unplayable_reason}`);
  if (!isGameVersionKey(body?.version)) throw new GameAttemptError(400, "invalid_version", "A valid game version is required");
  if (body.version !== cur.current_version) {
    throw new GameAttemptError(409, "game_changed", "This game has been updated since you opened it. Load the new version to play.");
  }

  ensureSnapshot(ctx.project.id, cur.game);
  const now = new Date().toISOString();
  // Starting a new attempt supersedes any unfinished one (no mid-game resume).
  // An interrupted attempt can still be finished later if its result was
  // already played to the end (e.g. an unconfirmed save being retried), so
  // interrupted attempts are never deleted: the browser may still hold a
  // finished result for any of them. (Each is a ~150-byte record.)
  file.attempts.forEach((a) => {
    if (a.status === "in_progress") {
      a.status = "interrupted";
      a.interrupted_at = now;
    }
  });
  const attempt: GameAttemptRecord = { id, version: cur.current_version, status: "in_progress", started_at: now };
  file.attempts.push(attempt);
  writeAttempts(ctx, file);
  return { attempt: { id, version: attempt.version, status: attempt.status, started_at: now }, created: true };
}

// ---------- Finish ----------

export interface FinishResult {
  attempt: AttemptSummary;
  duplicate: boolean; // true = already finished with these answers; nothing new recorded
  completed: OutputType[]; // the student's completed formats for this lesson after this call
  events: LearningEvent[]; // events newly logged by this call (for long-term memory)
}

const sameTranscript = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Record a finished attempt. The transcript is replayed against the attempt's
 * own game version; an illegal, incomplete or forged transcript is rejected.
 * Idempotent per attempt: the first valid finish records the result, logs one
 * game_result event and (victory only) marks the game format complete through
 * the existing completion path. Repeats with the same answers return that
 * result; different answers for an already-finished attempt are refused.
 */
export function finishGameAttempt(studentId: unknown, lessonId: unknown, attemptId: unknown, transcriptInput: unknown): FinishResult {
  const ctx = resolveContext(studentId, lessonId);
  const id = requireAttemptId(attemptId);
  const file = readAttempts(ctx);
  const attempt = file.attempts.find((a) => a.id === id);
  if (!attempt) throw new GameAttemptError(404, "attempt_not_found", "This attempt was never started for this student and lesson.");

  const snap = readSnapshot(ctx.project.id, attempt.version);
  // Missing is a storage problem too (it is written before the attempt starts):
  // keep the browser retrying rather than dropping the result or scoring it on another version.
  if (!snap) throw new GameAttemptError(503, "version_unavailable", VERSION_UNAVAILABLE);
  const replay = replayTranscript(snap.game, transcriptInput);
  if (!replay.ok) throw new GameAttemptError(422, "invalid_transcript", `These answers can't be scored: ${replay.error}`);

  const events: LearningEvent[] = [];
  let duplicate = false;
  let justFinished = false;
  if (attempt.status === "finished") {
    if (!sameTranscript(attempt.transcript, replay.transcript)) {
      throw new GameAttemptError(409, "already_finished", "This attempt was already finished with different answers.");
    }
    duplicate = true;
  } else {
    const r = replay.result;
    Object.assign(attempt, {
      status: "finished",
      finished_at: new Date().toISOString(),
      outcome: r.outcome,
      score: r.score,
      lives_left: r.lives_left,
      levels_total: r.levels_total,
      levels_cleared: r.levels_cleared,
      mastered: r.mastered,
      levels: r.levels,
      game_title: snap.game.game_title,
      review: r.review,
      transcript: replay.transcript,
      // The event id is chosen now and stored with the result, before the event
      // is appended, so a retry can always tell whether it was already logged.
      event_id: randomUUID(),
      event_logged: false,
    } satisfies Partial<GameAttemptRecord>);
    delete attempt.interrupted_at;
    writeAttempts(ctx, file); // if this fails, nothing was recorded and a retry starts over
    justFinished = true;
  }

  // Side effects run after the result is stored and are themselves idempotent,
  // so a retry after a partial failure completes them without duplicating:
  // - one game_result event per attempt. Records from before event_logged
  //   existed have a non-null event_id only once logged.
  const logged = attempt.event_logged ?? Boolean(attempt.event_id);
  if (!logged) {
    const eventId = attempt.event_id || randomUUID();
    // Only a retry can find the event already written (appended, then the
    // "logged" mark below failed to save): look for its id before logging.
    const already = !justFinished && getEvents(ctx.classroomId).some((e) => e.id === eventId && e.type === "game_result");
    if (!already) {
      events.push(
        logEvent(
          {
            classroom_id: ctx.classroomId,
            student_id: ctx.student.id,
            student_name: ctx.student.name,
            lesson_id: ctx.project.id,
            type: "game_result",
            modality: "game",
            value: attempt.score,
            text: attempt.outcome,
          },
          { id: eventId }
        )
      );
    }
    attempt.event_id = eventId;
    attempt.event_logged = true;
    writeAttempts(ctx, file); // if this fails, the retry finds the event by its id
  }
  // - a victory marks the game format complete once (existing idempotent path).
  //   A game over is a finished attempt but does not complete the format.
  let completedMap: Partial<Record<OutputType, string>>;
  if (attempt.outcome === "victory") {
    const c = recordCompletion(ctx.student.id, ctx.project.id, "game");
    if (c.event) events.push(c.event);
    completedMap = c.progress.completed;
  } else {
    completedMap = getLessonProgress(ctx.student.id, ctx.project.id).completed;
  }
  const completed = Object.keys(completedMap) as OutputType[];

  return { attempt: attemptSummary(attempt, currentGame(ctx).current_version), duplicate, completed, events };
}

// ---------- Read-only access for teacher views ----------

/**
 * A student's attempts on a lesson, for teacher views. Never writes or moves
 * anything. `unavailable` = the file exists but can't be read right now, so the
 * teacher is told instead of seeing "not played".
 */
export function readStudentAttempts(studentId: string, lessonId: string, classroomId: string): { attempts: GameAttemptRecord[]; unavailable: boolean } {
  const r = readAttemptFile(studentId, lessonId, classroomId);
  if (!r.ok) {
    console.error("game attempts: file can't be read (teacher view)", attemptsFile(studentId, lessonId), r.error);
    return { attempts: [], unavailable: true };
  }
  return { attempts: r.file?.attempts ?? [], unavailable: false };
}

/**
 * Every stored game version of a lesson (one per version an attempt was started
 * on), oldest first. Snapshots that fail verification are left out.
 */
export function listGameVersions(lessonId: string): { version: string; created_at: string }[] {
  const dir = path.join(dataRoot(), "game-versions", lessonId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && isGameVersionKey(f.slice(0, -5)))
    .map((f) => {
      try {
        const s = readSnapshot(lessonId, f.slice(0, -5));
        return s ? { version: s.version, created_at: s.created_at } : null;
      } catch {
        return null;
      }
    })
    .filter((x): x is { version: string; created_at: string } => x !== null)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

/** The lesson's current game: version key and whether it can be played. */
export function currentGameInfo(game: GameSpecData | undefined) {
  if (!game) return { has_game: false, current_version: null, playable: false, unplayable_reason: "This lesson has no game yet." };
  const p = checkPlayable(game);
  return { has_game: true, current_version: gameVersionKey(game), playable: p.ok, unplayable_reason: p.ok ? null : p.reason };
}
