import { describe, expect, it } from "vitest";
import {
  answerCard,
  emptyFlashcardState,
  flashcardDeckKey,
  isDeckFinished,
  nextCardIndex,
  jumpToCard,
  nextRev,
  parsePendingFlashcards,
  reconcileFlashcards,
  restoreFlashcardState,
  uniqueCompletions,
  validateFlashcardState,
} from "@/lib/progressShared";
import { mockFlashcards } from "@/lib/mocks";
import { SEED_LESSONS } from "@/lib/seedData";
import { LearningEvent } from "@/lib/types";

const deck = mockFlashcards(SEED_LESSONS[0].blueprint);
const N = deck.cards.length;

describe("flashcardDeckKey", () => {
  it("is stable for the same deck and changes when cards change", () => {
    const copy = JSON.parse(JSON.stringify(deck));
    expect(flashcardDeckKey(copy)).toBe(flashcardDeckKey(deck));

    const edited = JSON.parse(JSON.stringify(deck));
    edited.cards[2].answer += " (revised)";
    expect(flashcardDeckKey(edited)).not.toBe(flashcardDeckKey(deck));

    const reordered = { cards: [...deck.cards].reverse() };
    expect(flashcardDeckKey(reordered)).not.toBe(flashcardDeckKey(deck));
  });
});

describe("flashcard state transitions", () => {
  it("moves a card between known and review and goes to the next card that still needs work", () => {
    let s = emptyFlashcardState();
    s = answerCard(s, true, N); // card 0 known
    expect(s).toEqual({ current_index: 1, known: [0], review: [] });
    s = answerCard(s, false, N); // card 1 review
    expect(s).toEqual({ current_index: 2, known: [0], review: [1] });

    s = jumpToCard(s, 1, N);
    s = answerCard(s, true, N); // card 1 changes its mind -> known
    expect(s).toEqual({ current_index: 2, known: [0, 1], review: [] });

    s = jumpToCard(s, N - 1, N);
    s = answerCard(s, false, N); // wraps around, skipping the known cards 0 and 1
    expect(s.current_index).toBe(2);
    expect(jumpToCard(s, N + 3, N)).toBe(s); // out-of-range jump ignored
  });

  it("never brings a known card back; unanswered cards come before review cards", () => {
    const n = 5;
    let s = emptyFlashcardState();
    const seen: number[] = [];
    const answers = [true, false, true, false, true]; // cards 0..4: 1 and 3 need review
    for (const knew of answers) {
      seen.push(s.current_index);
      s = answerCard(s, knew, n);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4]); // each card once, in order
    expect(s).toEqual({ current_index: 1, known: [0, 2, 4], review: [1, 3] }); // then review cards

    s = answerCard(s, true, n); // card 1 now known
    expect(s.current_index).toBe(3);
    s = answerCard(s, false, n); // card 3 still shaky: it's the only one left, so it comes back
    expect(s.current_index).toBe(3);
    expect(isDeckFinished(s, n)).toBe(false);
    s = answerCard(s, true, n);
    expect(s.known).toEqual([0, 1, 2, 3, 4]);
    expect(isDeckFinished(s, n)).toBe(true);
    expect(nextCardIndex(s, 3, n)).toBe(-1);
  });

  it("after jumping to a known card and answering, continues with cards that still need work", () => {
    const s = { current_index: 0, known: [0, 1, 2], review: [] };
    expect(answerCard(s, true, 5).current_index).toBe(3);
  });
});

describe("validateFlashcardState", () => {
  it("accepts a well-formed snapshot and collapses duplicates", () => {
    const r = validateFlashcardState({ current_index: 3, known: [2, 0, 2], review: [1] }, N);
    expect(r).toEqual({ ok: true, value: { current_index: 3, known: [0, 2], review: [1] } });
  });

  it.each([
    [{ current_index: N, known: [], review: [] }, /current_index/],
    [{ current_index: 1.5, known: [], review: [] }, /current_index/],
    [{ current_index: "1", known: [], review: [] }, /current_index/],
    [{ current_index: 0, known: [-1], review: [] }, /known/],
    [{ current_index: 0, known: [], review: [N] }, /review/],
    [{ current_index: 0, known: "0", review: [] }, /known/],
    [{ current_index: 0, known: [1], review: [1] }, /both/],
    [null, /object/],
  ])("rejects %j", (input, msg) => {
    const r = validateFlashcardState(input, N);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
});

describe("restoreFlashcardState", () => {
  const key = flashcardDeckKey(deck);

  it("restores a snapshot saved for the same deck", () => {
    const saved = { deck_key: key, current_index: 4, known: [0, 1], review: [3] };
    expect(restoreFlashcardState(saved, key, N)).toEqual({ current_index: 4, known: [0, 1], review: [3] });
  });

  it("starts fresh when the deck was regenerated or nothing was saved", () => {
    const saved = { deck_key: "other-deck", current_index: 4, known: [0, 1], review: [3] };
    expect(restoreFlashcardState(saved, key, N)).toEqual(emptyFlashcardState());
    expect(restoreFlashcardState(null, key, N)).toEqual(emptyFlashcardState());
  });

  it("drops indices that no longer fit the deck instead of crashing", () => {
    const saved = { deck_key: key, current_index: 99, known: [0, 99], review: [0, 2] };
    expect(restoreFlashcardState(saved, key, N)).toEqual({ current_index: 0, known: [0], review: [2] });
  });
});

describe("uniqueCompletions", () => {
  const ev = (id: string, student: string, lesson: string, modality: LearningEvent["modality"], minute: number): LearningEvent => ({
    id,
    created_at: new Date(Date.UTC(2024, 0, 1, 0, minute)).toISOString(),
    classroom_id: "c",
    student_id: student,
    student_name: student,
    lesson_id: lesson,
    type: "modality_complete",
    modality,
  });

  it("counts each student/lesson/format once and keeps the earliest event", () => {
    const events = [
      ev("late", "s1", "l1", "game", 5),
      ev("early", "s1", "l1", "game", 1),
      ev("x", "s1", "l1", "song", 2), // different format
      ev("y", "s1", "l2", "game", 3), // different lesson
      ev("z", "s2", "l1", "game", 4), // different student
      { ...ev("open", "s1", "l1", "game", 0), type: "modality_open" as const },
    ];
    const out = uniqueCompletions(events);
    expect(out.map((e) => e.id)).toEqual(["early", "x", "y", "z"]);
  });
});

describe("client save ordering helpers", () => {
  const fc = (i: number) => ({ deck_key: "d", current_index: i, known: [0], review: [] });

  it("nextRev is strictly increasing even within the same millisecond or with a clock behind the server", () => {
    expect(nextRev(0, 1_000)).toBe(1_000);
    expect(nextRev(1_000, 1_000)).toBe(1_001); // same ms
    expect(nextRev(5_000, 1_000)).toBe(5_001); // server rev from a faster clock
    let last = 0;
    for (let i = 0; i < 100; i++) {
      const r = nextRev(last, 42);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
  });

  it("a newer unconfirmed local snapshot wins over the server copy and is re-sent", () => {
    const local = { rev: 20, flashcards: fc(3) };
    expect(reconcileFlashcards({ flashcards: fc(1), flashcards_rev: 10 }, local)).toEqual({ flashcards: fc(3), rev: 20, resend: local, clearLocal: false });
  });

  it("the server copy wins when it is as new or newer, and the local copy is cleared", () => {
    expect(reconcileFlashcards({ flashcards: fc(1), flashcards_rev: 20 }, { rev: 20, flashcards: fc(3) })).toEqual({ flashcards: fc(1), rev: 20, resend: null, clearLocal: true });
    expect(reconcileFlashcards({ flashcards: fc(1), flashcards_rev: 30 }, { rev: 20, flashcards: fc(3) }).flashcards).toEqual(fc(1));
    expect(reconcileFlashcards({ flashcards: null, flashcards_rev: 0 }, null)).toEqual({ flashcards: null, rev: 0, resend: null, clearLocal: false });
  });

  it("ignores malformed local copies", () => {
    expect(parsePendingFlashcards(JSON.stringify({ rev: 5, flashcards: fc(1) }))).toEqual({ rev: 5, flashcards: fc(1) });
    for (const bad of [null, "", "{oops", "null", JSON.stringify({ rev: "5", flashcards: fc(1) }), JSON.stringify({ rev: 5 }), JSON.stringify({ rev: 0, flashcards: fc(1) })]) {
      expect(parsePendingFlashcards(bad)).toBeNull();
    }
  });
});
