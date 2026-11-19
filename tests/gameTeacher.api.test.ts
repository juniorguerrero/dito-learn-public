import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Regeneration through the real generate route; the mock game generator returns
// a synthetic new version while `regen.tag` is set.
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
import * as finishRoute from "@/app/api/lessons/[id]/game/attempts/[attemptId]/finish/route";
import * as generateRoute from "@/app/api/projects/[id]/generate/route";
import * as lessonRoute from "@/app/api/classrooms/[id]/lessons/[lessonId]/route";
import * as overviewRoute from "@/app/api/classrooms/[id]/game-results/route";
import * as lessonResultsRoute from "@/app/api/classrooms/[id]/lessons/[lessonId]/game-results/route";
import * as studentResultsRoute from "@/app/api/classrooms/[id]/lessons/[lessonId]/game-results/[studentId]/route";
import * as attemptDetailRoute from "@/app/api/classrooms/[id]/lessons/[lessonId]/game-results/[studentId]/attempts/[attemptId]/route";
import { getProject, saveProject } from "@/lib/store";
import { gameVersionKey, TranscriptEntry } from "@/lib/gameEngine";
import type { AttemptDetail, TeacherGameOverviewLesson, TeacherLessonGameResults, TeacherStudentGameResults } from "@/lib/gameResults";
import { GameSpecData, Project } from "@/lib/types";
import { seedFixture, useTempDataDir } from "./fixtures";
import { mockGame, reproducedLossPlan, transcriptFor } from "./gameFixtures";

const data = useTempDataDir();
const U = "http://localhost";
const req = (url: string, method: string, body?: unknown) => new NextRequest(`${U}${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

async function start(lessonId: string, studentId: string, version: string) {
  const id = randomUUID();
  const res = await attemptsRoute.POST(req(`/api/lessons/${lessonId}/game/attempts`, "POST", { student_id: studentId, attempt_id: id, version }), { params: { id: lessonId } });
  expect(res.status).toBe(201);
  return id;
}
async function finish(lessonId: string, studentId: string, attemptId: string, transcript: TranscriptEntry[]) {
  const res = await finishRoute.POST(req(`/x`, "POST", { student_id: studentId, transcript }), { params: { id: lessonId, attemptId } });
  expect(res.status).toBe(200);
}
async function play(lessonId: string, studentId: string, game: GameSpecData, transcript: TranscriptEntry[]) {
  const id = await start(lessonId, studentId, gameVersionKey(game));
  await finish(lessonId, studentId, id, transcript);
  return id;
}

async function overview(classroomId: string) {
  const res = await overviewRoute.GET(req("/x", "GET"), { params: { id: classroomId } });
  return { status: res.status, body: (await res.json()) as { lessons: TeacherGameOverviewLesson[]; code?: string } };
}
async function lessonResults(classroomId: string, lessonId: string) {
  const res = await lessonResultsRoute.GET(req("/x", "GET"), { params: { id: classroomId, lessonId } });
  return { status: res.status, body: (await res.json()) as TeacherLessonGameResults & { code?: string } };
}
async function studentResults(classroomId: string, lessonId: string, studentId: string) {
  const res = await studentResultsRoute.GET(req("/x", "GET"), { params: { id: classroomId, lessonId, studentId } });
  return { status: res.status, body: (await res.json()) as TeacherStudentGameResults & { code?: string } };
}
async function attemptDetail(classroomId: string, lessonId: string, studentId: string, attemptId: string) {
  const res = await attemptDetailRoute.GET(req("/x", "GET"), { params: { id: classroomId, lessonId, studentId, attemptId } });
  return { status: res.status, body: (await res.json()) as { attempt: AttemptDetail; code?: string } };
}
async function regenerate(lessonId: string, tag: string) {
  regen.tag = tag;
  try {
    const res = await generateRoute.POST(req("/x", "POST", { type: "game", force: true }), { params: { id: lessonId } });
    expect(res.status).toBe(200);
  } finally {
    regen.tag = null;
  }
}
const patchLesson = (classroomId: string, lessonId: string, body: unknown) =>
  lessonRoute.PATCH(req("/x", "PATCH", body), { params: { id: classroomId, lessonId } });

function withGame(p: Project, game: GameSpecData) {
  saveProject({ ...p, outputs: { ...p.outputs, game } });
}
function setup() {
  const f = seedFixture();
  const gameA = mockGame(0);
  withGame(f.lessonA, gameA);
  withGame(f.lessonX, mockGame(0));
  return { ...f, gameA };
}
const row = (r: TeacherLessonGameResults, studentId: string) => r.students.find((s) => s.student_id === studentId)!;

describe("teacher: results per student for a lesson", () => {
  it("latest result, best score, finished count per student; every enrolled student listed; unfinished never counted", async () => {
    const { classroom, lessonA, ada, ben, gameA } = setup();
    const win = await play(lessonA.id, ada.id, gameA, transcriptFor(gameA, [{ misses: 1 }])); // 235
    const loss = await play(lessonA.id, ada.id, gameA, transcriptFor(gameA, reproducedLossPlan)); // 30, latest
    await start(lessonA.id, ada.id, gameVersionKey(gameA)); // interrupted below
    await start(lessonA.id, ada.id, gameVersionKey(gameA)); // still in progress
    await start(lessonA.id, ben.id, gameVersionKey(gameA)); // Ben only started

    const r = await lessonResults(classroom.id, lessonA.id);
    expect(r.status).toBe(200);
    expect(r.body.students.map((s) => s.name)).toEqual(["Ada Synthetic", "Ben Synthetic"]);
    expect(row(r.body, ada.id)).toMatchObject({
      finished_count: 2,
      victories: 1,
      latest: { id: loss, score: 30, outcome: "game_over" },
      best_by_version: [expect.objectContaining({ best_score: 235, best_attempt_id: win, is_current: true, finished_attempts: 2 })],
    });
    expect(row(r.body, ben.id)).toMatchObject({ finished_count: 0, victories: 0, latest: null, best_by_version: [] });
    expect(r.body.totals).toEqual({ students: 2, students_played: 1, finished_attempts: 2, victories: 1, students_unavailable: 0 });
    expect(r.body.versions).toEqual([expect.objectContaining({ number: 1, label: "Version 1", is_current: true })]);
    expect(r.body.game).toMatchObject({ has_game: true, playable: true, current_version: gameVersionKey(gameA) });

    const s = await studentResults(classroom.id, lessonA.id, ada.id);
    expect(s.status).toBe(200);
    expect(s.body.summary.attempts.map((a) => a.id)).toEqual([loss, win]); // finished only, newest first
    expect((await studentResults(classroom.id, lessonA.id, ben.id)).body.summary).toMatchObject({ finished_count: 0, attempts: [] });
  });

  it("attempt details show every question with the chosen answer, the correct answer and the explanation", async () => {
    const { classroom, lessonA, ada, gameA } = setup();
    const id = await play(lessonA.id, ada.id, gameA, transcriptFor(gameA, [{ gates: [true, false, true], misses: 2, bossWrong: 1 }]));
    const d = await attemptDetail(classroom.id, lessonA.id, ada.id, id);
    expect(d.status).toBe(200);
    const q = gameA.levels[0].quiz_gates[1];
    expect(d.body.attempt.review[1]).toMatchObject({
      kind: "gate", question: q.question, options: q.options, choice: (q.correct_index + 1) % 4, correct_index: q.correct_index, correct: false, explanation: q.explanation,
    });
    expect(d.body.attempt.review.filter((x) => x.kind === "boss" && x.level === 0)).toHaveLength(2);
    expect(d.body.attempt.review.find((x) => x.kind === "matching")).toMatchObject({ mistakes: 2, points: 10 });
  });

  it("a lesson without a game lists students with nothing played", async () => {
    const { classroom, lessonB } = setup();
    const r = await lessonResults(classroom.id, lessonB.id);
    expect(r.body).toMatchObject({ game: { has_game: false, current_version: null }, versions: [], totals: { students_played: 0, finished_attempts: 0 } });
  });
});

describe("teacher: game versions and regeneration", () => {
  it("best score per version with the current version flagged; old attempts keep their questions", async () => {
    const { classroom, lessonA, ada, ben, gameA } = setup();
    const v1 = gameVersionKey(gameA);
    const old = await play(lessonA.id, ada.id, gameA, transcriptFor(gameA)); // 240 on v1
    const inFlight = await start(lessonA.id, ben.id, v1); // Ben is mid-game on v1

    await regenerate(lessonA.id, "v2");
    const gameV2 = getProject(lessonA.id)!.outputs.game!;
    const v2 = gameVersionKey(gameV2);

    let r = (await lessonResults(classroom.id, lessonA.id)).body;
    expect(r.versions.map((v) => [v.label, v.is_current, v.first_seen_at === null])).toEqual([
      ["Version 1", false, false],
      ["Version 2", true, true], // current, nobody has played it yet
    ]);
    expect(row(r, ada.id).latest).toMatchObject({ id: old, is_current_version: false });

    await finish(lessonA.id, ben.id, inFlight, transcriptFor(gameA)); // scored on v1
    await play(lessonA.id, ada.id, gameV2, transcriptFor(gameV2, [{ misses: 3 }])); // 225 on v2

    r = (await lessonResults(classroom.id, lessonA.id)).body;
    expect(r.versions.map((v) => v.version)).toEqual([v1, v2]);
    expect(row(r, ada.id).best_by_version.map((b) => [b.version, b.is_current, b.best_score])).toEqual([
      [v2, true, 225],
      [v1, false, 240],
    ]);
    expect(row(r, ben.id).best_by_version).toEqual([expect.objectContaining({ version: v1, is_current: false, best_score: 240 })]);

    const d = (await attemptDetail(classroom.id, lessonA.id, ada.id, old)).body.attempt;
    expect(d).toMatchObject({ version: v1, is_current_version: false, game_title: gameA.game_title });
    expect(d.review[0]).toMatchObject({ question: gameA.levels[0].quiz_gates[0].question, correct_index: gameA.levels[0].quiz_gates[0].correct_index });
  });
});

describe("teacher: lesson edits, archiving and restoring keep results; archived lessons stay in history", () => {
  it("results survive edit/archive/restore and archived lessons are listed with their results", async () => {
    const { classroom, lessonA, ada, gameA } = setup();
    const id = await play(lessonA.id, ada.id, gameA, transcriptFor(gameA));
    const before = (await lessonResults(classroom.id, lessonA.id)).body;

    expect((await patchLesson(classroom.id, lessonA.id, { title: "Renamed quest lesson" })).status).toBe(200);
    expect((await patchLesson(classroom.id, lessonA.id, { archived: true })).status).toBe(200);
    const o = (await overview(classroom.id)).body.lessons;
    expect(o.map((l) => [l.id, l.archived, l.students_played, l.finished_attempts])).toEqual([
      [lessonA.id, true, 1, 1],
      ["lesson-b", false, 0, 0],
    ]);
    expect(o[0].title).toBe("Renamed quest lesson");
    const archived = (await lessonResults(classroom.id, lessonA.id)).body;
    expect(archived.lesson).toMatchObject({ archived: true, title: "Renamed quest lesson" });
    expect(archived.students).toEqual(before.students);
    expect((await attemptDetail(classroom.id, lessonA.id, ada.id, id)).status).toBe(200);

    expect((await patchLesson(classroom.id, lessonA.id, { archived: false })).status).toBe(200);
    const restored = (await lessonResults(classroom.id, lessonA.id)).body;
    expect(restored.lesson.archived).toBe(false);
    expect(restored.students).toEqual(before.students);
    expect(restored.versions).toEqual(before.versions);
  });
});

describe("teacher: classroom separation", () => {
  it("a lesson's results are only reachable through its own classroom, and only for enrolled students", async () => {
    const { classroom, otherClassroom, lessonA, lessonX, ada, ben, outsider, gameA } = setup();
    const id = await play(lessonA.id, ada.id, gameA, transcriptFor(gameA));
    const inOther = await play(lessonX.id, outsider.id, mockGame(0), transcriptFor(mockGame(0)));

    expect((await lessonResults(otherClassroom.id, lessonA.id)).status).toBe(404); // wrong classroom
    expect((await lessonResults(classroom.id, lessonX.id)).status).toBe(404); // other classroom's lesson
    expect((await lessonResults("class-missing", lessonA.id)).status).toBe(404);
    expect((await studentResults(otherClassroom.id, lessonA.id, ada.id)).status).toBe(404);
    expect((await studentResults(classroom.id, lessonA.id, outsider.id)).status).toBe(404); // not enrolled here
    expect((await attemptDetail(otherClassroom.id, lessonA.id, ada.id, id)).status).toBe(404);
    expect((await attemptDetail(classroom.id, lessonA.id, ben.id, id)).status).toBe(404); // Ada's attempt via Ben
    expect((await attemptDetail(classroom.id, lessonX.id, outsider.id, inOther)).status).toBe(404);
    expect((await overview("class-missing")).status).toBe(404);

    const mine = (await lessonResults(classroom.id, lessonA.id)).body;
    expect(mine.students.map((s) => s.student_id)).not.toContain(outsider.id);
    const theirs = (await lessonResults(otherClassroom.id, lessonX.id)).body;
    expect(theirs.students.map((s) => [s.student_id, s.finished_count])).toEqual([[outsider.id, 1]]);
    expect((await overview(otherClassroom.id)).body.lessons.map((l) => l.id)).toEqual([lessonX.id]);
  });

  it("an unfinished attempt can't be opened", async () => {
    const { classroom, lessonA, ada, gameA } = setup();
    const id = await start(lessonA.id, ada.id, gameVersionKey(gameA));
    expect((await attemptDetail(classroom.id, lessonA.id, ada.id, id)).status).toBe(404);
    expect((await attemptDetail(classroom.id, lessonA.id, ada.id, "not-a-uuid")).status).toBe(404);
  });
});

describe("teacher views are read-only", () => {
  it("never write or move files, even a damaged attempt file", async () => {
    const { classroom, lessonA, ada, ben, gameA } = setup();
    await play(lessonA.id, ada.id, gameA, transcriptFor(gameA));
    const damaged = path.join(data.dir(), "game-attempts", ben.id, `${lessonA.id}.json`);
    fs.mkdirSync(path.dirname(damaged), { recursive: true });
    fs.writeFileSync(damaged, "{ not json");
    const snapshot = () =>
      fs
        .readdirSync(data.dir(), { recursive: true })
        .map(String)
        .filter((f) => fs.statSync(path.join(data.dir(), f)).isFile())
        .sort()
        .map((f) => `${f}:${fs.readFileSync(path.join(data.dir(), f), "utf-8").length}`);
    const before = snapshot();
    await overview(classroom.id);
    const r = await lessonResults(classroom.id, lessonA.id);
    await studentResults(classroom.id, lessonA.id, ben.id);
    expect(row(r.body, ben.id)).toMatchObject({ finished_count: 0, results_unavailable: true });
    expect(snapshot()).toEqual(before);
  });
});

describe("students and teachers see the same results", () => {
  it("after refreshes, retries, a regeneration and archive/restore", async () => {
    const { classroom, lessonA, ada, ben, gameA } = setup();
    const studentView = async (studentId: string) => {
      const res = await attemptsRoute.GET(req(`/x?student_id=${studentId}`, "GET"), { params: { id: lessonA.id } });
      expect(res.status).toBe(200);
      return (await res.json()) as TeacherStudentGameResults["summary"];
    };
    const agree = async (label: string) => {
      const lesson = (await lessonResults(classroom.id, lessonA.id)).body;
      for (const sid of [ada.id, ben.id]) {
        const mine = await studentView(sid);
        const t = await studentResults(classroom.id, lessonA.id, sid);
        expect(t.status, label).toBe(200);
        expect(t.body.summary, `${label}: teacher's student view`).toEqual(mine);
        const r = row(lesson, sid);
        expect({ finished: r.finished_count, latest: r.latest, best: r.best_by_version }, `${label}: teacher's table row`).toEqual({
          finished: mine.finished_count,
          latest: mine.latest,
          best: mine.best_by_version,
        });
        for (const a of mine.attempts) {
          expect((await attemptDetail(classroom.id, lessonA.id, sid, a.id)).body.attempt.score, label).toBe(a.score);
        }
      }
    };
    const v1 = gameVersionKey(gameA);

    // Refresh = new requests answered from disk; retries = the same finish sent again.
    const a1 = await start(lessonA.id, ada.id, v1);
    await finish(lessonA.id, ada.id, a1, transcriptFor(gameA, [{ misses: 1 }]));
    await finish(lessonA.id, ada.id, a1, transcriptFor(gameA, [{ misses: 1 }])); // retried
    await start(lessonA.id, ben.id, v1); // unfinished
    await agree("after a finish, a retried finish and an unfinished attempt");

    // Regeneration while Ben is mid-game: his attempt stays on version 1.
    const b1 = await start(lessonA.id, ben.id, v1);
    await regenerate(lessonA.id, "v2");
    const gameV2 = getProject(lessonA.id)!.outputs.game!;
    await finish(lessonA.id, ben.id, b1, transcriptFor(gameA, reproducedLossPlan));
    await play(lessonA.id, ada.id, gameV2, transcriptFor(gameV2));
    await agree("after a regeneration");

    // Archive and restore.
    expect((await patchLesson(classroom.id, lessonA.id, { archived: true })).status).toBe(200);
    await agree("while archived");
    expect((await patchLesson(classroom.id, lessonA.id, { archived: false })).status).toBe(200);
    await agree("after restoring");
    const ada_ = await studentView(ada.id);
    expect(ada_.best_by_version.map((b) => [b.is_current, b.best_score])).toEqual([
      [true, 240],
      [false, 235],
    ]);
  });
});
