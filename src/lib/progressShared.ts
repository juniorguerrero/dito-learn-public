import { FlashcardProgress, FlashcardsData, LearningEvent, OutputType } from "./types";

// Pure helpers shared by the browser and the server (no fs / no React), so the
// client and the API agree on deck identity, validation and completion rules.

export const OUTPUT_TYPES: readonly OutputType[] = [
  "mindmap",
  "flashcards",
  "story_slides",
  "podcast",
  "story_audio",
  "game",
  "video",
  "song",
];

export function isOutputType(v: unknown): v is OutputType {
  return typeof v === "string" && (OUTPUT_TYPES as readonly string[]).includes(v);
}

// ---------- Deck identity ----------

/**
 * Stable fingerprint of a flashcard deck (FNV-1a over questions + answers).
 * Saved card indices are only meaningful for the exact deck they were made on;
 * regenerating the deck changes the key so stale indices are never applied.
 */
export function flashcardDeckKey(deck: FlashcardsData | null | undefined): string {
  const cards = deck?.cards || [];
  const text = cards.map((c) => `${c.question}\u0000${c.answer}`).join("\u0001");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${cards.length}-${h.toString(16).padStart(8, "0")}`;
}

// ---------- Flashcard state ----------

export type FlashcardState = Omit<FlashcardProgress, "deck_key">;

export const emptyFlashcardState = (): FlashcardState => ({ current_index: 0, known: [], review: [] });

const isIndex = (n: unknown, count: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < count;

/**
 * Strictly validate an incoming flashcard snapshot against a deck of `cardCount`
 * cards. Duplicate indices are collapsed; anything else malformed is rejected.
 */
export function validateFlashcardState(
  input: unknown,
  cardCount: number
): { ok: true; value: FlashcardState } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "flashcards must be an object" };
  const o = input as Record<string, unknown>;
  if (!isIndex(o.current_index, cardCount)) {
    return { ok: false, error: `current_index must be an integer between 0 and ${cardCount - 1}` };
  }
  const list = (name: "known" | "review") => {
    const v = o[name];
    if (!Array.isArray(v)) return { error: `${name} must be an array of card indices` };
    if (!v.every((n) => isIndex(n, cardCount))) return { error: `${name} contains an invalid card index` };
    return { value: Array.from(new Set(v as number[])).sort((a, b) => a - b) };
  };
  const known = list("known");
  if ("error" in known) return { ok: false, error: known.error! };
  const review = list("review");
  if ("error" in review) return { ok: false, error: review.error! };
  const reviewSet = new Set(review.value);
  if (known.value.some((i) => reviewSet.has(i))) {
    return { ok: false, error: "a card cannot be both known and marked for review" };
  }
  return { ok: true, value: { current_index: o.current_index as number, known: known.value, review: review.value } };
}

/**
 * Restore a saved snapshot for the deck currently on screen. Returns a fresh
 * state when there is nothing saved or it belongs to a different deck.
 * Lenient (drops out-of-range indices) because it runs on already-stored data.
 */
export function restoreFlashcardState(
  saved: FlashcardProgress | null | undefined,
  deckKey: string,
  cardCount: number
): FlashcardState {
  if (!saved || saved.deck_key !== deckKey || cardCount <= 0) return emptyFlashcardState();
  const keep = (xs: unknown) =>
    Array.isArray(xs) ? Array.from(new Set(xs.filter((n) => isIndex(n, cardCount)))).sort((a, b) => a - b) : [];
  const known = keep(saved.known);
  const knownSet = new Set(known);
  return {
    current_index: isIndex(saved.current_index, cardCount) ? saved.current_index : 0,
    known,
    review: keep(saved.review).filter((i) => !knownSet.has(i)),
  };
}

/** Every card is marked "I knew it". */
export const isDeckFinished = (state: FlashcardState, cardCount: number): boolean =>
  cardCount > 0 && state.known.length >= cardCount;

/**
 * Which card to show after `from`: a card not answered yet comes first, then a
 * card marked "review again". Cards the student already knows are never shown
 * again automatically. Returns -1 when every card is known.
 */
export function nextCardIndex(state: FlashcardState, from: number, cardCount: number): number {
  const known = new Set(state.known);
  const review = new Set(state.review);
  const after = (pred: (i: number) => boolean) => {
    for (let step = 1; step <= cardCount; step++) {
      const i = (from + step) % cardCount;
      if (pred(i)) return i;
    }
    return -1;
  };
  const unanswered = after((i) => !known.has(i) && !review.has(i));
  if (unanswered !== -1) return unanswered;
  return after((i) => review.has(i)); // may be `from` itself if it's the only one left
}

/** Record "I knew it" / "Review again" for the current card and move to the next card that still needs work. */
export function answerCard(state: FlashcardState, markKnown: boolean, cardCount: number): FlashcardState {
  const i = state.current_index;
  const without = (xs: number[]) => xs.filter((x) => x !== i);
  const add = (xs: number[]) => [...without(xs), i].sort((a, b) => a - b);
  const answered: FlashcardState = {
    current_index: i,
    known: markKnown ? add(state.known) : without(state.known),
    review: markKnown ? without(state.review) : add(state.review),
  };
  const next = cardCount > 0 ? nextCardIndex(answered, i, cardCount) : -1;
  return { ...answered, current_index: next === -1 ? 0 : next };
}

/** Jump to a card from the deck strip (choices are unchanged). */
export function jumpToCard(state: FlashcardState, index: number, cardCount: number): FlashcardState {
  return isIndex(index, cardCount) ? { ...state, current_index: index } : state;
}

// ---------- Completion counting ----------

export const completionKey = (studentId: string, lessonId: string | undefined, modality: string | undefined) =>
  `${studentId}|${lessonId || ""}|${modality || ""}`;

/**
 * A student/lesson/format completion counts once, no matter how many
 * `modality_complete` events exist (legacy double-clicks, retries, refreshes).
 * Keeps the earliest event for each key.
 */
export function uniqueCompletions(events: LearningEvent[]): LearningEvent[] {
  const seen = new Set<string>();
  const out: LearningEvent[] = [];
  events
    .filter((e) => e.type === "modality_complete")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    .forEach((e) => {
      const k = completionKey(e.student_id, e.lesson_id, e.modality);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(e);
    });
  return out;
}

// ---------- Save ordering (client) ----------

/**
 * A flashcard snapshot that hasn't been confirmed by the server yet. Kept in
 * localStorage so a save dropped by a reload / quick navigation isn't lost.
 */
export interface PendingFlashcards {
  rev: number;
  flashcards: FlashcardProgress;
}

/**
 * Revision for a new snapshot, assigned at the moment the student acts.
 * Strictly increasing within a tab (last + 1) and time-based across page loads
 * (Date.now), and always above anything already seen from the server.
 */
export const nextRev = (last: number, now: number = Date.now()): number => Math.max(Math.floor(now), last + 1);

/** Parse an untrusted localStorage value; anything malformed is ignored. */
export function parsePendingFlashcards(raw: string | null): PendingFlashcards | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as PendingFlashcards;
    const fc = v?.flashcards;
    const ok =
      Number.isSafeInteger(v?.rev) &&
      v.rev > 0 &&
      fc &&
      typeof fc.deck_key === "string" &&
      Number.isInteger(fc.current_index) &&
      Array.isArray(fc.known) &&
      Array.isArray(fc.review);
    return ok ? v : null;
  } catch {
    return null;
  }
}

/**
 * On load, decide between the server's snapshot and a local unconfirmed one:
 * the higher revision wins. If the local one is newer it must be re-sent.
 */
export function reconcileFlashcards(
  server: { flashcards: FlashcardProgress | null; flashcards_rev: number },
  local: PendingFlashcards | null
): { flashcards: FlashcardProgress | null; rev: number; resend: PendingFlashcards | null; clearLocal: boolean } {
  const serverRev = server.flashcards_rev || 0;
  if (local && local.rev > serverRev) {
    return { flashcards: local.flashcards, rev: local.rev, resend: local, clearLocal: false };
  }
  return { flashcards: server.flashcards, rev: serverRev, resend: null, clearLocal: Boolean(local) };
}
