import { mockGameSpec } from "@/lib/mocks";
import { SEED_LESSONS } from "@/lib/seedData";
import { TranscriptEntry } from "@/lib/gameEngine";
import { GameSpecData } from "@/lib/types";

// Synthetic Concept Quest games and answer transcripts for tests (no AI keys).

/** The built-in mock game for a seed lesson: 3 levels x (3 gates, 4 pairs, boss). */
export const mockGame = (seedIndex = 0): GameSpecData => mockGameSpec(SEED_LESSONS[seedIndex].blueprint);

/** A "regenerated" version: same shape, different first question and answer key. */
export function regeneratedGame(base: GameSpecData, tag = "v2"): GameSpecData {
  const g = structuredClone(base);
  g.game_title = `${g.game_title} (${tag})`;
  const q = g.levels[0].quiz_gates[0];
  q.question = `[${tag}] ${q.question}`;
  q.correct_index = (q.correct_index + 1) % q.options.length;
  q.explanation = `[${tag}] ${q.explanation}`;
  return g;
}

export interface LevelPlan {
  gates?: boolean[]; // per quiz gate: answer correctly? (default all correct)
  misses?: number; // wrong matching picks before solving (default 0)
  bossWrong?: number; // wrong boss answers before the right one (default 0)
}

/**
 * Build the transcript the game screen would record for a plan of play.
 * Stops as soon as the lives run out (game over), like the game does.
 */
export function transcriptFor(spec: GameSpecData, plan: LevelPlan[] = []): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  let lives = 3;
  for (let level = 0; level < spec.levels.length; level++) {
    const l = spec.levels[level];
    const p = plan[level] ?? {};
    for (let gate = 0; gate < 3; gate++) {
      const q = l.quiz_gates[gate];
      const correct = p.gates?.[gate] ?? true;
      out.push({ k: "gate", level, gate, choice: correct ? q.correct_index : (q.correct_index + 1) % q.options.length });
      if (!correct && --lives <= 0) return out;
    }
    for (let m = 0; m < (p.misses ?? 0); m++) out.push({ k: "match", level, term: 0, match: 1 });
    l.matching_pairs.forEach((_, t) => out.push({ k: "match", level, term: t, match: t }));
    const b = l.boss_question;
    for (let t = 0; t < (p.bossWrong ?? 0); t++) {
      out.push({ k: "boss", level, try: t, choice: (b.correct_index + 1) % b.options.length });
      if (--lives <= 0) return out;
    }
    out.push({ k: "boss", level, try: p.bossWrong ?? 0, choice: b.correct_index });
  }
  return out;
}

/** The game-over run reproduced in the browser before this feature: 1 right, 2 wrong, clean matching, boss wrong -> 30. */
export const reproducedLossPlan: LevelPlan[] = [{ gates: [true, false, false], bossWrong: 1 }];
