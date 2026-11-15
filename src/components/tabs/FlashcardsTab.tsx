"use client";

import { useState } from "react";
import { FlashcardsData } from "@/lib/types";
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
}: {
  data?: FlashcardsData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [review, setReview] = useState<Set<number>>(new Set());

  const cards = data?.cards || [];
  const card = cards[index];

  function next(markKnown: boolean) {
    if (markKnown) {
      setKnown((s) => new Set(s).add(index));
      setReview((s) => { const n = new Set(s); n.delete(index); return n; });
    } else {
      setReview((s) => new Set(s).add(index));
      setKnown((s) => { const n = new Set(s); n.delete(index); return n; });
    }
    setFlipped(false);
    setShowHint(false);
    setTimeout(() => setIndex((i) => (i + 1) % cards.length), 150);
  }

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
      {card && (
        <div className="mx-auto max-w-2xl">
          {/* Progress */}
          <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
            <span>
              Card {index + 1} / {cards.length}
            </span>
            <span>
              ✅ {known.size} known · 🔁 {review.size} to review
            </span>
          </div>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
              style={{ width: `${(known.size / cards.length) * 100}%` }}
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
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              onClick={() => next(false)}
              className="rounded-2xl border-2 border-amber-300 bg-amber-50 py-3 font-semibold text-amber-700 transition hover:bg-amber-100 active:scale-[0.99]"
            >
              🔁 Review again
            </button>
            <button
              onClick={() => next(true)}
              className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 py-3 font-semibold text-emerald-700 transition hover:bg-emerald-100 active:scale-[0.99]"
            >
              ✅ I knew it
            </button>
          </div>

          {/* Deck strip */}
          <div className="mt-5 flex flex-wrap justify-center gap-1.5">
            {cards.map((_, i) => (
              <button
                key={i}
                onClick={() => { setIndex(i); setFlipped(false); setShowHint(false); }}
                className={`h-2.5 w-2.5 rounded-full transition ${
                  i === index ? "scale-125 bg-violet-600" : known.has(i) ? "bg-emerald-400" : review.has(i) ? "bg-amber-400" : "bg-slate-300"
                }`}
                aria-label={`Card ${i + 1}`}
              />
            ))}
          </div>
        </div>
      )}
    </TabShell>
  );
}
