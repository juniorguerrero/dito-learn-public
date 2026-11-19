import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import * as attemptsRoute from "@/app/api/lessons/[id]/game/attempts/route";
import * as attemptRoute from "@/app/api/lessons/[id]/game/attempts/[attemptId]/route";
import * as finishRoute from "@/app/api/lessons/[id]/game/attempts/[attemptId]/finish/route";
import * as lessonResultsRoute from "@/app/api/classrooms/[id]/lessons/[lessonId]/game-results/route";
import * as studentResultsRoute from "@/app/api/classrooms/[id]/lessons/[lessonId]/game-results/[studentId]/route";
import { getEvents } from "@/lib/db";
import { saveProject } from "@/lib/store";
import { gameVersionKey, TranscriptEntry } from "@/lib/gameEngine";
import type { GameResultsSummary, TeacherLessonGameResults, TeacherStudentGameResults } from "@/lib/gameResults";
import { seedFixture, useTempDataDir } from "./fixtures";
import { mockGame, transcriptFor } from "./gameFixtures";

// A storage problem with a student's attempt file (damaged or unreadable file,
// missing game-version snapshot) must not erase a finished result that is still
// waiting in the browser: the server answers 503 (the browser keeps the result
// and retries), never rewrites or moves the damaged file, never accepts a score
// it can't validate, and records the result normally once storage is readable.

const data = useTempDataDir();
const U = "http://localhost";
const req = (url: string, method: string, body?: unknown) => new NextRequest(`${U}${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

async function start(lessonId: string, studentId: string, version: string, attemptId = randomUUID()) {
  const res = await attemptsRoute.POST(req("/x", "POST", { student_id: studentId, attempt_id: attemptId, version }), { params: { id: lessonId } });
  return { status: res.status, id: attemptId, body: (await res.json()) as { code?: string } };
}
async function finish(lessonId: string, studentId: string, attemptId: string, transcript: TranscriptEntry[], extra: Record<string, unknown> = {}) {
  const res = await finishRoute.POST(req("/x", "POST", { student_id: studentId, transcript, ...extra }), { params: { id: lessonId, attemptId } });
  return { status: res.status, body: (await res.json()) as { attempt?: { score: number; outcome: string }; duplicate?: boolean; error?: string; code?: string } };
}
async function summary(lessonId: string, studentId: string) {
  const res = await attemptsRoute.GET(req(`/x?student_id=${studentId}`, "GET"), { params: { id: lessonId } });
  return { status: res.status, body: (await res.json()) as GameResultsSummary & { error?: string; code?: string } };
}
async function detail(lessonId: string, studentId: string, attemptId: string) {
  const res = await attemptRoute.GET(req(`/x?student_id=${studentId}`, "GET"), { params: { id: lessonId, attemptId } });
  return { status: res.status, body: (await res.json()) as { code?: string } };
}
async function teacherLesson(classroomId: string, lessonId: string) {
  const res = await lessonResultsRoute.GET(req("/x", "GET"), { params: { id: classroomId, lessonId } });
  return { status: res.status, body: (await res.json()) as TeacherLessonGameResults };
}
async function teacherStudent(classroomId: string, lessonId: string, studentId: string) {
  const res = await studentResultsRoute.GET(req("/x", "GET"), { params: { id: classroomId, lessonId, studentId } });
  return { status: res.status, body: (await res.json()) as TeacherStudentGameResults & { code?: string } };
}

const gameEvents = () => getEvents().filter((e) => e.type === "game_result");
const attemptsPath = (studentId: string, lessonId: string) => path.join(data.dir(), "game-attempts", studentId, `${lessonId}.json`);
const siblings = (file: string) => fs.readdirSync(path.dirname(file)).sort();

function setup() {
  const f = seedFixture();
  const game = mockGame(0);
  saveProject({ ...f.lessonA, outputs: { ...f.lessonA.outputs, game } });
  return { ...f, game, v: gameVersionKey(game) };
}

describe("a damaged attempt file", () => {
  it("is reported as temporarily unavailable (503), left untouched, and the waiting result is recorded once it is readable again", async () => {
    const { lessonA, ada, game, v } = setup();
    const waiting = await start(lessonA.id, ada.id, v); // finished in the browser, not yet saved
    const file = attemptsPath(ada.id, lessonA.id);
    const good = fs.readFileSync(file, "utf-8");
    const damaged = good.slice(0, Math.floor(good.length / 2)); // e.g. a truncated copy restored from a bad disk
    fs.writeFileSync(file, damaged);

    // Every student operation reports the storage problem; nothing is changed.
    const s = await summary(lessonA.id, ada.id);
    expect(s.status).toBe(503);
    expect(s.body.code).toBe("results_unavailable");
    expect(s.body.error).toMatch(/can't be read right now/);
    const f1 = await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game), { score: 99999, outcome: "victory" });
    expect(f1.status).toBe(503); // transient: the browser keeps the result and retries
    expect(f1.body.code).toBe("results_unavailable");
    expect((await start(lessonA.id, ada.id, v)).status).toBe(503);
    expect((await detail(lessonA.id, ada.id, waiting.id)).status).toBe(503);
    expect(fs.readFileSync(file, "utf-8")).toBe(damaged); // not overwritten
    expect(siblings(file)).toEqual([`${lessonA.id}.json`]); // not moved aside / replaced
    expect(gameEvents()).toHaveLength(0);

    // Storage is fixed (file restored): the same attempt id is accepted and scored by the server.
    fs.writeFileSync(file, good);
    const f2 = await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game), { score: 99999, outcome: "victory" });
    expect(f2.status).toBe(200);
    expect(f2.body).toMatchObject({ duplicate: false, attempt: { score: 240, outcome: "victory" } });
    expect((await summary(lessonA.id, ada.id)).body).toMatchObject({ finished_count: 1, latest: { id: waiting.id, score: 240 } });
    expect(gameEvents()).toHaveLength(1);
  });

  it("a file that is valid JSON but not an attempt record is treated the same way", async () => {
    const { lessonA, ada, v } = setup();
    await start(lessonA.id, ada.id, v);
    const file = attemptsPath(ada.id, lessonA.id);
    fs.writeFileSync(file, JSON.stringify({ attempts: "oops" }));
    expect((await summary(lessonA.id, ada.id)).status).toBe(503);
    expect((await start(lessonA.id, ada.id, v)).status).toBe(503);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ attempts: "oops" });
  });

  it.skipIf(typeof process.getuid === "function" && process.getuid() === 0)("an unreadable file (permission denied) is a 503 until it can be read again", async () => {
    const { lessonA, ada, game, v } = setup();
    const waiting = await start(lessonA.id, ada.id, v);
    const file = attemptsPath(ada.id, lessonA.id);
    fs.chmodSync(file, 0o000);
    try {
      expect((await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game))).status).toBe(503);
      expect((await summary(lessonA.id, ada.id)).status).toBe(503);
    } finally {
      fs.chmodSync(file, 0o644);
    }
    expect((await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game))).status).toBe(200);
    expect(gameEvents()).toHaveLength(1);
  });
});

describe("a missing or damaged game-version snapshot", () => {
  it("is a 503 (the result is kept and retried), never scored against another version, and recovers when restored", async () => {
    const { lessonA, ada, game, v } = setup();
    const waiting = await start(lessonA.id, ada.id, v);
    const snap = path.join(data.dir(), "game-versions", lessonA.id, `${v}.json`);
    const saved = fs.readFileSync(snap, "utf-8");
    fs.rmSync(snap);
    const missing = await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game));
    expect(missing.status).toBe(503);
    expect(missing.body.code).toBe("version_unavailable");
    fs.writeFileSync(snap, "{ damaged");
    expect((await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game))).status).toBe(503);
    expect(gameEvents()).toHaveLength(0);
    expect((await summary(lessonA.id, ada.id)).body.finished_count).toBe(0);

    fs.writeFileSync(snap, saved);
    const ok = await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game));
    expect(ok.status).toBe(200);
    expect(ok.body.attempt).toMatchObject({ score: 240 });
  });
});

describe("teacher view of a damaged attempt file", () => {
  it("flags the student's results as unreadable (not 'not played'), leaves the file alone, and agrees with the student after recovery", async () => {
    const { classroom, lessonA, ada, ben, game, v } = setup();
    const played = await start(lessonA.id, ada.id, v);
    expect((await finish(lessonA.id, ada.id, played.id, transcriptFor(game))).status).toBe(200);
    const file = attemptsPath(ada.id, lessonA.id);
    const good = fs.readFileSync(file, "utf-8");
    fs.writeFileSync(file, "{ not json");

    const t = await teacherLesson(classroom.id, lessonA.id);
    expect(t.status).toBe(200);
    const adaRow = t.body.students.find((s) => s.student_id === ada.id)!;
    expect(adaRow).toMatchObject({ results_unavailable: true, finished_count: 0, latest: null });
    expect(t.body.students.find((s) => s.student_id === ben.id)).toMatchObject({ results_unavailable: false });
    expect(t.body.totals).toMatchObject({ students_played: 0, finished_attempts: 0, students_unavailable: 1 });
    const ts = await teacherStudent(classroom.id, lessonA.id, ada.id);
    expect(ts.status).toBe(503);
    expect(ts.body.code).toBe("results_unavailable");
    expect(fs.readFileSync(file, "utf-8")).toBe("{ not json");
    expect(siblings(file)).toEqual([`${lessonA.id}.json`]);

    fs.writeFileSync(file, good);
    const student = (await summary(lessonA.id, ada.id)).body;
    const teacher = (await teacherStudent(classroom.id, lessonA.id, ada.id)).body.summary;
    expect(teacher).toEqual(student);
    expect((await teacherLesson(classroom.id, lessonA.id)).body.students.find((s) => s.student_id === ada.id)).toMatchObject({
      results_unavailable: false,
      finished_count: 1,
      latest: student.latest,
    });
  });
});
