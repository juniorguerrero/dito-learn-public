"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Flashcard, FlashcardProgress, FlashcardsData } from "@/lib/types";
import {
  answerCard,
  emptyFlashcardState,
  FlashcardState,
  flashcardDeckKey,
  isDeckFinished,
  jumpToCard,
  nextCardIndex,
  restoreFlashcardState,
} from "@/lib/progressShared";
import { GenState } from "../Dashboard";
import TabShell from "../TabShell";

const DIFF_COLOR: Record<string, string> = {
  easy: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  hard: "bg-rose-100 text-rose-700",
};

export default function FlashcardsTab({
  data,
  state,
  onGenerate,
  savedProgress,
  onProgressChange,
  onDeckComplete,
}: {
  data?: FlashcardsData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
  // Optional persistence (student lessons). Without these the deck is in-memory only.
  savedProgress?: FlashcardProgress | null;
  onProgressChange?: (progress: FlashcardProgress) => void;
  // Called when the student has just marked every card "I knew it".
  onDeckComplete?: () => void;
}) {
  const cards = data?.cards || [];
  const deckKey = useMemo(() => flashcardDeckKey(data), [data]);

  return (
    <TabShell
      title="Flashcards"
      description="Question–answer cards covering every key concept, with hints, difficulty levels and misconception traps."
      emoji="🃏"
      hasData={cards.length > 0}
      state={state}
      onGenerate={onGenerate}
      generateLabel="Generate Flashcards"
      loadingLabel="Writing your flashcards…"
    >
      {cards.length > 0 && (
        // Keyed by deck: a regenerated deck starts fresh instead of reusing stale indices.
        <FlashcardDeck
          key={deckKey}
          cards={cards}
          deckKey={deckKey}
          savedProgress={savedProgress}
          onProgressChange={onProgressChange}
          onDeckComplete={onDeckComplete}
        />
      )}
    </TabShell>
  );
}

function FlashcardDeck({
  cards,
  deckKey,
  savedProgress,
  onProgressChange,
  onDeckComplete,
}: {
  cards: Flashcard[];
  deckKey: string;
  savedProgress?: FlashcardProgress | null;
  onProgressChange?: (progress: FlashcardProgress) => void;
  onDeckComplete?: () => void;
}) {
  const n = cards.length;
  // Choices + the next card to study (what gets persisted), restored once when the deck mounts.
  const [fc, setFc] = useState<FlashcardState>(() => restoreFlashcardState(savedProgress, deckKey, n));
  // "question": answering · "checking": answer revealed after responding · "done": every card known
  const [phase, setPhase] = useState<"question" | "checking" | "done">(() => (isDeckFinished(fc, n) ? "done" : "question"));
  // The card on screen. Older saves may point at a known card: skip to one that still needs work.
  const [index, setIndex] = useState(() => {
    if (!fc.known.includes(fc.current_index)) return fc.current_index;
    const next = nextCardIndex(fc, fc.current_index, n);
    return next === -1 ? fc.current_index : next;
  });
  const [lastAnswer, setLastAnswer] = useState<"known" | "review" | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const known = new Set(fc.known);
  const review = new Set(fc.review);
  const left = n - fc.known.length - fc.review.length;
  const finished = isDeckFinished(fc, n);
  const card = cards[index];

  function commit(nextState: FlashcardState) {
    setFc(nextState);
    onProgressChange?.({ deck_key: deckKey, ...nextState });
  }

  // Record the answer for the card on screen, then reveal its answer so the student can check.
  // The saved position already points at the next card, so a refresh continues from there.
  function respond(knew: boolean) {
    const nextState = answerCard({ ...fc, current_index: index }, knew, n);
    commit(nextState);
    setLastAnswer(knew ? "known" : "review");
    setPhase("checking");
    setFlipped(true);
    setShowHint(false);
  }

  // Mark the format done once the student confirms the finished deck ("See results"),
  // not on the last answer, which they can still change while checking it.
  const reported = useRef(false);
  const reportComplete = () => {
    if (reported.current) return;
    reported.current = true;
    onDeckComplete?.();
  };
  useEffect(() => {
    if (phase === "done") reportComplete(); // also covers reopening an already finished deck
  });

  function goNext() {
    setFlipped(false);
    setShowHint(false);
    setLastAnswer(null);
    if (finished) {
      setPhase("done"); // the effect above reports completion
      return;
    }
    setIndex(fc.current_index);
    setPhase("question");
  }

  function jump(i: number) {
    commit(jumpToCard(fc, i, n));
    setIndex(i);
    setPhase("question");
    setLastAnswer(null);
    setFlipped(false);
    setShowHint(false);
  }

  function practiceAgain() {
    reported.current = false;
    commit(emptyFlashcardState());
    setIndex(0);
    setPhase("question");
    setLastAnswer(null);
    setFlipped(false);
    setShowHint(false);
  }

  const deckStrip = (
    <div className="mt-5 flex flex-wrap justify-center gap-1.5">
      {cards.map((_, i) => (
        <button
          key={i}
          onClick={() => jump(i)}
          className={`h-2.5 w-2.5 rounded-full transition ${
            phase !== "done" && i === index ? "scale-125 bg-violet-600" : known.has(i) ? "bg-emerald-400" : review.has(i) ? "bg-amber-400" : "bg-slate-300"
          }`}
          aria-label={`Card ${i + 1}`}
        />
      ))}
    </div>
  );

  if (phase === "done") {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 p-8 text-center shadow-sm" data-testid="deck-complete">
          <div className="text-5xl">🎉</div>
          <h3 className="mt-2 text-xl font-bold text-emerald-800">Deck complete!</h3>
          <p className="mt-1 text-emerald-700">You know all {n} cards.</p>
          {onDeckComplete && <p className="mt-1 text-sm font-medium text-emerald-600">✓ Flashcards marked as done</p>}
          <button
            onClick={practiceAgain}
            className="mt-5 rounded-2xl border-2 border-emerald-300 bg-white px-6 py-2.5 font-semibold text-emerald-700 transition hover:bg-emerald-100"
          >
            ↺ Practice again
          </button>
          <p className="mt-3 text-xs text-emerald-600/70">Tap a dot below to look at any card again.</p>
        </div>
        {deckStrip}
      </div>
    );
  }

  if (!card) return null;
  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress */}
      <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
        <span>
          Card {index + 1} / {n}
        </span>
        <span>
          ✅ {known.size} known · 🔁 {review.size} to review{left > 0 ? ` · ${left} new` : ""}
        </span>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
          style={{ width: `${(known.size / n) * 100}%` }}
        />
      </div>

      {/* Card */}
      <div className={`flip-card cursor-pointer ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(!flipped)}>
        <div className="flip-card-inner h-72">
          <div className="flip-face flex h-72 flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
            <div className="flex items-center justify-between">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${DIFF_COLOR[card.difficulty] || DIFF_COLOR.medium}`}>
                {card.difficulty}
              </span>
              <div className="flex gap-1">
                {card.tags.slice(0, 3).map((t) => (
                  <span key={t} className="max-w-[110px] truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="nice-scroll flex flex-1 items-center justify-center overflow-y-auto px-2">
              <p className="text-center text-lg font-semibold leading-snug">{card.question}</p>
            </div>
            {showHint ? (
              <p className="rounded-xl bg-amber-50 p-2.5 text-center text-sm text-amber-700">💡 {card.hint}</p>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setShowHint(true); }}
                className="mx-auto text-xs font-medium text-slate-400 hover:text-amber-600"
              >
                💡 Show hint
              </button>
            )}
            <p className="mt-2 text-center text-xs text-slate-300">tap to flip</p>
          </div>
          <div className="flip-face flip-back flex h-72 flex-col rounded-2xl border border-violet-300 bg-gradient-to-br from-violet-600 to-fuchsia-600 p-6 text-white shadow-md">
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">Answer</span>
            <div className="nice-scroll flex flex-1 items-center justify-center overflow-y-auto px-2">
              <p className="text-center leading-relaxed">{card.answer}</p>
            </div>
            <p className="text-center text-xs opacity-50">tap to flip back</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      {phase === "question" ? (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={() => respond(false)}
            className="rounded-2xl border-2 border-amber-300 bg-amber-50 py-3 font-semibold text-amber-700 transition hover:bg-amber-100 active:scale-[0.99]"
          >
            🔁 Review again
          </button>
          <button
            onClick={() => respond(true)}
            className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 py-3 font-semibold text-emerald-700 transition hover:bg-emerald-100 active:scale-[0.99]"
          >
            ✅ I knew it
          </button>
        </div>
      ) : (
        // After responding: show the answer so the student can check, then move on.
        <div
          data-testid="answer-check"
          className={`mt-5 rounded-2xl border-2 p-4 ${lastAnswer === "known" ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
        >
          <p className={`font-semibold ${lastAnswer === "known" ? "text-emerald-800" : "text-amber-800"}`}>
            {lastAnswer === "known" ? "✅ You said you knew it — check the answer above." : "🔁 No problem — read the answer above. This card will come back for review."}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => respond(lastAnswer !== "known")}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
            >
              {lastAnswer === "known" ? "Actually, I got it wrong → review again" : "Actually, I knew it → mark as known"}
            </button>
            <button
              onClick={goNext}
              className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            >
              {finished ? "See results →" : "Next card →"}
            </button>
          </div>
        </div>
      )}

      {deckStrip}
    </div>
  );
}
