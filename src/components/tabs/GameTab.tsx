"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GameSpecData, GameLevel, QuizGate } from "@/lib/types";
import {
  GameEffect,
  GameState,
  ReviewItem,
  TranscriptEntry,
  applyEntry,
  checkPlayable,
  gameVersionKey,
  initialGameState,
  isTerminal,
  resultFromState,
  startNextLevel,
  START_LIVES,
} from "@/lib/gameEngine";
import type { AttemptDetail } from "@/lib/gameResults";
import { FOCUS_RING, OutcomeLabel, ReviewPanel, when } from "../game/GameReview";
import type { GameResultsApi, SaveState } from "../student/useGameResults";
import { GenState } from "../Dashboard";
import TabShell from "../TabShell";

// ---------- Phaser stage (transparent canvas over the level background) ----------

type StageAPI = {
  advance: (step: number, totalSteps: number) => void;
  celebrate: () => void;
  hurt: () => void;
  victory: () => void;
};

function PhaserStage({
  backgroundUrl,
  onReady,
}: {
  backgroundUrl?: string;
  onReady: (api: StageAPI) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<any>(null);

  useEffect(() => {
    let destroyed = false;

    (async () => {
      const Phaser = (await import("phaser")).default;
      if (destroyed || !hostRef.current) return;

      const W = hostRef.current.clientWidth || 800;
      const H = 220;

      class QuestScene extends Phaser.Scene {
        hero!: Phaser.GameObjects.Text;
        ground!: Phaser.GameObjects.Rectangle;

        create() {
          this.ground = this.add.rectangle(W / 2, H - 14, W, 6, 0xffffff, 0.5);
          // Path step markers
          for (let i = 0; i <= 5; i++) {
            const x = 60 + (i * (W - 140)) / 5;
            this.add.circle(x, H - 14, 7, 0xffffff, i === 5 ? 0.9 : 0.6);
            if (i === 5) this.add.text(x - 12, H - 60, "👑", { fontSize: "26px" });
          }
          this.hero = this.add.text(48, H - 58, "🧙", { fontSize: "38px" });
          this.tweens.add({
            targets: this.hero,
            y: H - 64,
            duration: 700,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          });
        }

        moveTo(step: number, total: number) {
          const x = 48 + (step * (W - 140)) / total;
          this.tweens.add({ targets: this.hero, x, duration: 600, ease: "Cubic.easeOut" });
        }

        burst(color: number) {
          for (let i = 0; i < 16; i++) {
            const p = this.add.circle(this.hero.x + 20, this.hero.y + 10, 4, color);
            this.tweens.add({
              targets: p,
              x: p.x + Math.cos((i / 16) * Math.PI * 2) * (40 + Math.random() * 40),
              y: p.y + Math.sin((i / 16) * Math.PI * 2) * (40 + Math.random() * 40),
              alpha: 0,
              duration: 650,
              onComplete: () => p.destroy(),
            });
          }
        }

        shake() {
          this.cameras.main.shake(220, 0.012);
          this.burst(0xef4444);
        }

        celebrateFx() {
          this.burst(0x34d399);
        }

        victoryFx() {
          for (let i = 0; i < 40; i++) {
            const p = this.add.text(Math.random() * W, -20 - Math.random() * 120, ["🎉", "⭐", "✨"][i % 3], { fontSize: "20px" });
            this.tweens.add({ targets: p, y: H + 30, angle: 360, duration: 1400 + Math.random() * 1200, onComplete: () => p.destroy() });
          }
        }
      }

      const scene = new QuestScene({ key: "quest" });
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: W,
        height: H,
        transparent: true,
        scene,
      });
      gameRef.current = game;

      // Wait a tick for create() to run, then expose the API. Calls that arrive
      // after this stage was torn down (e.g. the player left for the results
      // screen, or a new stage is still loading) are ignored instead of
      // touching a destroyed scene.
      setTimeout(() => {
        if (destroyed) return;
        const live = (fn: () => void) => {
          if (!destroyed) fn();
        };
        onReady({
          advance: (step, total) => live(() => scene.moveTo(step, total)),
          celebrate: () => live(() => scene.celebrateFx()),
          hurt: () => live(() => scene.shake()),
          victory: () => live(() => scene.victoryFx()),
        });
      }, 300);
    })();

    return () => {
      destroyed = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="relative h-[220px] w-full overflow-hidden rounded-t-3xl bg-cover bg-center"
      style={{ backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : "linear-gradient(135deg,#7c3aed,#db2777)" }}
    >
      <div className="absolute inset-0 bg-black/25" />
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}


// ---------- Game logic ----------
// React drives the quest with the shared rules in src/lib/gameEngine.ts (the
// server replays the same rules to score a saved attempt); Phaser renders the stage.

type Screen = "auto" | "results" | "play" | "review";
type ReviewSource = { kind: "local" } | { kind: "server"; id: string };


function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}


function QuizGateCard({
  gate,
  label,
  onResult,
}: {
  gate: QuizGate;
  label: string;
  onResult: (choice: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const reported = useRef(false); // one answer per card, however many clicks arrive
  const continueRef = useRef<HTMLButtonElement>(null);
  const done = picked !== null;

  // The options become disabled once one is picked: keep keyboard focus in the game.
  useEffect(() => {
    if (done) continueRef.current?.focus();
  }, [done]);

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-violet-500">{label}</p>
      <p className="mt-1 font-semibold leading-snug">{gate.question}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {gate.options.map((opt, i) => {
          let cls = "border-slate-200 bg-white hover:border-violet-300";
          if (done && i === gate.correct_index) cls = "border-emerald-400 bg-emerald-50";
          else if (done && i === picked) cls = "border-rose-400 bg-rose-50";
          else if (done) cls = "border-slate-200 bg-white opacity-60";
          return (
            <button
              key={i}
              disabled={done}
              onClick={() => setPicked((p) => p ?? i)}
              className={`rounded-xl border-2 p-3 text-left text-sm transition ${FOCUS_RING} ${cls}`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {done && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-start sm:justify-between" role="status">
          <p className="text-sm text-slate-600">
            {picked === gate.correct_index ? "✅ " : "❌ "}
            {gate.explanation}
          </p>
          <button
            ref={continueRef}
            disabled={sent}
            onClick={() => {
              if (reported.current || picked === null) return;
              reported.current = true;
              setSent(true);
              onResult(picked);
            }}
            className={`shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-70 ${FOCUS_RING}`}
          >
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}

function MatchingPuzzle({
  level,
  solved,
  mistakes,
  locked,
  onPick,
}: {
  level: GameLevel;
  solved: number[];
  mistakes: number;
  locked: boolean;
  onPick: (term: number, match: number) => "hit" | "miss" | "invalid";
}) {
  const pairs = level.matching_pairs;
  // Shuffle pair indices (not strings) so every pick is recorded exactly.
  const terms = useMemo(() => shuffled(pairs.map((_, i) => i)), [pairs]);
  const matches = useMemo(() => shuffled(pairs.map((_, i) => i)), [pairs]);
  const [selTerm, setSelTerm] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const termRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const solvedSet = new Set(solved);
  const solvedMatchText = new Set(solved.map((t) => pairs[t].match));

  function pickMatch(m: number) {
    if (selTerm === null || locked) return;
    const r = onPick(selTerm, m);
    if (r === "hit") {
      const justSolved = selTerm;
      setSelTerm(null);
      // The matched buttons become disabled; move keyboard focus to the next open term.
      setTimeout(() => {
        const next = terms.find((t) => t !== justSolved && !solvedSet.has(t));
        if (next !== undefined) termRefs.current[next]?.focus();
      }, 0);
    } else if (r === "miss") {
      setFlash(m);
      setTimeout(() => setFlash(null), 400);
    }
  }

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-violet-500">🧩 Matching puzzle</p>
      <p className="mt-1 text-sm text-slate-500">Match each term on the left with its meaning on the right.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="space-y-2">
          {terms.map((t) => (
            <button
              key={t}
              ref={(el) => {
                termRefs.current[t] = el;
              }}
              disabled={solvedSet.has(t) || locked}
              aria-pressed={selTerm === t}
              onClick={() => setSelTerm(t)}
              className={`w-full rounded-xl border-2 p-2.5 text-left text-sm font-medium transition ${FOCUS_RING} ${
                solvedSet.has(t)
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : selTerm === t
                  ? "border-violet-500 bg-violet-50"
                  : "border-slate-200 bg-white hover:border-violet-300"
              }`}
            >
              {pairs[t].term}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {matches.map((m) => (
            <button
              key={m}
              disabled={solvedMatchText.has(pairs[m].match) || locked}
              onClick={() => pickMatch(m)}
              className={`w-full rounded-xl border-2 p-2.5 text-left text-sm transition ${FOCUS_RING} ${
                solvedMatchText.has(pairs[m].match)
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : flash === m
                  ? "border-rose-400 bg-rose-50"
                  : "border-slate-200 bg-white hover:border-violet-300"
              }`}
            >
              {pairs[m].match}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400" aria-live="polite">
        {solved.length}/{pairs.length} matched · {mistakes} misses
      </p>
    </div>
  );
}

// ---------- Saved results (student) ----------

function SaveLine({ results, attemptId, localScore }: { results?: GameResultsApi; attemptId: string | null; localScore: number }) {
  if (!results) return null; // teacher preview: nothing is recorded
  let text: React.ReactNode;
  let tone = "text-slate-500";
  let retry = false;
  if (results.mode !== "synced") {
    text = `⚠️ ${results.notice ?? "Game results aren't being saved."}`;
    tone = "text-amber-700";
  } else if (!attemptId) {
    text = "This game was played without saving.";
  } else {
    const s: SaveState | undefined = results.saves[attemptId];
    if (!s || s.status === "saving") text = "Saving your result…";
    else if (s.status === "saved") {
      tone = "text-emerald-700";
      text = s.attempt.score === localScore ? "✓ Result saved" : `✓ Result saved (score recorded: ${s.attempt.score})`;
    } else if (s.status === "retrying") {
      tone = "text-amber-700";
      retry = true;
      text = `⚠️ Not saved yet — ${s.message.replace(/\.$/, "")}. Your answers are kept on this device and we'll keep trying.`;
    } else if (s.status === "held") {
      tone = "text-amber-700";
      retry = true;
      text = `⚠️ Not saved — ${s.message.replace(/\.$/, "")}. Your answers are kept on this device; try again later or tell your teacher.`;
    } else {
      tone = "text-rose-700";
      text = `⚠️ This result couldn't be saved: ${s.message}`;
    }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm" data-testid="game-save-status">
      <p role="status" aria-live="polite" className={tone}>{text}</p>
      {retry && (
        <button onClick={results.retryNow} className={`rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 ${FOCUS_RING}`}>
          Retry now
        </button>
      )}
    </div>
  );
}


function ResultsHome({
  results,
  canStart,
  onNewAttempt,
  onReview,
}: {
  results: GameResultsApi;
  canStart: boolean;
  onNewAttempt: () => void;
  onReview: (attemptId: string) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const s = results.summary;
  const latest = s?.latest ?? null;
  const [showAll, setShowAll] = useState(false);
  const attempts = s?.attempts ?? [];
  const shown = showAll ? attempts : attempts.slice(0, 5);

  return (
    <section aria-labelledby="quest-results-heading" data-testid="game-results" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
      <h3 id="quest-results-heading" ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">
        🎮 Your Concept Quest results
      </h3>

      {results.pending.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="game-pending">
          {results.pending.map((p) => {
            const st = results.saves[p.attempt_id];
            return (
              <p key={p.attempt_id} role="status" aria-live="polite">
                ⏳ A game you finished {when(p.finished_at)} isn&apos;t saved yet
                {st?.status === "saving"
                  ? " — saving…"
                  : st?.status === "retrying"
                  ? ` — ${st.message} It's kept on this device and we'll keep trying.`
                  : st?.status === "held"
                  ? ` — ${st.message} It's kept on this device.`
                  : "."}
              </p>
            );
          })}
          <button onClick={results.retryNow} className={`mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-semibold hover:bg-amber-100 ${FOCUS_RING}`}>
            Retry now
          </button>
        </div>
      )}

      {results.rejected.length > 0 && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" data-testid="game-rejected" role="alert">
          {results.rejected.map((r) => (
            <p key={r.attempt_id} className="flex flex-wrap items-center justify-between gap-2">
              <span>⚠️ A game you finished {when(r.finished_at)} couldn&apos;t be saved: {r.message}</span>
              <button onClick={() => results.dismissRejected(r.attempt_id)} className={`rounded-lg border border-rose-300 bg-white px-2 py-0.5 text-xs font-semibold ${FOCUS_RING}`}>
                Dismiss
              </button>
            </p>
          ))}
        </div>
      )}

      {latest ? (
        <div className="mt-4 rounded-2xl bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4" data-testid="game-latest">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-500">Latest result · {when(latest.finished_at)}</p>
          <p className="mt-1 text-xl font-bold">
            <OutcomeLabel outcome={latest.outcome} /> · ⭐ <span data-testid="game-latest-score">{latest.score}</span>
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            {latest.levels_cleared}/{latest.levels_total} levels cleared · {latest.lives_left} {latest.lives_left === 1 ? "life" : "lives"} left
            {!latest.is_current_version && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">earlier version of this game</span>}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No finished games yet.</p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {latest && (
          <button onClick={() => onReview(latest.id)} className={`rounded-2xl border-2 border-violet-300 px-6 py-2.5 font-semibold text-violet-700 transition hover:bg-violet-50 ${FOCUS_RING}`}>
            📝 Review answers
          </button>
        )}
        {canStart && (
          <button onClick={onNewAttempt} className={`rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 py-2.5 font-semibold text-white shadow-lg transition hover:opacity-95 ${FOCUS_RING}`}>
            ▶ Start new attempt
          </button>
        )}
      </div>

      {s && s.best_by_version.length > 0 && (
        <div className="mt-5">
          <h4 className="text-sm font-semibold text-slate-600">Best score by game version</h4>
          <ul className="mt-2 space-y-1.5" data-testid="game-best-by-version">
            {s.best_by_version.map((v) => (
              <li
                key={v.version}
                data-current={v.is_current ? "true" : "false"}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${v.is_current ? "border-2 border-violet-300 bg-violet-50" : "border border-slate-200 bg-slate-50 text-slate-600"}`}
              >
                <span>
                  {v.is_current ? (
                    <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-bold text-white">Current game</span>
                  ) : (
                    <span className="text-xs">Earlier version · first played {when(v.first_played_at)}</span>
                  )}
                </span>
                <span>
                  Best ⭐ <span className="font-bold">{v.best_score}</span> · {v.finished_attempts} {v.finished_attempts === 1 ? "game" : "games"} · {v.victories} won
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {attempts.length > 0 && (
        <div className="mt-5">
          <h4 className="text-sm font-semibold text-slate-600">
            Finished games (<span data-testid="game-finished-count">{s?.finished_count ?? attempts.length}</span>)
          </h4>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="game-history">
            {shown.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => onReview(a.id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-slate-50 ${FOCUS_RING}`}
                  aria-label={`Review game from ${when(a.finished_at)}: ${a.outcome === "victory" ? "quest complete" : "out of lives"}, score ${a.score}`}
                >
                  <span className="text-slate-500">{when(a.finished_at)}</span>
                  <span className="flex items-center gap-2">
                    <OutcomeLabel outcome={a.outcome} />
                    <span className="font-semibold">⭐ {a.score}</span>
                    {!a.is_current_version && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">earlier version</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {attempts.length > 5 && (
            <button onClick={() => setShowAll((v) => !v)} className={`mt-2 text-xs font-semibold text-violet-600 hover:underline ${FOCUS_RING}`}>
              {showAll ? "Show fewer" : `Show all ${attempts.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ServerReview({ results, attemptId, onBack }: { results: GameResultsApi; attemptId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { loadAttempt } = results;
  useEffect(() => {
    let live = true;
    loadAttempt(attemptId)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load that game"));
    return () => {
      live = false;
    };
  }, [attemptId, loadAttempt]);
  if (error) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm" role="alert">
        <p className="text-rose-700">⚠️ {error}</p>
        <button onClick={onBack} className={`mt-3 rounded-xl border border-slate-200 px-3 py-1.5 font-medium ${FOCUS_RING}`}>← Back to my results</button>
      </div>
    );
  }
  if (!detail) return <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400" role="status">Loading your answers…</div>;
  return <ReviewPanel data={detail} onBack={onBack} backLabel="Back to my results" />;
}

// ---------- The quest ----------

function ConceptQuest({
  data,
  version,
  results,
  onGameChanged,
  startIn = "auto",
}: {
  data: GameSpecData;
  version: string;
  results?: GameResultsApi;
  onGameChanged: () => void;
  startIn?: Screen;
}) {
  const playable = useMemo(() => checkPlayable(data), [data]);
  const [screen, setScreen] = useState<Screen>(startIn);
  const [engine, setEngineState] = useState<GameState>(initialGameState);
  const engineRef = useRef<GameState>(engine);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const [localReview, setLocalReview] = useState<ReviewItem[]>([]);
  const [showIntro, setShowIntro] = useState(true);
  const [run, setRun] = useState(0); // a new run remounts the cards
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const attemptRef = useRef<string | null>(null);
  const [unsaved, setUnsaved] = useState(false); // student chose to play without saving after a failed start
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [startError, setStartError] = useState<{ message: string; code: string; retryable: boolean } | null>(null);
  const [hold, setHold] = useState<number | null>(null); // matching points shown after the 500 ms "all matched" pause
  const [review, setReview] = useState<ReviewSource | null>(null);
  const finishedRef = useRef(false);
  const interactedRef = useRef(false);
  const playAreaRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageAPI | null>(null);

  const setEngine = (s: GameState) => {
    engineRef.current = s;
    setEngineState(s);
  };

  const level = data.levels[engine.level];
  const totalSteps = 5; // 3 gates + matching + boss
  const inMatching = engine.phase === "matching" || hold !== null;
  const step = showIntro
    ? 0
    : engine.phase === "gate"
    ? engine.gate
    : inMatching
    ? 3
    : engine.phase === "boss"
    ? 4
    : engine.phase === "level_done" || engine.phase === "victory"
    ? 5
    : 0;

  useEffect(() => {
    stageRef.current?.advance(step, totalSteps);
  }, [step]);

  // After each step, keep keyboard focus inside the game (the pressed button is gone).
  const focusKey = `${run}-${showIntro}-${engine.level}-${engine.phase}-${engine.gate}-${engine.boss_try}-${hold !== null}`;
  useEffect(() => {
    if (interactedRef.current) playAreaRef.current?.focus({ preventScroll: true });
  }, [focusKey]);

  const hasHistory = Boolean(results && results.mode === "synced" && (results.summary?.latest || results.pending.length > 0));
  let view: Screen | "loading" = screen;
  if (view === "auto") view = results && results.mode === "loading" ? "loading" : hasHistory || !playable.ok ? "results" : "play";

  function onGameEnd() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const id = attemptRef.current;
    if (id && results) results.finish(id, transcriptRef.current);
  }

  function apply(entry: TranscriptEntry): GameEffect | null {
    interactedRef.current = true;
    const cur = engineRef.current;
    const r = applyEntry(data, cur, entry);
    if (!r.ok) return null; // a stale/duplicate answer: ignored, nothing counted twice
    transcriptRef.current.push(entry);
    if (r.review) setLocalReview((x) => [...x, r.review!]);
    setEngine(r.state);
    if (r.effect === "correct") stageRef.current?.celebrate();
    if (r.effect === "wrong") stageRef.current?.hurt();
    if (r.effect === "matching_done") {
      setHold(r.state.score - cur.score);
      setTimeout(() => {
        setHold(null);
        stageRef.current?.celebrate();
      }, 500);
    }
    if (r.state.phase === "victory") stageRef.current?.victory();
    if (isTerminal(r.state)) onGameEnd();
    return r.effect;
  }

  async function beginLevel() {
    interactedRef.current = true;
    const fresh = engineRef.current.level === 0 && transcriptRef.current.length === 0;
    if (fresh && results && results.mode === "synced" && !unsaved && !attemptRef.current) {
      if (startingRef.current) return; // double click while starting
      startingRef.current = true;
      setStarting(true);
      setStartError(null);
      const r = await results.start(version);
      startingRef.current = false;
      setStarting(false);
      if (!r.ok) {
        setStartError(r);
        if (r.code === "game_changed") onGameChanged();
        return;
      }
      attemptRef.current = r.attemptId;
      setAttemptId(r.attemptId);
    }
    setScreen("play");
    setShowIntro(false);
  }

  function nextLevel() {
    interactedRef.current = true;
    setEngine(startNextLevel(engineRef.current));
    setShowIntro(true);
  }

  function newAttempt() {
    interactedRef.current = true;
    setEngine(initialGameState());
    transcriptRef.current = [];
    setLocalReview([]);
    finishedRef.current = false;
    attemptRef.current = null;
    setAttemptId(null);
    setUnsaved(false);
    setStartError(null);
    setHold(null);
    setReview(null);
    setShowIntro(true);
    setRun((n) => n + 1);
    setScreen("play");
  }

  const localNotice =
    results && results.mode === "local" && results.notice ? (
      <p className="mb-3 text-xs text-amber-700" role="status">⚠️ {results.notice}</p>
    ) : results && results.mode === "unavailable" ? (
      <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status" data-testid="game-results-unavailable">
        <p className="font-semibold">⚠️ Your saved game results can&apos;t be loaded right now.</p>
        {results.notice && <p className="mt-1">{results.notice}</p>}
        {results.pending.length > 0 && (
          <p className="mt-1" data-testid="game-kept-count">
            {results.pending.length === 1 ? "1 finished game is" : `${results.pending.length} finished games are`} kept on this device and will be saved once your
            results can be loaded again.
          </p>
        )}
        <p className="mt-1">You can still play, but new games won&apos;t be saved until then.</p>
        <button onClick={results.reloadResults} className={`mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-semibold hover:bg-amber-100 ${FOCUS_RING}`}>
          Try again
        </button>
      </div>
    ) : null;

  if (view === "loading") {
    return <div className="rounded-3xl border border-slate-200 bg-white p-14 text-center text-sm text-slate-400" role="status">Loading your game results…</div>;
  }

  if (view === "review" && review) {
    if (review.kind === "server" && results) return <ServerReview results={results} attemptId={review.id} onBack={() => setScreen("results")} />;
    const r = resultFromState(data, engine, localReview);
    return (
      <ReviewPanel
        data={{ ...r, game_title: data.game_title }}
        onBack={() => setScreen("play")}
        backLabel="Back to the game"
      />
    );
  }

  const unplayableNotice = !playable.ok ? (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" role="alert" data-testid="game-unplayable">
      <p className="font-semibold">🧩 This game can&apos;t be played right now.</p>
      <p className="mt-1">{playable.reason}</p>
      <p className="mt-1">{results ? "Ask your teacher to regenerate the game." : "Use ↻ Regenerate below to build a new version."}</p>
    </div>
  ) : null;

  if (view === "results" || !playable.ok) {
    return (
      <div>
        {localNotice}
        {unplayableNotice}
        {results && results.mode === "synced" && (
          <ResultsHome
            results={results}
            canStart={playable.ok}
            onNewAttempt={newAttempt}
            onReview={(id) => {
              setReview({ kind: "server", id });
              setScreen("review");
            }}
          />
        )}
      </div>
    );
  }

  if (!level) return null;
  const score = hold !== null ? engine.score - hold : engine.score;
  const lives = engine.lives;
  const canSeeResults = Boolean(results && results.mode === "synced");

  return (
    <div>
      {localNotice}
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md">
        {/* Stage: remount per level so the background swaps */}
        <div key={engine.level}>
          <PhaserStage backgroundUrl={level.background_url} onReady={(api) => (stageRef.current = api)} />
        </div>

        {/* HUD */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3 text-sm">
          <span className="font-bold text-violet-700">{data.game_title}</span>
          <div className="flex items-center gap-4">
            <span className="font-semibold" data-testid="game-score" aria-label={`Score ${score}`}>⭐ {score}</span>
            <span aria-label={`${Math.max(0, lives)} of 3 lives left`} data-testid="game-lives">
              {"❤️".repeat(Math.max(0, lives))}
              {"🖤".repeat(Math.max(0, 3 - lives))}
            </span>
            <span className="text-slate-400">
              Level {engine.level + 1}/{data.levels.length}
            </span>
          </div>
        </div>

        <div className="p-4 outline-none sm:p-6" ref={playAreaRef} tabIndex={-1} data-testid="game-play-area">
          {showIntro && (
            <div className="text-center">
              <h3 className="text-lg font-bold">{level.title}</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-600">{level.concept_explanation}</p>
              {engine.level === 0 && <p className="mx-auto mt-2 max-w-lg text-xs text-slate-400">{data.intro_text}</p>}
              <button
                onClick={() => void beginLevel()}
                disabled={starting}
                className={`mt-5 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3 font-semibold text-white shadow-lg transition hover:opacity-95 disabled:opacity-70 ${FOCUS_RING}`}
              >
                {starting ? "Starting…" : "⚔️ Start level"}
              </button>
              {startError && (
                <div className="mx-auto mt-3 max-w-md rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="alert" data-testid="game-start-error">
                  <p>⚠️ {startError.code === "game_changed" ? "This game was just updated. Loading the new version…" : `Couldn't start a saved game: ${startError.message}`}</p>
                  {startError.code !== "game_changed" && startError.code !== "game_unplayable" && (
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      <button onClick={() => void beginLevel()} className={`rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 ${FOCUS_RING}`}>
                        Try again
                      </button>
                      <button
                        onClick={() => {
                          setUnsaved(true);
                          setStartError(null);
                          setScreen("play");
                          setShowIntro(false);
                        }}
                        className={`rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold hover:bg-amber-100 ${FOCUS_RING}`}
                      >
                        Play without saving
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!showIntro && engine.phase === "gate" && (
            <QuizGateCard
              key={`gate-${run}-${engine.level}-${engine.gate}`}
              gate={level.quiz_gates[engine.gate]}
              label={`🚪 Quiz gate ${engine.gate + 1} of 3`}
              onResult={(choice) => apply({ k: "gate", level: engine.level, gate: engine.gate, choice })}
            />
          )}

          {!showIntro && inMatching && (
            <MatchingPuzzle
              key={`match-${run}-${engine.level}`}
              level={level}
              solved={engine.solved_terms}
              mistakes={engine.match_mistakes}
              locked={hold !== null}
              onPick={(term, match) => {
                const eff = apply({ k: "match", level: engine.level, term, match });
                return eff === "match_miss" ? "miss" : eff ? "hit" : "invalid";
              }}
            />
          )}

          {!showIntro && engine.phase === "boss" && hold === null && (
            <div>
              <p className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-center text-sm font-bold text-rose-600">
                👑 BOSS BATTLE — answer wrong and lose a life!
              </p>
              <QuizGateCard
                key={`boss-${run}-${engine.level}-${engine.boss_try}`}
                gate={level.boss_question}
                label="👑 Final boss"
                onResult={(choice) => apply({ k: "boss", level: engine.level, try: engine.boss_try, choice })}
              />
            </div>
          )}

          {!showIntro && engine.phase === "level_done" && (
            <div className="text-center">
              <div className="text-5xl">🏆</div>
              <h3 className="mt-2 text-lg font-bold">Concept mastered: {level.concept_name}!</h3>
              <p className="mt-1 text-sm text-slate-500">The fog lifts a little more…</p>
              <button
                onClick={nextLevel}
                className={`mt-4 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3 font-semibold text-white shadow-lg transition hover:opacity-95 ${FOCUS_RING}`}
              >
                Next level →
              </button>
            </div>
          )}

          {engine.phase === "victory" && (
            <div className="text-center" data-testid="game-victory">
              <div className="text-6xl">👑🎉</div>
              <h3 className="mt-2 text-xl font-bold">Quest complete!</h3>
              <p className="mt-1 text-slate-500">
                Final score <span className="font-bold text-violet-700">⭐ {engine.score}</span> with {lives} {lives === 1 ? "life" : "lives"} left.
              </p>
              <div className="mx-auto mt-3 flex max-w-md flex-wrap justify-center gap-1.5">
                {engine.mastered.map((m) => (
                  <span key={m} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    ✓ {m}
                  </span>
                ))}
              </div>
              <SaveLine results={results} attemptId={attemptId} localScore={engine.score} />
              <EndButtons
                primary="↻ Play again"
                primaryStyle="outline"
                onAgain={newAttempt}
                onReview={() => {
                  setReview({ kind: "local" });
                  setScreen("review");
                }}
                onResults={canSeeResults ? () => setScreen("results") : undefined}
              />
            </div>
          )}

          {engine.phase === "game_over" && (
            <div className="text-center" data-testid="game-over">
              <div className="text-5xl">💀</div>
              <h3 className="mt-2 text-lg font-bold">Out of lives!</h3>
              <p className="mt-1 text-sm text-slate-500">Score: ⭐ {engine.score}. Review the blueprint and try again — you&apos;ve got this.</p>
              <SaveLine results={results} attemptId={attemptId} localScore={engine.score} />
              <EndButtons
                primary="↻ Try again"
                primaryStyle="solid"
                onAgain={newAttempt}
                onReview={() => {
                  setReview({ kind: "local" });
                  setScreen("review");
                }}
                onResults={canSeeResults ? () => setScreen("results") : undefined}
              />
            </div>
          )}
        </div>
      </div>

      {engine.mastered.length > 0 && engine.phase !== "victory" && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
          Mastered:
          {engine.mastered.map((m) => (
            <span key={m} className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-semibold text-emerald-700">
              ✓ {m}
            </span>
          ))}
        </div>
      )}
      {canSeeResults && hasHistory && showIntro && engine.level === 0 && engine.lives === START_LIVES && engine.score === 0 && (
        <div className="mt-3 text-right">
          <button onClick={() => setScreen("results")} className={`text-xs font-semibold text-violet-600 hover:underline ${FOCUS_RING}`}>
            📊 My results
          </button>
        </div>
      )}
    </div>
  );
}

function EndButtons({
  primary,
  primaryStyle,
  onAgain,
  onReview,
  onResults,
}: {
  primary: string;
  primaryStyle: "outline" | "solid";
  onAgain: () => void;
  onReview: () => void;
  onResults?: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
      <button
        onClick={onAgain}
        className={`rounded-2xl px-8 py-3 font-semibold transition ${FOCUS_RING} ${
          primaryStyle === "outline"
            ? "border-2 border-violet-300 text-violet-700 hover:bg-violet-50"
            : "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg hover:opacity-95"
        }`}
      >
        {primary}
      </button>
      <button onClick={onReview} className={`rounded-2xl border-2 border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:border-violet-300 ${FOCUS_RING}`}>
        📝 Review answers
      </button>
      {onResults && (
        <button onClick={onResults} className={`rounded-2xl border-2 border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:border-violet-300 ${FOCUS_RING}`}>
          📊 All my results
        </button>
      )}
    </div>
  );
}

export default function GameTab({
  data,
  state,
  onGenerate,
  results,
  allowRegenerate = true,
}: {
  data?: GameSpecData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
  // Student lesson only: saves attempts and shows results. The teacher's
  // lesson dashboard passes nothing, so a preview game is never recorded.
  results?: GameResultsApi;
  allowRegenerate?: boolean;
}) {
  const version = useMemo(() => (data ? gameVersionKey(data) : null), [data]);
  const [changedNotice, setChangedNotice] = useState(false);

  return (
    <TabShell
      title="Concept Quest"
      description="Your document becomes a game: clear quiz gates, solve the matching puzzle, and beat the boss question to master each concept."
      emoji="🎮"
      hasData={Boolean(data)}
      state={state}
      onGenerate={onGenerate}
      allowRegenerate={allowRegenerate}
      generateLabel="Build my Game"
      loadingLabel="Building your quest (levels, quizzes, bosses)…"
    >
      {data && version && (
        <div className="mx-auto max-w-3xl">
          {changedNotice && (
            <p className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800" role="status" data-testid="game-changed-notice">
              🔄 This game was updated by your teacher. You&apos;re now on the new version; your earlier results are kept.
            </p>
          )}
          <ConceptQuest
            key={version}
            data={data}
            version={version}
            results={results}
            startIn={changedNotice ? "play" : "auto"}
            onGameChanged={() => {
              setChangedNotice(true);
              onGenerate(false); // fetches the lesson's current game
            }}
          />
        </div>
      )}
    </TabShell>
  );
}
