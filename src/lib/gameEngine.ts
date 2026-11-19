import { GameSpecData, MatchingPair, QuizGate } from "./types";

// Concept Quest rules, shared by the game screen (GameTab) and the server
// (src/lib/gameAttempts.ts). Pure: no fs, no React.
//
// The browser plays the game by applying answers to this state machine, and
// sends the list of answers (the transcript) when the game ends. The server
// replays the same transcript against the stored game version and derives the
// score itself; it never accepts a score from the browser.
//
// Rules (unchanged from the original GameTab):
// - 3 lives. Each level: 3 quiz gates, a matching puzzle, then a boss question.
// - Quiz gate: correct +10. Wrong: lose a life, move on to the next step.
// - Matching puzzle: every wrong pick is a miss; when all pairs are matched it
//   scores max(5, 20 - 5 x misses). It never costs a life.
// - Boss: correct +30 and the concept is mastered. Wrong: lose a life and try
//   the boss again.
// - 0 lives: game over. Beating the last boss: victory.

export const START_LIVES = 3;
export const GATES_PER_LEVEL = 3;
export const GATE_POINTS = 10;
export const BOSS_POINTS = 30;
export const matchingPoints = (mistakes: number): number => Math.max(5, 20 - mistakes * 5);
// A real game has ~20 answers per level; this only bounds absurd requests.
export const MAX_TRANSCRIPT_ENTRIES = 2000;

export type GamePhase = "gate" | "matching" | "boss" | "level_done" | "victory" | "game_over";

export interface GameState {
  level: number;
  phase: GamePhase;
  gate: number; // which quiz gate (0-2) while phase === "gate"
  boss_try: number; // wrong boss answers so far in this level
  score: number;
  lives: number;
  mastered: string[];
  solved_terms: number[]; // matching pairs solved in this level (indices into matching_pairs)
  match_mistakes: number;
}

export type TranscriptEntry =
  | { k: "gate"; level: number; gate: number; choice: number }
  | { k: "match"; level: number; term: number; match: number }
  | { k: "boss"; level: number; try: number; choice: number };

export interface QuestionReview {
  kind: "gate" | "boss";
  level: number;
  index: number; // gate number, or boss try number
  question: string;
  options: string[];
  choice: number;
  correct_index: number;
  correct: boolean;
  explanation: string;
  points: number;
  lives_after: number;
}

export interface MatchingReview {
  kind: "matching";
  level: number;
  pairs: MatchingPair[];
  mistakes: number;
  points: number;
}

export type ReviewItem = QuestionReview | MatchingReview;

export type GameOutcome = "victory" | "game_over";

export interface GameResult {
  outcome: GameOutcome;
  score: number;
  lives_left: number;
  levels_total: number;
  levels_cleared: number;
  mastered: string[];
  levels: { title: string; concept_name: string }[];
  review: ReviewItem[];
}

export type GameEffect = "correct" | "wrong" | "match_hit" | "match_miss" | "matching_done";

export const isTerminal = (s: Pick<GameState, "phase">): boolean => s.phase === "victory" || s.phase === "game_over";

export function initialGameState(): GameState {
  return { level: 0, phase: "gate", gate: 0, boss_try: 0, score: 0, lives: START_LIVES, mastered: [], solved_terms: [], match_mistakes: 0 };
}

// ---------- Is this game playable? ----------

const isStr = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

function gateProblem(g: unknown, where: string): string | null {
  const q = g as QuizGate | null;
  if (!q || typeof q !== "object" || !isStr(q.question)) return `${where} has no question text.`;
  if (!Array.isArray(q.options) || q.options.length < 2 || !q.options.every(isStr)) return `${where} needs at least 2 answer options.`;
  if (!isInt(q.correct_index) || q.correct_index < 0 || q.correct_index >= q.options.length) return `${where} has no valid correct answer.`;
  return null;
}

/**
 * A game can only be played (and scored) if every level has what the game
 * screen needs. Generated games normally do; a malformed one (e.g. a level
 * with only 2 quiz questions) used to crash the game screen. Levels with more
 * than 3 quiz questions are playable: only the first 3 are used, as before.
 */
export function checkPlayable(spec: GameSpecData | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!spec || !Array.isArray(spec.levels) || spec.levels.length === 0) return { ok: false, reason: "The game has no levels." };
  for (let i = 0; i < spec.levels.length; i++) {
    const l = spec.levels[i];
    const name = `Level ${i + 1}`;
    if (!l || typeof l !== "object") return { ok: false, reason: `${name} is missing.` };
    if (!isStr(l.concept_name) || !isStr(l.title)) return { ok: false, reason: `${name} has no title or concept.` };
    const gates = Array.isArray(l.quiz_gates) ? l.quiz_gates : [];
    if (gates.length < GATES_PER_LEVEL) {
      return { ok: false, reason: `${name} has ${gates.length} quiz ${gates.length === 1 ? "question" : "questions"}; the game needs ${GATES_PER_LEVEL}.` };
    }
    for (let g = 0; g < GATES_PER_LEVEL; g++) {
      const p = gateProblem(gates[g], `${name}, quiz question ${g + 1},`);
      if (p) return { ok: false, reason: p };
    }
    const pairs = Array.isArray(l.matching_pairs) ? l.matching_pairs : [];
    if (pairs.length === 0) return { ok: false, reason: `${name} has no matching pairs.` };
    if (!pairs.every((p) => p && isStr(p.term) && isStr(p.match))) return { ok: false, reason: `${name} has an incomplete matching pair.` };
    // Duplicate terms/meanings made the original puzzle impossible to finish.
    if (new Set(pairs.map((p) => p.term)).size !== pairs.length || new Set(pairs.map((p) => p.match)).size !== pairs.length) {
      return { ok: false, reason: `${name} repeats a term or meaning in the matching puzzle.` };
    }
    const b = gateProblem(l.boss_question, `${name}, boss question,`);
    if (b) return { ok: false, reason: b };
  }
  return { ok: true };
}

// ---------- Applying answers ----------

export type ApplyResult =
  | { ok: true; state: GameState; effect: GameEffect; review?: ReviewItem }
  | { ok: false; error: string };

const fail = (error: string): ApplyResult => ({ ok: false, error });

/** "Next level →": leave the level-done screen for the next level's first quiz gate. */
export function startNextLevel(s: GameState): GameState {
  if (s.phase !== "level_done") return s;
  return { ...s, level: s.level + 1, phase: "gate", gate: 0, boss_try: 0, solved_terms: [], match_mistakes: 0 };
}

function questionReview(kind: "gate" | "boss", level: number, index: number, q: QuizGate, choice: number, points: number, livesAfter: number): QuestionReview {
  return {
    kind,
    level,
    index,
    question: q.question,
    options: [...q.options],
    choice,
    correct_index: q.correct_index,
    correct: choice === q.correct_index,
    explanation: isStr(q.explanation) ? q.explanation : "",
    points,
    lives_after: livesAfter,
  };
}

/**
 * Apply one answer. The entry names the step it answers (level, gate / boss try),
 * so an answer for a step that is not the current one (a duplicate, a skipped or
 * reordered step) is rejected instead of being counted again.
 * Assumes `spec` passed checkPlayable.
 */
export function applyEntry(spec: GameSpecData, s: GameState, e: TranscriptEntry): ApplyResult {
  if (isTerminal(s)) return fail("the game is already over");
  if (s.phase === "level_done") return fail("the next level hasn't started");
  if (e.level !== s.level) return fail(`expected an answer for level ${s.level + 1}`);
  const level = spec.levels[s.level];

  if (e.k === "gate") {
    if (s.phase !== "gate" || e.gate !== s.gate) return fail(s.phase === "gate" ? `expected quiz gate ${s.gate + 1}` : `expected the ${s.phase === "boss" ? "boss question" : "matching puzzle"}`);
    const gate = level.quiz_gates[s.gate];
    if (e.choice < 0 || e.choice >= gate.options.length) return fail("answer choice out of range");
    const correct = e.choice === gate.correct_index;
    const next: GameState = { ...s };
    if (correct) next.score += GATE_POINTS;
    else next.lives -= 1;
    if (!correct && next.lives <= 0) next.phase = "game_over";
    else if (s.gate < GATES_PER_LEVEL - 1) next.gate = s.gate + 1;
    else next.phase = "matching";
    const review = questionReview("gate", s.level, s.gate, gate, e.choice, correct ? GATE_POINTS : 0, next.lives);
    return { ok: true, state: next, effect: correct ? "correct" : "wrong", review };
  }

  if (e.k === "match") {
    if (s.phase !== "matching") return fail(s.phase === "gate" ? `expected quiz gate ${s.gate + 1}` : "expected the boss question");
    const pairs = level.matching_pairs;
    if (e.term < 0 || e.term >= pairs.length || e.match < 0 || e.match >= pairs.length) return fail("matching pick out of range");
    if (s.solved_terms.includes(e.term)) return fail("that term is already matched");
    if (s.solved_terms.some((t) => pairs[t].match === pairs[e.match].match)) return fail("that meaning is already matched");
    if (pairs[e.term].match !== pairs[e.match].match) {
      return { ok: true, state: { ...s, match_mistakes: s.match_mistakes + 1 }, effect: "match_miss" };
    }
    const solved = [...s.solved_terms, e.term];
    if (solved.length < pairs.length) return { ok: true, state: { ...s, solved_terms: solved }, effect: "match_hit" };
    const points = matchingPoints(s.match_mistakes);
    const review: MatchingReview = { kind: "matching", level: s.level, pairs: pairs.map((p) => ({ term: p.term, match: p.match })), mistakes: s.match_mistakes, points };
    return { ok: true, state: { ...s, solved_terms: solved, score: s.score + points, phase: "boss", boss_try: 0 }, effect: "matching_done", review };
  }

  if (e.k === "boss") {
    if (s.phase !== "boss") return fail(s.phase === "gate" ? `expected quiz gate ${s.gate + 1}` : "expected the matching puzzle");
    if (e.try !== s.boss_try) return fail(`expected boss try ${s.boss_try + 1}`);
    const boss = level.boss_question;
    if (e.choice < 0 || e.choice >= boss.options.length) return fail("answer choice out of range");
    const correct = e.choice === boss.correct_index;
    const next: GameState = { ...s };
    if (correct) {
      next.score += BOSS_POINTS;
      if (!next.mastered.includes(level.concept_name)) next.mastered = [...next.mastered, level.concept_name];
      next.phase = s.level + 1 < spec.levels.length ? "level_done" : "victory";
    } else {
      next.lives -= 1;
      next.boss_try = s.boss_try + 1;
      if (next.lives <= 0) next.phase = "game_over";
    }
    const review = questionReview("boss", s.level, s.boss_try, boss, e.choice, correct ? BOSS_POINTS : 0, next.lives);
    return { ok: true, state: next, effect: correct ? "correct" : "wrong", review };
  }

  return fail("unknown answer type");
}

// ---------- Transcript validation + replay (server) ----------

const ENTRY_KEYS: Record<TranscriptEntry["k"], string[]> = {
  gate: ["k", "level", "gate", "choice"],
  match: ["k", "level", "term", "match"],
  boss: ["k", "level", "try", "choice"],
};

/** Strictly parse an untrusted transcript: an array of known entry shapes with non-negative integers. */
export function parseTranscript(input: unknown): { ok: true; value: TranscriptEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "transcript must be an array of answers" };
  if (input.length === 0) return { ok: false, error: "transcript is empty" };
  if (input.length > MAX_TRANSCRIPT_ENTRIES) return { ok: false, error: `transcript has more than ${MAX_TRANSCRIPT_ENTRIES} answers` };
  const out: TranscriptEntry[] = [];
  for (let i = 0; i < input.length; i++) {
    const e = input[i] as Record<string, unknown> | null;
    const bad = (why: string) => ({ ok: false as const, error: `answer ${i + 1}: ${why}` });
    if (!e || typeof e !== "object" || Array.isArray(e)) return bad("must be an object");
    const keys = ENTRY_KEYS[e.k as TranscriptEntry["k"]];
    if (!keys) return bad("unknown answer type");
    const actual = Object.keys(e);
    if (actual.length !== keys.length || !keys.every((k) => k in e)) return bad(`must have exactly: ${keys.join(", ")}`);
    for (const k of keys) {
      if (k === "k") continue;
      const v = e[k];
      if (!isInt(v) || v < 0) return bad(`${k} must be a non-negative integer`);
    }
    out.push({ ...(e as unknown as TranscriptEntry) });
  }
  return { ok: true, value: out };
}

/**
 * Replay a transcript from the start of the game. Succeeds only if every answer
 * is legal in order and the game ends (victory or game over) exactly at the
 * last answer. The result (score, lives, review) is derived here, never taken
 * from the client.
 */
export function replayTranscript(spec: GameSpecData, input: unknown): { ok: true; result: GameResult; transcript: TranscriptEntry[] } | { ok: false; error: string } {
  const playable = checkPlayable(spec);
  if (!playable.ok) return { ok: false, error: `This game can't be scored: ${playable.reason}` };
  const parsed = parseTranscript(input);
  if (!parsed.ok) return parsed;

  let s = initialGameState();
  const review: ReviewItem[] = [];
  for (let i = 0; i < parsed.value.length; i++) {
    if (s.phase === "level_done") s = startNextLevel(s);
    const r = applyEntry(spec, s, parsed.value[i]);
    if (!r.ok) return { ok: false, error: `answer ${i + 1}: ${r.error}` };
    s = r.state;
    if (r.review) review.push(r.review);
  }
  if (!isTerminal(s)) return { ok: false, error: "the game isn't finished yet" };
  return { ok: true, transcript: parsed.value, result: resultFromState(spec, s, review) };
}

export function resultFromState(spec: GameSpecData, s: GameState, review: ReviewItem[]): GameResult {
  return {
    outcome: s.phase === "victory" ? "victory" : "game_over",
    score: s.score,
    lives_left: Math.max(0, s.lives),
    levels_total: spec.levels.length,
    levels_cleared: s.phase === "victory" ? spec.levels.length : s.mastered.length,
    mastered: [...s.mastered],
    levels: spec.levels.map((l) => ({ title: l.title, concept_name: l.concept_name })),
    review,
  };
}

// ---------- Game version identity ----------

/** 64-bit non-cryptographic string hash (two 32-bit lanes, cyrb53-style mixing). */
function hash64(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** Only the content that defines what is asked and how it is scored (not background images). */
export function canonicalGameContent(spec: GameSpecData): string {
  const gate = (q: QuizGate | undefined) =>
    q ? { question: q.question, options: q.options, correct_index: q.correct_index, explanation: q.explanation } : null;
  return JSON.stringify({
    game_title: spec?.game_title,
    intro_text: spec?.intro_text,
    levels: (Array.isArray(spec?.levels) ? spec.levels : []).map((l) => ({
      title: l?.title,
      concept_name: l?.concept_name,
      concept_explanation: l?.concept_explanation,
      quiz_gates: Array.isArray(l?.quiz_gates) ? l.quiz_gates.map(gate) : null,
      matching_pairs: Array.isArray(l?.matching_pairs) ? l.matching_pairs.map((p) => ({ term: p?.term, match: p?.match })) : null,
      boss_question: gate(l?.boss_question),
    })),
  });
}

/**
 * Identity of a game version. Regenerating a game with different questions
 * gives a new version; regenerating identical content (or only new background
 * images) keeps the same one. Computed the same way in browser and server.
 */
export const gameVersionKey = (spec: GameSpecData): string => `g1-${hash64(canonicalGameContent(spec))}`;

export const isGameVersionKey = (v: unknown): v is string => typeof v === "string" && /^g1-[0-9a-f]{16}$/.test(v);

// ---------- Unconfirmed finished results (browser write-ahead copy) ----------

export interface PendingFinish {
  attempt_id: string;
  transcript: TranscriptEntry[];
  finished_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isAttemptId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Parse an untrusted localStorage value; malformed entries are dropped. */
export function parsePendingFinishes(raw: string | null): PendingFinish[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (p): p is PendingFinish =>
        p && isAttemptId(p.attempt_id) && typeof p.finished_at === "string" && parseTranscript(p.transcript).ok
    );
  } catch {
    return [];
  }
}

/** Add (or keep) a pending finish; the same attempt id is only stored once. */
export function addPendingFinish(list: PendingFinish[], p: PendingFinish): PendingFinish[] {
  return list.some((x) => x.attempt_id === p.attempt_id) ? list : [...list, p];
}
