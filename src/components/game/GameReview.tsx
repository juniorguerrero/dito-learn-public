"use client";

import { useEffect, useRef } from "react";
import type { ReviewItem } from "@/lib/gameEngine";

// Answer review for one finished Concept Quest game, shared by the student's
// game tab and the teacher's game results: every question with the chosen and
// the correct answer and the explanation, the matching puzzle and boss tries.

export const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2";

export const when = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
};

export function OutcomeLabel({ outcome }: { outcome: "victory" | "game_over" }) {
  return outcome === "victory" ? <span>👑 Quest complete</span> : <span>💀 Out of lives</span>;
}

export type ReviewData = {
  game_title: string;
  outcome: "victory" | "game_over";
  score: number;
  lives_left: number;
  levels_cleared: number;
  levels_total: number;
  levels: { title: string; concept_name: string }[];
  review: ReviewItem[];
  finished_at?: string;
  is_current_version?: boolean;
};

export function ReviewPanel({
  data,
  onBack,
  backLabel,
  perspective = "student",
  studentName,
}: {
  data: ReviewData;
  onBack: () => void;
  backLabel: string;
  // "teacher": labels say "chosen" instead of "your answer", and name the student.
  perspective?: "student" | "teacher";
  studentName?: string;
}) {
  const chosen = perspective === "teacher" ? "chosen" : "your answer";
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const levelIdxs = Array.from(new Set(data.review.map((r) => r.level))).sort((a, b) => a - b);

  return (
    <section aria-labelledby="quest-review-heading" data-testid="game-review" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
      <button onClick={onBack} className={`rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium hover:border-violet-300 ${FOCUS_RING}`}>
        ← {backLabel}
      </button>
      <h3 id="quest-review-heading" ref={headingRef} tabIndex={-1} className="mt-3 text-lg font-bold outline-none">
        📝 {perspective === "teacher" && studentName ? `${studentName}’s answers` : "Answer review"}: {data.game_title}
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        <OutcomeLabel outcome={data.outcome} /> · ⭐ {data.score} · {data.levels_cleared}/{data.levels_total} levels cleared · {data.lives_left}{" "}
        {data.lives_left === 1 ? "life" : "lives"} left
        {data.finished_at && <> · {when(data.finished_at)}</>}
      </p>
      {data.is_current_version === false && (
        <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
          This game was played on an earlier version of the quest. The questions below are the ones asked then.
        </p>
      )}

      {levelIdxs.map((li) => (
        <div key={li} className="mt-5">
          <h4 className="font-semibold text-violet-700">{data.levels[li]?.title ?? `Level ${li + 1}`}</h4>
          <ol className="mt-2 space-y-3">
            {data.review
              .filter((r) => r.level === li)
              .map((r, i) =>
                r.kind === "matching" ? (
                  <li key={i} className="rounded-xl border border-slate-200 p-3 text-sm">
                    <p className="font-semibold">
                      🧩 Matching puzzle · {r.mistakes} {r.mistakes === 1 ? "miss" : "misses"} · +{r.points}
                    </p>
                    <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                      {r.pairs.map((p, j) => (
                        <li key={j} className="rounded-lg bg-slate-50 px-2 py-1 text-slate-600">
                          <span className="font-medium text-slate-800">{p.term}</span> → {p.match}
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : (
                  <li key={i} className={`rounded-xl border p-3 text-sm ${r.correct ? "border-emerald-200" : "border-rose-200"}`}>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      {r.kind === "boss" ? `👑 Boss question${r.index > 0 ? ` · try ${r.index + 1}` : ""}` : `🚪 Quiz gate ${r.index + 1}`} ·{" "}
                      <span className={r.correct ? "text-emerald-600" : "text-rose-600"}>{r.correct ? `Correct, +${r.points}` : "Wrong, −1 life"}</span>
                    </p>
                    <p className="mt-1 font-semibold">{r.question}</p>
                    <ul className="mt-2 space-y-1">
                      {r.options.map((o, j) => {
                        const isCorrect = j === r.correct_index;
                        const isChoice = j === r.choice;
                        return (
                          <li
                            key={j}
                            className={`rounded-lg px-2 py-1 ${isCorrect ? "bg-emerald-50 text-emerald-800" : isChoice ? "bg-rose-50 text-rose-800" : "text-slate-500"}`}
                          >
                            {o}
                            {isChoice && <span className="ml-2 text-xs font-semibold">{isCorrect ? `✓ ${chosen}` : `✗ ${chosen}`}</span>}
                            {isCorrect && !isChoice && <span className="ml-2 text-xs font-semibold">✓ correct answer</span>}
                          </li>
                        );
                      })}
                    </ul>
                    {r.explanation && <p className="mt-2 text-slate-600">💡 {r.explanation}</p>}
                  </li>
                )
              )}
          </ol>
        </div>
      ))}
    </section>
  );
}
