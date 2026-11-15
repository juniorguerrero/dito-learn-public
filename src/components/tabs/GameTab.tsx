"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameSpecData, GameLevel, QuizGate } from "@/lib/types";
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

      // Wait a tick for create() to run, then expose the API
      setTimeout(() => {
        if (destroyed) return;
        onReady({
          advance: (step, total) => scene.moveTo(step, total),
          celebrate: () => scene.celebrateFx(),
          hurt: () => scene.shake(),
          victory: () => scene.victoryFx(),
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

// ---------- Game logic (React drives the quest; Phaser renders the stage) ----------

type Phase = "intro" | "gate" | "matching" | "boss" | "level_done" | "victory" | "game_over";

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
  onResult: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;

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
              onClick={() => setPicked(i)}
              className={`rounded-xl border-2 p-3 text-left text-sm transition ${cls}`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {done && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3">
          <p className="text-sm text-slate-600">
            {picked === gate.correct_index ? "✅ " : "❌ "}
            {gate.explanation}
          </p>
          <button
            onClick={() => onResult(picked === gate.correct_index)}
            className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}

function MatchingPuzzle({ level, onDone }: { level: GameLevel; onDone: (mistakes: number) => void }) {
  const terms = useMemo(() => shuffled(level.matching_pairs.map((p) => p.term)), [level]);
  const matches = useMemo(() => shuffled(level.matching_pairs.map((p) => p.match)), [level]);
  const [selTerm, setSelTerm] = useState<string | null>(null);
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  function pickMatch(m: string) {
    if (!selTerm) return;
    const pair = level.matching_pairs.find((p) => p.term === selTerm);
    if (pair?.match === m) {
      const next = new Set(solved).add(selTerm);
      setSolved(next);
      setSelTerm(null);
      if (next.size === level.matching_pairs.length) setTimeout(() => onDone(mistakes), 500);
    } else {
      setMistakes((x) => x + 1);
      setFlash(m);
      setTimeout(() => setFlash(null), 400);
    }
  }

  const solvedMatches = new Set(
    level.matching_pairs.filter((p) => solved.has(p.term)).map((p) => p.match)
  );

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-violet-500">🧩 Matching puzzle</p>
      <p className="mt-1 text-sm text-slate-500">Match each term on the left with its meaning on the right.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="space-y-2">
          {terms.map((t) => (
            <button
              key={t}
              disabled={solved.has(t)}
              onClick={() => setSelTerm(t)}
              className={`w-full rounded-xl border-2 p-2.5 text-left text-sm font-medium transition ${
                solved.has(t)
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : selTerm === t
                  ? "border-violet-500 bg-violet-50"
                  : "border-slate-200 bg-white hover:border-violet-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {matches.map((m) => (
            <button
              key={m}
              disabled={solvedMatches.has(m)}
              onClick={() => pickMatch(m)}
              className={`w-full rounded-xl border-2 p-2.5 text-left text-sm transition ${
                solvedMatches.has(m)
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : flash === m
                  ? "border-rose-400 bg-rose-50"
                  : "border-slate-200 bg-white hover:border-violet-300"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {solved.size}/{level.matching_pairs.length} matched · {mistakes} misses
      </p>
    </div>
  );
}

export default function GameTab({
  data,
  state,
  onGenerate,
}: {
  data?: GameSpecData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
}) {
  const [levelIdx, setLevelIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [gateIdx, setGateIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [mastered, setMastered] = useState<string[]>([]);
  const stageRef = useRef<StageAPI | null>(null);
  const [gateKey, setGateKey] = useState(0); // force remount of gate cards

  const level = data?.levels[levelIdx];
  const totalSteps = 5; // 3 gates + matching + boss

  const stepForPhase = useCallback(() => {
    if (phase === "gate") return gateIdx;
    if (phase === "matching") return 3;
    if (phase === "boss") return 4;
    if (phase === "level_done" || phase === "victory") return 5;
    return 0;
  }, [phase, gateIdx]);

  useEffect(() => {
    stageRef.current?.advance(stepForPhase(), totalSteps);
  }, [stepForPhase]);

  function handleAnswer(correct: boolean, points: number, isBoss = false) {
    if (correct) {
      setScore((s) => s + points);
      stageRef.current?.celebrate();
      if (isBoss) {
        if (level) setMastered((m) => Array.from(new Set([...m, level.concept_name])));
        if (data && levelIdx + 1 < data.levels.length) {
          setPhase("level_done");
        } else {
          setPhase("victory");
          stageRef.current?.victory();
        }
      } else if (gateIdx < 2) {
        setGateIdx((g) => g + 1);
        setGateKey((k) => k + 1);
      } else {
        setPhase("matching");
      }
    } else {
      stageRef.current?.hurt();
      const newLives = lives - 1;
      setLives(newLives);
      if (newLives <= 0) {
        setPhase("game_over");
      } else if (isBoss) {
        setGateKey((k) => k + 1); // retry boss with a fresh card
      } else if (gateIdx < 2) {
        setGateIdx((g) => g + 1);
        setGateKey((k) => k + 1);
      } else {
        setPhase("matching");
      }
    }
  }

  function restart() {
    setLevelIdx(0);
    setPhase("intro");
    setGateIdx(0);
    setScore(0);
    setLives(3);
    setMastered([]);
    setGateKey((k) => k + 1);
  }

  function nextLevel() {
    setLevelIdx((i) => i + 1);
    setPhase("intro");
    setGateIdx(0);
    setGateKey((k) => k + 1);
  }

  return (
    <TabShell
      title="Concept Quest"
      description="Your document becomes a game: clear quiz gates, solve the matching puzzle, and beat the boss question to master each concept."
      emoji="🎮"
      hasData={Boolean(data && data.levels.length > 0)}
      state={state}
      onGenerate={onGenerate}
      generateLabel="Build my Game"
      loadingLabel="Building your quest (levels, quizzes, bosses)…"
    >
      {data && level && (
        <div className="mx-auto max-w-3xl">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md">
            {/* Stage: remount per level so the background swaps */}
            <div key={levelIdx}>
              <PhaserStage backgroundUrl={level.background_url} onReady={(api) => (stageRef.current = api)} />
            </div>

            {/* HUD */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3 text-sm">
              <span className="font-bold text-violet-700">{data.game_title}</span>
              <div className="flex items-center gap-4">
                <span className="font-semibold">⭐ {score}</span>
                <span>{"❤️".repeat(Math.max(0, lives))}{"🖤".repeat(Math.max(0, 3 - lives))}</span>
                <span className="text-slate-400">
                  Level {levelIdx + 1}/{data.levels.length}
                </span>
              </div>
            </div>

            <div className="p-6">
              {phase === "intro" && (
                <div className="text-center">
                  <h3 className="text-lg font-bold">{level.title}</h3>
                  <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-600">{level.concept_explanation}</p>
                  {levelIdx === 0 && <p className="mx-auto mt-2 max-w-lg text-xs text-slate-400">{data.intro_text}</p>}
                  <button
                    onClick={() => setPhase("gate")}
                    className="mt-5 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3 font-semibold text-white shadow-lg transition hover:opacity-95"
                  >
                    ⚔️ Start level
                  </button>
                </div>
              )}

              {phase === "gate" && (
                <QuizGateCard
                  key={`gate-${levelIdx}-${gateIdx}-${gateKey}`}
                  gate={level.quiz_gates[gateIdx]}
                  label={`🚪 Quiz gate ${gateIdx + 1} of 3`}
                  onResult={(c) => handleAnswer(c, 10)}
                />
              )}

              {phase === "matching" && (
                <MatchingPuzzle
                  key={`match-${levelIdx}`}
                  level={level}
                  onDone={(mistakes) => {
                    setScore((s) => s + Math.max(5, 20 - mistakes * 5));
                    stageRef.current?.celebrate();
                    setPhase("boss");
                  }}
                />
              )}

              {phase === "boss" && (
                <div>
                  <p className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-center text-sm font-bold text-rose-600">
                    👑 BOSS BATTLE — answer wrong and lose a life!
                  </p>
                  <QuizGateCard
                    key={`boss-${levelIdx}-${gateKey}`}
                    gate={level.boss_question}
                    label="👑 Final boss"
                    onResult={(c) => handleAnswer(c, 30, true)}
                  />
                </div>
              )}

              {phase === "level_done" && (
                <div className="text-center">
                  <div className="text-5xl">🏆</div>
                  <h3 className="mt-2 text-lg font-bold">Concept mastered: {level.concept_name}!</h3>
                  <p className="mt-1 text-sm text-slate-500">The fog lifts a little more…</p>
                  <button
                    onClick={nextLevel}
                    className="mt-4 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3 font-semibold text-white shadow-lg transition hover:opacity-95"
                  >
                    Next level →
                  </button>
                </div>
              )}

              {phase === "victory" && (
                <div className="text-center">
                  <div className="text-6xl">👑🎉</div>
                  <h3 className="mt-2 text-xl font-bold">Quest complete!</h3>
                  <p className="mt-1 text-slate-500">
                    Final score <span className="font-bold text-violet-700">⭐ {score}</span> with {lives} {lives === 1 ? "life" : "lives"} left.
                  </p>
                  <div className="mx-auto mt-3 flex max-w-md flex-wrap justify-center gap-1.5">
                    {mastered.map((m) => (
                      <span key={m} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                        ✓ {m}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={restart}
                    className="mt-5 rounded-2xl border-2 border-violet-300 px-8 py-3 font-semibold text-violet-700 transition hover:bg-violet-50"
                  >
                    ↻ Play again
                  </button>
                </div>
              )}

              {phase === "game_over" && (
                <div className="text-center">
                  <div className="text-5xl">💀</div>
                  <h3 className="mt-2 text-lg font-bold">Out of lives!</h3>
                  <p className="mt-1 text-sm text-slate-500">Score: ⭐ {score}. Review the blueprint and try again — you've got this.</p>
                  <button
                    onClick={restart}
                    className="mt-4 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3 font-semibold text-white shadow-lg transition hover:opacity-95"
                  >
                    ↻ Try again
                  </button>
                </div>
              )}
            </div>
          </div>

          {mastered.length > 0 && phase !== "victory" && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              Mastered:
              {mastered.map((m) => (
                <span key={m} className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-semibold text-emerald-700">
                  ✓ {m}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </TabShell>
  );
}
