import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Regeneration goes through the real generate route; the (mock) game generator
// returns a synthetic new version while `regen.tag` is set.
const regen = vi.hoisted(() => ({ tag: null as string | null }));
vi.mock("@/lib/generators", async (orig) => {
  const real = await orig<typeof import("@/lib/generators")>();
  const { regeneratedGame } = await import("./gameFixtures");
  return {
    ...real,
    generateGameSpec: async (bp: Parameters<typeof real.generateGameSpec>[0]) => {
      const g = await real.generateGameSpec(bp);
      return regen.tag ? regeneratedGame(g, regen.tag) : g;
    },
  };
});

import * as attemptsRoute from "@/app/api/lessons/[id]/game/attempts/route";
import * as attemptRoute from "@/app/api/lessons/[id]/game/attempts/[attemptId]/route";
import * as finishRoute from "@/app/api/lessons/[id]/game/attempts/[attemptId]/finish/route";
import * as eventsRoute from "@/app/api/events/route";
import * as progressRoute from "@/app/api/lessons/[id]/progress/route";
import * as completeRoute from "@/app/api/lessons/[id]/progress/complete/route";
import * as generateRoute from "@/app/api/projects/[id]/generate/route";
import * as lessonRoute from "@/app/api/classrooms/[id]/lessons/[lessonId]/route";
import { getEvents } from "@/lib/db";
import { getProject, saveProject } from "@/lib/store";
import { buildClassroomAnalytics } from "@/lib/platform";
import { flashcardDeckKey } from "@/lib/progressShared";
import { gameVersionKey, TranscriptEntry } from "@/lib/gameEngine";
import type { AttemptDetail, AttemptSummary, GameResultsSummary } from "@/lib/gameResults";
import { GameSpecData, LessonProgress, Project } from "@/lib/types";
import { seedFixture, useTempDataDir } from "./fixtures";
import { mockGame, regeneratedGame, reproducedLossPlan, transcriptFor } from "./gameFixtures";

const data = useTempDataDir();
const U = "http://localhost";
const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`${U}${url}`, { method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } });

async function results(lessonId: string, studentId: string) {
  const res = await attemptsRoute.GET(req(`/api/lessons/${lessonId}/game/attempts?student_id=${studentId}`, "GET"), { params: { id: lessonId } });
  return { status: res.status, body: (await res.json()) as GameResultsSummary & { error?: string; code?: string } };
}
async function start(lessonId: string, studentId: string, version: unknown, attemptId: string = randomUUID()) {
  const res = await attemptsRoute.POST(req(`/api/lessons/${lessonId}/game/attempts`, "POST", { student_id: studentId, attempt_id: attemptId, version }), { params: { id: lessonId } });
  return { status: res.status, id: attemptId, body: (await res.json()) as { attempt: { id: string; version: string; status: string }; created: boolean; error?: string; code?: string } };
}
async function finish(lessonId: string, studentId: string, attemptId: string, transcript: unknown, extra: Record<string, unknown> = {}) {
  const res = await finishRoute.POST(req(`/api/lessons/${lessonId}/game/attempts/${attemptId}/finish`, "POST", { student_id: studentId, transcript, ...extra }), {
    params: { id: lessonId, attemptId },
  });
  return { status: res.status, body: (await res.json()) as { attempt: AttemptSummary; duplicate: boolean; completed: string[]; error?: string; code?: string } };
}
async function detail(lessonId: string, studentId: string, attemptId: string) {
  const res = await attemptRoute.GET(req(`/api/lessons/${lessonId}/game/attempts/${attemptId}?student_id=${studentId}`, "GET"), { params: { id: lessonId, attemptId } });
  return { status: res.status, body: (await res.json()) as { attempt: AttemptDetail; error?: string; code?: string } };
}
async function progress(lessonId: string, studentId: string) {
  const res = await progressRoute.GET(req(`/api/lessons/${lessonId}/progress?student_id=${studentId}`, "GET"), { params: { id: lessonId } });
  return ((await res.json()) as { progress: LessonProgress }).progress;
}
async function regenerate(lessonId: string, tag: string | null) {
  regen.tag = tag;
  try {
    const res = await generateRoute.POST(req(`/api/projects/${lessonId}/generate`, "POST", { type: "game", force: true }), { params: { id: lessonId } });
    expect(res.status).toBe(200);
  } finally {
    regen.tag = null;
  }
}
const patchLesson = (classroomId: string, lessonId: string, body: unknown) =>
  lessonRoute.PATCH(req(`/api/classrooms/${classroomId}/lessons/${lessonId}`, "PATCH", body), { params: { id: classroomId, lessonId } });

const gameEvents = () => getEvents().filter((e) => e.type === "game_result");
const gameCompletions = () => getEvents().filter((e) => e.type === "modality_complete" && e.modality === "game");
const attemptsPath = (studentId: string, lessonId: string) => path.join(data.dir(), "game-attempts", studentId, `${lessonId}.json`);
const readAttemptsFile = (studentId: string, lessonId: string) => JSON.parse(fs.readFileSync(attemptsPath(studentId, lessonId), "utf-8"));

function withGame(p: Project, game: GameSpecData): Project {
  const next = { ...p, outputs: { ...p.outputs, game } };
  saveProject(next);
  return next;
}

/** Synthetic class with a generated (mock) game on every lesson. */
function setup() {
  const f = seedFixture();
  const gameA = mockGame(0);
  const gameB = mockGame(1);
  withGame(f.lessonA, gameA);
  withGame(f.lessonB, gameB);
  withGame(f.lessonX, mockGame(0));
  return { ...f, gameA, gameB, vA: gameVersionKey(gameA), vB: gameVersionKey(gameB) };
}

async function play(lessonId: string, studentId: string, version: string, transcript: TranscriptEntry[]) {
  const s = await start(lessonId, studentId, version);
  expect(s.status).toBe(201);
  const r = await finish(lessonId, studentId, s.id, transcript);
  expect(r.status).toBe(200);
  return { id: s.id, ...r.body };
}

describe("finishing a game saves the result", () => {
  it("a victory is saved, survives a refresh, keeps its review, logs one event and completes the game format", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const s = await start(lessonA.id, ada.id, vA);
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ created: true, attempt: { id: s.id, version: vA, status: "in_progress" } });
    // Not finished yet: nothing counts.
    expect((await results(lessonA.id, ada.id)).body).toMatchObject({ finished_count: 0, latest: null, attempts: [] });

    const f = await finish(lessonA.id, ada.id, s.id, transcriptFor(gameA));
    expect(f.status).toBe(200);
    expect(f.body.attempt).toMatchObject({ id: s.id, outcome: "victory", score: 240, lives_left: 3, levels_cleared: 3, levels_total: 3, is_current_version: true });
    expect(f.body.duplicate).toBe(false);
    expect(f.body.completed).toContain("game");

    // "Refresh": brand-new requests answered from disk.
    const r = await results(lessonA.id, ada.id);
    expect(r.body).toMatchObject({ current_version: vA, playable: true, finished_count: 1, latest: { id: s.id, score: 240, outcome: "victory" } });
    expect(r.body.best_by_version).toEqual([expect.objectContaining({ version: vA, is_current: true, best_score: 240, finished_attempts: 1, victories: 1 })]);
    const d = await detail(lessonA.id, ada.id, s.id);
    expect(d.status).toBe(200);
    expect(d.body.attempt.review).toHaveLength(15);
    expect(d.body.attempt.review[0]).toMatchObject({ kind: "gate", question: gameA.levels[0].quiz_gates[0].question, explanation: gameA.levels[0].quiz_gates[0].explanation, correct: true });
    expect(d.body.attempt.game_title).toBe(gameA.game_title);

    expect(gameEvents()).toEqual([expect.objectContaining({ student_id: ada.id, lesson_id: lessonA.id, value: 240, text: "victory", modality: "game" })]);
    expect(gameCompletions()).toHaveLength(1);
    expect(Object.keys((await progress(lessonA.id, ada.id)).completed)).toEqual(["game"]);
  });

  it("a game over is a finished attempt but does not complete the game format", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const r = await play(lessonA.id, ada.id, vA, transcriptFor(gameA, reproducedLossPlan));
    expect(r.attempt).toMatchObject({ outcome: "game_over", score: 30, lives_left: 0, levels_cleared: 0 });
    expect(r.completed).not.toContain("game");
    const s = (await results(lessonA.id, ada.id)).body;
    expect(s).toMatchObject({ finished_count: 1, latest: { outcome: "game_over", score: 30 } });
    expect(s.best_by_version[0]).toMatchObject({ best_score: 30, victories: 0 });
    expect(gameEvents()).toEqual([expect.objectContaining({ value: 30, text: "game_over" })]);
    expect(gameCompletions()).toHaveLength(0);
    expect((await progress(lessonA.id, ada.id)).completed).toEqual({});
    expect(buildClassroomAnalytics("class-1").completions).toBe(0);
  });

  it("the score is derived from the answers: score/outcome sent by the browser are ignored", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const s = await start(lessonA.id, ada.id, vA);
    const f = await finish(lessonA.id, ada.id, s.id, transcriptFor(gameA, reproducedLossPlan), { score: 99999, outcome: "victory", lives_left: 3 });
    expect(f.status).toBe(200);
    expect(f.body.attempt).toMatchObject({ score: 30, outcome: "game_over", lives_left: 0 });
    expect(readAttemptsFile(ada.id, lessonA.id).attempts[0]).toMatchObject({ score: 30, outcome: "game_over" });
  });

  it("each new attempt is separate: latest is the newest, best is the highest, count includes wins and losses", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const a1 = await play(lessonA.id, ada.id, vA, transcriptFor(gameA, [{ misses: 2 }])); // 230
    const a2 = await play(lessonA.id, ada.id, vA, transcriptFor(gameA, reproducedLossPlan)); // 30
    const s = (await results(lessonA.id, ada.id)).body;
    expect(s.finished_count).toBe(2);
    expect(s.latest).toMatchObject({ id: a2.id, score: 30 });
    expect(s.attempts.map((a) => a.id)).toEqual([a2.id, a1.id]);
    expect(s.best_by_version).toEqual([expect.objectContaining({ best_score: 230, best_attempt_id: a1.id, finished_attempts: 2, victories: 1 })]);
    expect(gameEvents()).toHaveLength(2);
    expect(gameCompletions()).toHaveLength(1);
  });
});

describe("retries, double clicks and concurrent requests", () => {
  it("starting twice with the same attempt id (double click / retried request) creates one attempt", async () => {
    const { lessonA, ada, vA } = setup();
    const id = randomUUID();
    const [a, b] = await Promise.all([start(lessonA.id, ada.id, vA, id), start(lessonA.id, ada.id, vA, id)]);
    const c = await start(lessonA.id, ada.id, vA, id);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(c.status).toBe(200);
    expect(c.body.created).toBe(false);
    expect(readAttemptsFile(ada.id, lessonA.id).attempts).toHaveLength(1);
  });

  it("10 simultaneous finishes of the same attempt: one result, one event, one completion", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const s = await start(lessonA.id, ada.id, vA);
    const t = transcriptFor(gameA);
    const all = await Promise.all(Array.from({ length: 10 }, () => finish(lessonA.id, ada.id, s.id, t)));
    expect(all.every((r) => r.status === 200 && r.body.attempt.score === 240)).toBe(true);
    expect(all.filter((r) => !r.body.duplicate)).toHaveLength(1);
    expect(readAttemptsFile(ada.id, lessonA.id).attempts).toHaveLength(1);
    expect(gameEvents()).toHaveLength(1);
    expect(gameCompletions()).toHaveLength(1);
    const a = buildClassroomAnalytics("class-1");
    expect(a.modality_opens.find((m) => m.modality === "game")!.completions).toBe(1);
    expect(a.completions).toBe(1);
    expect((await results(lessonA.id, ada.id)).body.finished_count).toBe(1);
  });

  it("a later retry returns the stored result; different answers for a finished attempt are refused", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const s = await start(lessonA.id, ada.id, vA);
    await finish(lessonA.id, ada.id, s.id, transcriptFor(gameA, reproducedLossPlan));
    const again = await finish(lessonA.id, ada.id, s.id, transcriptFor(gameA, reproducedLossPlan));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, attempt: { score: 30 } });
    const better = await finish(lessonA.id, ada.id, s.id, transcriptFor(gameA));
    expect(better.status).toBe(409);
    expect(better.body.code).toBe("already_finished");
    expect((await results(lessonA.id, ada.id)).body.latest).toMatchObject({ score: 30, outcome: "game_over" });
    expect(gameEvents()).toHaveLength(1);
  });

  it("'I got this' and a saved victory together still count the game format once", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    await completeRoute.POST(req(`/api/lessons/${lessonA.id}/progress/complete`, "POST", { student_id: ada.id, modality: "game" }), { params: { id: lessonA.id } });
    await play(lessonA.id, ada.id, vA, transcriptFor(gameA));
    await play(lessonA.id, ada.id, vA, transcriptFor(gameA));
    expect(gameCompletions()).toHaveLength(1);
    expect(buildClassroomAnalytics("class-1").completions).toBe(1);
  });
});

describe("interrupted attempts", () => {
  it("are never counted: not in finished count, latest result or best score", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const abandoned = await start(lessonA.id, ada.id, vA); // e.g. refreshed mid-game
    expect((await results(lessonA.id, ada.id)).body).toMatchObject({ finished_count: 0, latest: null, best_by_version: [] });
    const next = await play(lessonA.id, ada.id, vA, transcriptFor(gameA, reproducedLossPlan));
    const s = (await results(lessonA.id, ada.id)).body;
    expect(s).toMatchObject({ finished_count: 1, latest: { id: next.id } });
    expect(s.attempts.map((a) => a.id)).toEqual([next.id]);
    expect(readAttemptsFile(ada.id, lessonA.id).attempts.find((a: { id: string }) => a.id === abandoned.id)).toMatchObject({ status: "interrupted" });
    expect((await detail(lessonA.id, ada.id, abandoned.id)).status).toBe(404);
  });

  it("an unconfirmed finished result can still be saved later with its attempt id (retry after a refresh)", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const first = await start(lessonA.id, ada.id, vA); // played to the end, but the save failed
    await play(lessonA.id, ada.id, vA, transcriptFor(gameA, reproducedLossPlan)); // a new attempt meanwhile
    const late = await finish(lessonA.id, ada.id, first.id, transcriptFor(gameA));
    expect(late.status).toBe(200);
    expect(late.body.attempt).toMatchObject({ id: first.id, score: 240 });
    expect((await results(lessonA.id, ada.id)).body.finished_count).toBe(2);
  });
});

describe("forged or illegal submissions are rejected and change nothing", () => {
  it("illegal, incomplete and malformed transcripts", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const s = await start(lessonA.id, ada.id, vA);
    const win = transcriptFor(gameA);
    const cases: [unknown, RegExp][] = [
      [win.slice(0, -1), /isn't finished/],
      [[win[0], win[0], ...win.slice(1)], /answer 2/],
      [[...win, win[0]], /already over/],
      [[{ ...win[0], choice: 99 }, ...win.slice(1)], /out of range/],
      [[{ ...win[0], bonus: 1000 }], /exactly/],
      ["240", /array/],
      [undefined, /array/],
    ];
    for (const [t, msg] of cases) {
      const r = await finish(lessonA.id, ada.id, s.id, t);
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("invalid_transcript");
      expect(r.body.error).toMatch(msg);
    }
    expect(readAttemptsFile(ada.id, lessonA.id).attempts[0].status).toBe("in_progress");
    expect(gameEvents()).toHaveLength(0);
    expect((await results(lessonA.id, ada.id)).body.finished_count).toBe(0);
  });

  it("attempts that were never started, bad ids and bad bodies", async () => {
    const { lessonA, ada, gameA } = setup();
    expect((await finish(lessonA.id, ada.id, randomUUID(), transcriptFor(gameA))).status).toBe(404);
    expect((await finish(lessonA.id, ada.id, "not-a-uuid", transcriptFor(gameA))).body.code).toBe("invalid_attempt_id");
    const badJson = await finishRoute.POST(req(`/api/lessons/${lessonA.id}/game/attempts/${randomUUID()}/finish`, "POST", "{oops"), { params: { id: lessonA.id, attemptId: randomUUID() } });
    expect(badJson.status).toBe(400);
    const huge = await finishRoute.POST(req(`/api/lessons/${lessonA.id}/game/attempts/x/finish`, "POST", { student_id: ada.id, transcript: "x".repeat(300 * 1024) }), { params: { id: lessonA.id, attemptId: randomUUID() } });
    expect(huge.status).toBe(413);
    expect(gameEvents()).toHaveLength(0);
    expect(fs.existsSync(attemptsPath(ada.id, lessonA.id))).toBe(false);
  });

  it("one student can't finish or read another student's attempt", async () => {
    const { lessonA, ada, ben, gameA, vA } = setup();
    const s = await start(lessonA.id, ada.id, vA);
    const forged = await finish(lessonA.id, ben.id, s.id, transcriptFor(gameA));
    expect(forged.status).toBe(404);
    expect(readAttemptsFile(ada.id, lessonA.id).attempts[0].status).toBe("in_progress");
    await finish(lessonA.id, ada.id, s.id, transcriptFor(gameA));
    expect((await detail(lessonA.id, ben.id, s.id)).status).toBe(404);
    expect((await results(lessonA.id, ben.id)).body).toMatchObject({ finished_count: 0, latest: null });
  });

  it("direct game_result logging through /api/events is refused and nothing is logged", async () => {
    const { classroom, lessonA, ada } = setup();
    const r = await eventsRoute.POST(req("/api/events", "POST", { classroom_id: classroom.id, student_id: ada.id, student_name: ada.name, lesson_id: lessonA.id, type: "game_result", value: 999999 }));
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("game_result_not_accepted");
    const r2 = await eventsRoute.POST(req("/api/events", "POST", { classroom_id: "other", student_id: "student-ghost", type: "game_result", value: -5 }));
    expect(r2.status).toBe(403);
    expect(gameEvents()).toHaveLength(0);
    // Other activity events are unchanged.
    const ok = await eventsRoute.POST(req("/api/events", "POST", { classroom_id: classroom.id, student_id: ada.id, student_name: ada.name, lesson_id: lessonA.id, type: "lesson_open" }));
    expect(ok.status).toBe(200);
  });
});

describe("students, lessons and classrooms are kept separate", () => {
  it("results are per student and per lesson; outsiders and unknown students are refused", async () => {
    const { lessonA, lessonB, lessonX, ada, ben, outsider, gameA, vA, vB } = setup();
    await play(lessonA.id, ada.id, vA, transcriptFor(gameA));
    expect((await results(lessonB.id, ada.id)).body).toMatchObject({ current_version: vB, finished_count: 0 });
    expect((await results(lessonA.id, ben.id)).body.finished_count).toBe(0);

    const outsiderStart = await start(lessonA.id, outsider.id, vA);
    expect(outsiderStart.status).toBe(403);
    expect((await results(lessonA.id, outsider.id)).status).toBe(403);
    expect((await start(lessonX.id, ada.id, vA)).status).toBe(403); // lesson of another classroom
    expect((await start(lessonA.id, "student-ghost", vA)).status).toBe(404);
    expect((await start("lesson-missing", ada.id, vA)).status).toBe(404);
    expect((await start(lessonA.id, ada.id, vB)).body.code).toBe("game_changed"); // another lesson's version
    expect(fs.existsSync(attemptsPath(outsider.id, lessonA.id))).toBe(false);
  });

  it("reading results never writes anything", async () => {
    const { lessonA, ada } = setup();
    await results(lessonA.id, ada.id);
    expect(fs.existsSync(path.join(data.dir(), "game-attempts"))).toBe(false);
    expect(fs.existsSync(path.join(data.dir(), "game-versions"))).toBe(false);
  });
});

describe("game versions and regeneration", () => {
  it("an attempt started before a regeneration is scored on its original version and keeps its questions", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const before = await start(lessonA.id, ada.id, vA);
    const snapshotFile = path.join(data.dir(), "game-versions", lessonA.id, `${vA}.json`);
    const snapBytes = fs.readFileSync(snapshotFile, "utf-8");

    await regenerate(lessonA.id, "v2"); // teacher regenerates mid-game
    const gameV2 = getProject(lessonA.id)!.outputs.game!;
    const vB2 = gameVersionKey(gameV2);
    expect(vB2).not.toBe(vA);

    // Same answers: on v1 a perfect 240 (on v2 the first answer would be wrong -> 230).
    const f = await finish(lessonA.id, ada.id, before.id, transcriptFor(gameA));
    expect(f.body.attempt).toMatchObject({ score: 240, version: vA, is_current_version: false });
    const d = (await detail(lessonA.id, ada.id, before.id)).body.attempt;
    expect(d.review[0]).toMatchObject({ question: gameA.levels[0].quiz_gates[0].question, correct_index: gameA.levels[0].quiz_gates[0].correct_index });
    expect(d.game_title).toBe(gameA.game_title);
    expect(fs.readFileSync(snapshotFile, "utf-8")).toBe(snapBytes); // snapshots are never rewritten

    // New attempts must use the new version.
    const stale = await start(lessonA.id, ada.id, vA);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("game_changed");
    const now = await play(lessonA.id, ada.id, vB2, transcriptFor(gameV2, [{ misses: 1 }]));
    expect(now.attempt).toMatchObject({ score: 235, version: vB2, is_current_version: true });

    const s = (await results(lessonA.id, ada.id)).body;
    expect(s.current_version).toBe(vB2);
    expect(s.best_by_version.map((v) => [v.version, v.is_current, v.best_score])).toEqual([
      [vB2, true, 235],
      [vA, false, 240],
    ]);
    expect(s.latest).toMatchObject({ id: now.id, is_current_version: true });
    expect(s.attempts.find((a) => a.id === before.id)).toMatchObject({ is_current_version: false });
  });

  it("regenerating identical content (mock mode) keeps the same version and results stay current", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    await play(lessonA.id, ada.id, vA, transcriptFor(gameA));
    await regenerate(lessonA.id, null);
    const s = (await results(lessonA.id, ada.id)).body;
    expect(s.current_version).toBe(vA);
    expect(s.latest?.is_current_version).toBe(true);
  });

  it("a game with a malformed question count can't be started and says why; no game yet is a 409", async () => {
    const { lessonA, lessonB, ada, gameA, vB } = setup();
    const bad = structuredClone(gameA);
    bad.levels[1].quiz_gates = bad.levels[1].quiz_gates.slice(0, 2);
    withGame(getProject(lessonA.id)!, bad);
    const s = (await results(lessonA.id, ada.id)).body;
    expect(s).toMatchObject({ playable: false, unplayable_reason: "Level 2 has 2 quiz questions; the game needs 3." });
    const r = await start(lessonA.id, ada.id, gameVersionKey(bad));
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("game_unplayable");
    expect(fs.existsSync(attemptsPath(ada.id, lessonA.id))).toBe(false);

    const noGame = { ...getProject(lessonB.id)! };
    delete noGame.outputs.game;
    saveProject(noGame);
    expect((await start(lessonB.id, ada.id, vB)).body.code).toBe("no_game");
    expect((await results(lessonB.id, ada.id)).body).toMatchObject({ current_version: null, playable: false });
  });

  it("a malformed version string is refused", async () => {
    const { lessonA, ada } = setup();
    expect((await start(lessonA.id, ada.id, "../../etc")).body.code).toBe("invalid_version");
    expect((await start(lessonA.id, ada.id, undefined)).body.code).toBe("invalid_version");
  });
});

describe("lesson edits, archiving and restoring keep results", () => {
  it("results are untouched; a student with an archived lesson open can still finish", async () => {
    const { classroom, lessonA, ada, gameA, vA } = setup();
    const won = await play(lessonA.id, ada.id, vA, transcriptFor(gameA));
    const open = await start(lessonA.id, ada.id, vA);
    const before = fs.readFileSync(attemptsPath(ada.id, lessonA.id), "utf-8");

    expect((await patchLesson(classroom.id, lessonA.id, { title: "Renamed lesson", summary: "New summary" })).status).toBe(200);
    expect((await patchLesson(classroom.id, lessonA.id, { archived: true })).status).toBe(200);
    expect(fs.readFileSync(attemptsPath(ada.id, lessonA.id), "utf-8")).toBe(before);

    // Same rule as progress: an already-open lesson keeps saving while archived.
    const late = await finish(lessonA.id, ada.id, open.id, transcriptFor(gameA, reproducedLossPlan));
    expect(late.status).toBe(200);

    expect((await patchLesson(classroom.id, lessonA.id, { archived: false })).status).toBe(200);
    const s = (await results(lessonA.id, ada.id)).body;
    expect(s.finished_count).toBe(2);
    expect(s.current_version).toBe(vA); // title/summary edits don't change the game version
    expect((await detail(lessonA.id, ada.id, won.id)).body.attempt.review[0]).toMatchObject({ question: gameA.levels[0].quiz_gates[0].question });
  });
});

describe("existing progress is unaffected", () => {
  it("flashcard progress and other completions stay as they were", async () => {
    const { lessonA, ada, gameA, vA } = setup();
    const deck_key = flashcardDeckKey(getProject(lessonA.id)!.outputs.flashcards);
    const fc = { deck_key, current_index: 2, known: [0, 1], review: [3] };
    const put = await progressRoute.PUT(req(`/api/lessons/${lessonA.id}/progress`, "PUT", { student_id: ada.id, rev: 5, flashcards: fc }), { params: { id: lessonA.id } });
    expect(put.status).toBe(200);
    await completeRoute.POST(req(`/api/lessons/${lessonA.id}/progress/complete`, "POST", { student_id: ada.id, modality: "mindmap" }), { params: { id: lessonA.id } });

    await play(lessonA.id, ada.id, vA, transcriptFor(gameA));
    const p = await progress(lessonA.id, ada.id);
    expect(p.flashcards).toEqual(fc);
    expect(p.flashcards_rev).toBe(5);
    expect(Object.keys(p.completed).sort()).toEqual(["game", "mindmap"]);
  });
});
