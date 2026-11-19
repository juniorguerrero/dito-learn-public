import { GameOutcome, ReviewItem, TranscriptEntry } from "./gameEngine";

// Stored Concept Quest attempts and the summaries built from them. Pure (no fs)
// so the browser can use the types; storage lives in src/lib/gameAttempts.ts.

export type AttemptStatus =
  | "in_progress" // started, not finished yet
  | "interrupted" // started, never finished, and a newer attempt was started
  | "finished"; // a validated transcript was recorded (victory or game over)

export interface GameAttemptRecord {
  id: string; // chosen by the browser when the attempt starts (idempotency key)
  version: string; // game version the attempt was started on (server snapshot)
  status: AttemptStatus;
  started_at: string;
  interrupted_at?: string;
  finished_at?: string;
  // Set once finished, all derived on the server from the transcript:
  outcome?: GameOutcome;
  score?: number;
  lives_left?: number;
  levels_total?: number;
  levels_cleared?: number;
  mastered?: string[];
  game_title?: string;
  levels?: { title: string; concept_name: string }[];
  review?: ReviewItem[];
  transcript?: TranscriptEntry[];
  event_id?: string | null; // id of the one game_result event for this attempt (chosen before logging)
  event_logged?: boolean; // false = the event may not be in the log yet (a retry checks by id)
}

export interface GameAttemptFile {
  student_id: string;
  lesson_id: string;
  classroom_id: string;
  attempts: GameAttemptRecord[]; // in start order
  created_at: string;
  updated_at: string;
}

export interface AttemptSummary {
  id: string;
  version: string;
  is_current_version: boolean;
  outcome: GameOutcome;
  score: number;
  lives_left: number;
  levels_cleared: number;
  levels_total: number;
  started_at: string;
  finished_at: string;
}

export interface AttemptDetail extends AttemptSummary {
  game_title: string;
  levels: { title: string; concept_name: string }[];
  mastered: string[];
  review: ReviewItem[];
}

export interface VersionBest {
  version: string;
  is_current: boolean;
  best_score: number;
  best_attempt_id: string;
  finished_attempts: number;
  victories: number;
  first_played_at: string;
  last_played_at: string;
}

export interface GameResultsSummary {
  current_version: string | null; // null = the lesson has no game yet
  playable: boolean;
  unplayable_reason: string | null;
  finished_count: number; // finished attempts only (interrupted ones never count)
  latest: AttemptSummary | null;
  best_by_version: VersionBest[]; // current version first, then most recently played
  attempts: AttemptSummary[]; // finished attempts, newest first
}

export const isFinished = (a: GameAttemptRecord): boolean => a.status === "finished" && typeof a.score === "number" && !!a.finished_at;

export function attemptSummary(a: GameAttemptRecord, currentVersion: string | null): AttemptSummary {
  return {
    id: a.id,
    version: a.version,
    is_current_version: a.version === currentVersion,
    outcome: a.outcome ?? "game_over",
    score: a.score ?? 0,
    lives_left: a.lives_left ?? 0,
    levels_cleared: a.levels_cleared ?? 0,
    levels_total: a.levels_total ?? 0,
    started_at: a.started_at,
    finished_at: a.finished_at ?? a.started_at,
  };
}

export function attemptDetail(a: GameAttemptRecord, currentVersion: string | null): AttemptDetail {
  return {
    ...attemptSummary(a, currentVersion),
    game_title: a.game_title ?? "Concept Quest",
    levels: a.levels ?? [],
    mastered: a.mastered ?? [],
    review: a.review ?? [],
  };
}

const byFinishedDesc = (a: AttemptSummary, b: AttemptSummary) => (a.finished_at < b.finished_at ? 1 : a.finished_at > b.finished_at ? -1 : 0);

/**
 * Latest result, finished-attempt count and best score per game version.
 * Only finished attempts count; in-progress and interrupted ones are ignored.
 * Scores from different versions are never mixed (different questions).
 */
export function summarizeAttempts(
  attempts: GameAttemptRecord[],
  game: { current_version: string | null; playable: boolean; unplayable_reason: string | null }
): GameResultsSummary {
  const finished = attempts.filter(isFinished).map((a) => attemptSummary(a, game.current_version)).sort(byFinishedDesc);
  const byVersion = new Map<string, AttemptSummary[]>();
  finished.forEach((a) => byVersion.set(a.version, [...(byVersion.get(a.version) || []), a]));
  const best_by_version: VersionBest[] = Array.from(byVersion.entries()).map(([version, list]) => {
    // Highest score; on a tie the one reached first.
    const best = [...list].sort((a, b) => b.score - a.score || (a.finished_at < b.finished_at ? -1 : 1))[0];
    const times = list.map((a) => a.finished_at).sort();
    return {
      version,
      is_current: version === game.current_version,
      best_score: best.score,
      best_attempt_id: best.id,
      finished_attempts: list.length,
      victories: list.filter((a) => a.outcome === "victory").length,
      first_played_at: times[0],
      last_played_at: times[times.length - 1],
    };
  });
  best_by_version.sort((a, b) => Number(b.is_current) - Number(a.is_current) || (a.last_played_at < b.last_played_at ? 1 : -1));
  return {
    current_version: game.current_version,
    playable: game.playable,
    unplayable_reason: game.unplayable_reason,
    finished_count: finished.length,
    latest: finished[0] ?? null,
    best_by_version,
    attempts: finished,
  };
}

// ---------- Teacher views ----------

export interface GameVersionInfo {
  version: string;
  number: number; // 1 = oldest version any attempt was started on
  label: string; // "Version 2"
  is_current: boolean;
  first_seen_at: string | null; // when the first attempt on it started (null: nobody has played it yet)
}

export interface TeacherLessonInfo {
  id: string;
  title: string;
  archived: boolean;
}

export interface TeacherGameInfo {
  has_game: boolean;
  current_version: string | null;
  playable: boolean;
  unplayable_reason: string | null;
}

export interface TeacherStudentRow {
  student_id: string;
  name: string;
  results_unavailable: boolean; // the attempt file can't be read right now (not counted; never shown as "not played")
  finished_count: number; // finished attempts only
  victories: number;
  latest: AttemptSummary | null;
  best_by_version: VersionBest[]; // current version first
}

export interface TeacherLessonGameResults {
  lesson: TeacherLessonInfo;
  game: TeacherGameInfo;
  versions: GameVersionInfo[];
  totals: { students: number; students_played: number; finished_attempts: number; victories: number; students_unavailable: number };
  students: TeacherStudentRow[]; // every enrolled student, by name
}

export interface TeacherStudentGameResults {
  lesson: TeacherLessonInfo;
  game: TeacherGameInfo;
  versions: GameVersionInfo[];
  student: { id: string; name: string };
  summary: GameResultsSummary;
}

export interface TeacherGameOverviewLesson extends TeacherLessonInfo {
  has_game: boolean;
  students_played: number;
  finished_attempts: number;
  students_unavailable: number;
}
