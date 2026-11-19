import { describe, expect, it } from "vitest";
import {
  MAX_TRANSCRIPT_ENTRIES,
  TranscriptEntry,
  addPendingFinish,
  applyEntry,
  checkPlayable,
  gameVersionKey,
  initialGameState,
  isGameVersionKey,
  parsePendingFinishes,
  parseTranscript,
  replayTranscript,
  startNextLevel,
} from "@/lib/gameEngine";
import { GameSpecData } from "@/lib/types";
import { mockGame, regeneratedGame, reproducedLossPlan, transcriptFor } from "./gameFixtures";

const game = mockGame();

function replayOk(spec: GameSpecData, t: unknown) {
  const r = replayTranscript(spec, t);
  if (!r.ok) throw new Error(r.error);
  return r.result;
}
function replayErr(spec: GameSpecData, t: unknown) {
  const r = replayTranscript(spec, t);
  if (r.ok) throw new Error("expected the transcript to be rejected");
  return r.error;
}

describe("scoring rules (unchanged from the original game)", () => {
  it("a perfect game: 3 levels x (3x10 + 20 + 30) = 240 with 3 lives (matches the pre-change browser run)", () => {
    const r = replayOk(game, transcriptFor(game));
    expect(r).toMatchObject({ outcome: "victory", score: 240, lives_left: 3, levels_total: 3, levels_cleared: 3 });
    expect(r.mastered).toEqual(game.levels.map((l) => l.concept_name));
    expect(r.review).toHaveLength(15); // per level: 3 gates + matching + boss
  });

  it("the game-over run reproduced before the change scores 30 with 0 lives", () => {
    const r = replayOk(game, transcriptFor(game, reproducedLossPlan));
    expect(r).toMatchObject({ outcome: "game_over", score: 30, lives_left: 0, levels_cleared: 0, mastered: [] });
  });

  it.each([
    [0, 20],
    [1, 15],
    [2, 10],
    [3, 5],
    [10, 5],
  ])("matching with %i misses scores %i and never costs a life", (misses, points) => {
    const r = replayOk(game, transcriptFor(game, [{ misses }]));
    const m = r.review.find((x) => x.kind === "matching" && x.level === 0)!;
    expect(m).toMatchObject({ mistakes: misses, points });
    expect(r.score).toBe(240 - 20 + points);
    expect(r.lives_left).toBe(3);
  });

  it("a wrong quiz gate costs a life, scores 0 and moves on to the next step", () => {
    const r = replayOk(game, transcriptFor(game, [{ gates: [false, true, false] }]));
    expect(r).toMatchObject({ outcome: "victory", score: 240 - 20, lives_left: 1 });
    const gates = r.review.filter((x) => x.kind === "gate" && x.level === 0);
    expect(gates.map((g) => (g.kind === "gate" ? [g.correct, g.points, g.lives_after] : null))).toEqual([
      [false, 0, 2],
      [true, 10, 2],
      [false, 0, 1],
    ]);
  });

  it("a wrong boss answer costs a life and the boss is asked again", () => {
    const r = replayOk(game, transcriptFor(game, [{ bossWrong: 2 }]));
    expect(r).toMatchObject({ outcome: "victory", score: 240, lives_left: 1 });
    const boss = r.review.filter((x) => x.kind === "boss" && x.level === 0);
    expect(boss.map((b) => (b.kind === "boss" ? [b.index, b.correct] : null))).toEqual([
      [0, false],
      [1, false],
      [2, true],
    ]);
  });

  it("losing the last life on a quiz gate ends the game there (no matching or boss)", () => {
    const r = replayOk(game, transcriptFor(game, [{}, { gates: [false, false, false] }]));
    expect(r).toMatchObject({ outcome: "game_over", score: 80, lives_left: 0, levels_cleared: 1 });
    expect(r.review.filter((x) => x.level === 1).map((x) => x.kind)).toEqual(["gate", "gate", "gate"]);
  });

  it("the review keeps the questions, options, chosen and correct answers and explanations", () => {
    const r = replayOk(game, transcriptFor(game, [{ gates: [true, false, true] }]));
    const g = r.review[1];
    const q = game.levels[0].quiz_gates[1];
    expect(g).toEqual({
      kind: "gate", level: 0, index: 1, question: q.question, options: q.options, choice: (q.correct_index + 1) % q.options.length,
      correct_index: q.correct_index, correct: false, explanation: q.explanation, points: 0, lives_after: 2,
    });
  });
});

// The original GameTab logic, transcribed as a reference model (handleAnswer +
// the matching onDone), to check the shared engine against it on many random games.
function legacyPlay(spec: GameSpecData, plan: { gates: boolean[]; misses: number; boss: boolean[] }[]) {
  let levelIdx = 0, gateIdx = 0, score = 0, lives = 3;
  let phase: string = "gate";
  const mastered: string[] = [];
  const level = () => spec.levels[levelIdx];
  function handleAnswer(correct: boolean, points: number, isBoss = false) {
    if (correct) {
      score += points;
      if (isBoss) {
        if (!mastered.includes(level().concept_name)) mastered.push(level().concept_name);
        if (levelIdx + 1 < spec.levels.length) phase = "level_done";
        else phase = "victory";
      } else if (gateIdx < 2) gateIdx++;
      else phase = "matching";
    } else {
      lives = lives - 1;
      if (lives <= 0) phase = "game_over";
      else if (isBoss) { /* retry boss */ }
      else if (gateIdx < 2) gateIdx++;
      else phase = "matching";
    }
  }
  for (const p of plan) {
    gateIdx = 0;
    phase = "gate";
    for (let g = 0; g < 3 && phase === "gate"; g++) handleAnswer(p.gates[g], 10);
    if (phase !== "matching") break;
    score += Math.max(5, 20 - p.misses * 5);
    phase = "boss";
    let t = 0;
    while (phase === "boss") handleAnswer(p.boss[t++] ?? true, 30, true);
    if (phase !== "level_done") break;
    levelIdx++;
  }
  return { score, lives: Math.max(0, lives), phase, mastered };
}

describe("the shared engine matches the original game logic", () => {
  it("on 500 random games (random right/wrong answers, misses, boss retries)", () => {
    const outcomes = { victory: 0, game_over: 0 };
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 500; n++) {
      const plan = game.levels.map(() => ({ gates: [rand() < 0.7, rand() < 0.7, rand() < 0.7], misses: Math.floor(rand() * 5), boss: [rand() < 0.6, rand() < 0.6, true] }));
      const expected = legacyPlay(game, plan);
      const transcript = transcriptFor(
        game,
        plan.map((p) => ({ gates: p.gates, misses: p.misses, bossWrong: p.boss.findIndex((b) => b) }))
      );
      const r = replayOk(game, transcript);
      expect({ score: r.score, lives: r.lives_left, outcome: r.outcome, mastered: r.mastered }).toEqual({
        score: expected.score, lives: expected.lives, outcome: expected.phase, mastered: expected.mastered,
      });
      outcomes[r.outcome]++;
    }
    // Both endings are well represented.
    expect(outcomes.victory).toBeGreaterThan(25);
    expect(outcomes.game_over).toBeGreaterThan(25);
  });
});

describe("illegal or forged transcripts are rejected", () => {
  const win = transcriptFor(game);

  it("a duplicated answer (double submit) is not counted twice", () => {
    const t = [win[0], win[0], ...win.slice(1)];
    expect(replayErr(game, t)).toMatch(/answer 2: expected quiz gate 2/);
    // Applying the same entry twice to live state: the second one is refused.
    const s1 = applyEntry(game, initialGameState(), win[0]);
    expect(s1.ok).toBe(true);
    expect(applyEntry(game, (s1 as { state: ReturnType<typeof initialGameState> }).state, win[0]).ok).toBe(false);
  });

  it("skipped, reordered or wrong-level steps", () => {
    expect(replayErr(game, win.slice(1))).toMatch(/answer 1: expected quiz gate 1/);
    expect(replayErr(game, [win[1], win[0], ...win.slice(2)])).toMatch(/answer 1/);
    expect(replayErr(game, [{ k: "gate", level: 1, gate: 0, choice: 0 }])).toMatch(/expected an answer for level 1/);
    expect(replayErr(game, [...win.slice(0, 3), { k: "boss", level: 0, try: 0, choice: 1 }])).toMatch(/expected the matching puzzle/);
  });

  it("a game that isn't finished, or answers after it ended", () => {
    expect(replayErr(game, win.slice(0, -1))).toMatch(/isn't finished/);
    const lost = transcriptFor(game, reproducedLossPlan);
    expect(replayErr(game, [...lost, { k: "boss", level: 0, try: 1, choice: 1 }])).toMatch(/already over/);
    expect(replayErr(game, [...win, win[0]])).toMatch(/already over/);
  });

  it("out-of-range choices and impossible matching picks", () => {
    expect(replayErr(game, [{ k: "gate", level: 0, gate: 0, choice: 4 }])).toMatch(/out of range/);
    const toMatching = win.slice(0, 3);
    expect(replayErr(game, [...toMatching, { k: "match", level: 0, term: 9, match: 0 }])).toMatch(/out of range/);
    expect(replayErr(game, [...toMatching, { k: "match", level: 0, term: 0, match: 0 }, { k: "match", level: 0, term: 0, match: 0 }])).toMatch(/already matched/);
    expect(replayErr(game, [...toMatching, { k: "match", level: 0, term: 0, match: 0 }, { k: "match", level: 0, term: 1, match: 0 }])).toMatch(/meaning is already matched/);
    const boss = win.findIndex((e) => e.k === "boss");
    expect(replayErr(game, [...win.slice(0, boss), { k: "boss", level: 0, try: 1, choice: 1 }])).toMatch(/expected boss try 1/);
  });

  it("malformed entries: wrong types, extra fields, negative or fractional numbers, unknown kinds", () => {
    expect(parseTranscript("nope").ok).toBe(false);
    expect(parseTranscript([]).ok).toBe(false);
    expect(parseTranscript([{ k: "gate", level: 0, gate: 0, choice: "1" }]).ok).toBe(false);
    expect(parseTranscript([{ k: "gate", level: 0, gate: 0, choice: 1.5 }]).ok).toBe(false);
    expect(parseTranscript([{ k: "gate", level: 0, gate: -1, choice: 0 }]).ok).toBe(false);
    expect(parseTranscript([{ k: "gate", level: 0, gate: 0, choice: 0, points: 1000 }]).ok).toBe(false);
    expect(parseTranscript([{ k: "gate", level: 0, gate: 0 }]).ok).toBe(false);
    expect(parseTranscript([{ k: "bonus", level: 0 }]).ok).toBe(false);
    expect(parseTranscript([null]).ok).toBe(false);
    expect(parseTranscript(new Array(MAX_TRANSCRIPT_ENTRIES + 1).fill(win[0])).ok).toBe(false);
  });

  it("a transcript from a different game version doesn't fit (the answer key differs)", () => {
    const v2 = regeneratedGame(game);
    const r = replayOk(v2, win); // legal sequence on v2, but the first answer is now wrong
    expect(r.score).toBe(230);
    expect(r.lives_left).toBe(2);
  });
});

describe("playable games", () => {
  it("generated mock games are playable", () => {
    expect(checkPlayable(game)).toEqual({ ok: true });
  });

  it("a level with only 2 quiz questions is refused with a clear reason (it used to crash the game)", () => {
    const bad = structuredClone(game);
    bad.levels[1].quiz_gates = bad.levels[1].quiz_gates.slice(0, 2);
    expect(checkPlayable(bad)).toEqual({ ok: false, reason: "Level 2 has 2 quiz questions; the game needs 3." });
    expect(replayErr(bad, transcriptFor(game))).toMatch(/can't be scored: Level 2 has 2 quiz questions/);
  });

  it("a level with 4 quiz questions plays its first 3, as before", () => {
    const extra = structuredClone(game);
    extra.levels[0].quiz_gates.push({ ...extra.levels[0].quiz_gates[0], question: "Fourth" });
    expect(checkPlayable(extra).ok).toBe(true);
    expect(replayOk(extra, transcriptFor(extra)).score).toBe(240);
    const withFourth = [...transcriptFor(extra).slice(0, 3), { k: "gate", level: 0, gate: 3, choice: 0 } as TranscriptEntry];
    expect(replayErr(extra, withFourth)).toMatch(/expected the matching puzzle/);
  });

  it.each([
    ["no levels", (g: GameSpecData) => { g.levels = []; }, /no levels/],
    ["missing boss", (g: GameSpecData) => { delete (g.levels[0] as Partial<GameSpecData["levels"][0]>).boss_question; }, /boss question/],
    ["answer key out of range", (g: GameSpecData) => { g.levels[2].quiz_gates[0].correct_index = 7; }, /Level 3, quiz question 1, has no valid correct answer/],
    ["one option", (g: GameSpecData) => { g.levels[0].boss_question.options = ["only"]; }, /at least 2 answer options/],
    ["no matching pairs", (g: GameSpecData) => { g.levels[0].matching_pairs = []; }, /no matching pairs/],
    ["duplicate term", (g: GameSpecData) => { g.levels[0].matching_pairs[1].term = g.levels[0].matching_pairs[0].term; }, /repeats a term/],
  ])("refuses a game with %s", (_name, mutate, reason) => {
    const g = structuredClone(game);
    mutate(g);
    const r = checkPlayable(g);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(reason);
  });
});

describe("game version identity", () => {
  it("is stable, file-name safe and ignores background images", () => {
    const v = gameVersionKey(game);
    expect(isGameVersionKey(v)).toBe(true);
    expect(gameVersionKey(structuredClone(game))).toBe(v);
    const newImages = structuredClone(game);
    newImages.levels.forEach((l, i) => { l.background_url = `/x/${i}.png`; l.background_prompt = "different"; });
    expect(gameVersionKey(newImages)).toBe(v);
  });

  it("changes when a question, answer key, explanation or pair changes", () => {
    const v = gameVersionKey(game);
    const variants: ((g: GameSpecData) => void)[] = [
      (g) => { g.levels[0].quiz_gates[0].question += "?"; },
      (g) => { g.levels[0].quiz_gates[0].correct_index = 3; },
      (g) => { g.levels[2].boss_question.explanation += "."; },
      (g) => { g.levels[1].matching_pairs[0].match += "!"; },
      (g) => { g.levels.pop(); },
    ];
    const keys = variants.map((m) => { const g = structuredClone(game); m(g); return gameVersionKey(g); });
    keys.forEach((k) => expect(k).not.toBe(v));
    expect(new Set(keys).size).toBe(keys.length);
    expect(gameVersionKey(regeneratedGame(game))).not.toBe(v);
  });
});

describe("unconfirmed finished results kept in the browser", () => {
  const t = transcriptFor(game);
  const p = { attempt_id: "0b6cf7a2-8a0e-4d5e-9a51-2a7f7f0f9c11", transcript: t, finished_at: "2024-01-01T00:00:00.000Z" };

  it("parses valid entries and drops malformed ones", () => {
    expect(parsePendingFinishes(JSON.stringify([p]))).toEqual([p]);
    expect(parsePendingFinishes(null)).toEqual([]);
    expect(parsePendingFinishes("{bad json")).toEqual([]);
    expect(parsePendingFinishes(JSON.stringify({ not: "a list" }))).toEqual([]);
    expect(parsePendingFinishes(JSON.stringify([p, { ...p, attempt_id: "nope" }, { ...p, transcript: "x" }]))).toEqual([p]);
  });

  it("keeps one entry per attempt id (the same attempt is re-sent, never duplicated)", () => {
    expect(addPendingFinish(addPendingFinish([], p), { ...p, finished_at: "later" })).toEqual([p]);
  });

  it("startNextLevel only leaves the level-done screen", () => {
    const s = initialGameState();
    expect(startNextLevel(s)).toBe(s);
  });
});
