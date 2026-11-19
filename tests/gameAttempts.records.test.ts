import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import * as attemptsRoute from "@/app/api/lessons/[id]/game/attempts/route";
import * as attemptRoute from "@/app/api/lessons/[id]/game/attempts/[attemptId]/route";
import * as finishRoute from "@/app/api/lessons/[id]/game/attempts/[attemptId]/finish/route";
import * as lessonResultsRoute from "@/app/api/classrooms/[id]/lessons/[lessonId]/game-results/route";
import { getEvents } from "@/lib/db";
import { saveProject } from "@/lib/store";
import { gameVersionKey, TranscriptEntry } from "@/lib/gameEngine";
import type { GameResultsSummary, TeacherLessonGameResults } from "@/lib/gameResults";
import { GameSpecData } from "@/lib/types";
import { seedFixture, useTempDataDir } from "./fixtures";
import { mockGame, reproducedLossPlan, transcriptFor } from "./gameFixtures";

// Stored records that are valid JSON but hold the wrong data: a game-version
// snapshot whose content was altered while keeping its version fingerprint, and
// attempt files that belong to another student or lesson or are malformed.
// They must be treated as recoverable storage errors (503): the files are kept
// as they are, nothing is written to any other record, nothing is scored
// against altered content, and once the right files are back the waiting
// result is saved exactly once under its original attempt id.

const data = useTempDataDir();
const req = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

async function start(lessonId: string, studentId: string, version: string) {
  const id = randomUUID();
  const res = await attemptsRoute.POST(req("/x", "POST", { student_id: studentId, attempt_id: id, version }), { params: { id: lessonId } });
  return { status: res.status, id, body: (await res.json()) as { code?: string } };
}
async function finish(lessonId: string, studentId: string, attemptId: string, transcript: TranscriptEntry[]) {
  const res = await finishRoute.POST(req("/x", "POST", { student_id: studentId, transcript }), { params: { id: lessonId, attemptId } });
  return { status: res.status, body: (await res.json()) as { attempt?: { id: string; score: number }; duplicate?: boolean; code?: string } };
}
async function summary(lessonId: string, studentId: string) {
  const res = await attemptsRoute.GET(req(`/x?student_id=${studentId}`, "GET"), { params: { id: lessonId } });
  return { status: res.status, body: (await res.json()) as GameResultsSummary & { code?: string } };
}
async function detail(lessonId: string, studentId: string, attemptId: string) {
  const res = await attemptRoute.GET(req(`/x?student_id=${studentId}`, "GET"), { params: { id: lessonId, attemptId } });
  return res.status;
}

const resultEvents = (attemptStudent: string) => getEvents().filter((e) => e.type === "game_result" && e.student_id === attemptStudent);
const attemptsPath = (studentId: string, lessonId: string) => path.join(data.dir(), "game-attempts", studentId, `${lessonId}.json`);
const snapshotPath = (lessonId: string, v: string) => path.join(data.dir(), "game-versions", lessonId, `${v}.json`);
const read = (f: string) => fs.readFileSync(f, "utf-8");
/** Every file under the data dir with its content (to prove nothing was written or moved). */
const tree = () =>
  fs
    .readdirSync(data.dir(), { recursive: true })
    .map(String)
    .filter((f) => !f.endsWith("events.jsonl") && fs.statSync(path.join(data.dir(), f)).isFile())
    .sort()
    .map((f) => [f, read(path.join(data.dir(), f))]);

function setup() {
  const f = seedFixture();
  const game = mockGame(0);
  saveProject({ ...f.lessonA, outputs: { ...f.lessonA.outputs, game } });
  saveProject({ ...f.lessonB, outputs: { ...f.lessonB.outputs, game: mockGame(1) } });
  return { ...f, game, v: gameVersionKey(game), vB: gameVersionKey(mockGame(1)) };
}

/** The same game with a different answer key (what an edited snapshot would contain). */
function altered(g: GameSpecData): GameSpecData {
  const x = structuredClone(g);
  x.levels[0].quiz_gates[0].correct_index = (x.levels[0].quiz_gates[0].correct_index + 1) % 4;
  return x;
}

describe("a game-version snapshot whose content no longer matches its fingerprint", () => {
  it("is never used for scoring; the file is kept; after restoring it the waiting result saves once", async () => {
    const { lessonA, ada, game, v } = setup();
    const waiting = await start(lessonA.id, ada.id, v);
    const snap = snapshotPath(lessonA.id, v);
    const original = read(snap);
    const s = JSON.parse(original);
    const tampered = JSON.stringify({ ...s, game: altered(game) }, null, 2); // version field + file name unchanged
    fs.writeFileSync(snap, tampered);
    const before = tree();

    // Neither the original answers nor answers that fit the altered content are scored.
    for (const t of [transcriptFor(game), transcriptFor(altered(game))]) {
      const r = await finish(lessonA.id, ada.id, waiting.id, t);
      expect(r.status).toBe(503);
      expect(r.body.code).toBe("version_unavailable");
    }
    expect((await start(lessonA.id, ada.id, v)).status).toBe(503); // the altered snapshot is not overwritten either
    expect(tree()).toEqual(before);
    expect(read(snap)).toBe(tampered);
    expect(resultEvents(ada.id)).toHaveLength(0);
    expect((await summary(lessonA.id, ada.id)).body.finished_count).toBe(0);

    fs.writeFileSync(snap, original); // the right file is restored
    const ok = await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ duplicate: false, attempt: { id: waiting.id, score: 240 } });
    expect((await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game))).body.duplicate).toBe(true);
    expect(resultEvents(ada.id)).toHaveLength(1);
    expect((await summary(lessonA.id, ada.id)).body).toMatchObject({ finished_count: 1, latest: { id: waiting.id, score: 240 } });
  });

  it("an altered snapshot that can no longer be played is a storage error (503), not an answer error that would drop the result", async () => {
    const { lessonA, ada, game, v } = setup();
    const waiting = await start(lessonA.id, ada.id, v);
    const snap = snapshotPath(lessonA.id, v);
    const original = read(snap);
    const s = JSON.parse(original);
    s.game.levels[1].quiz_gates = s.game.levels[1].quiz_gates.slice(0, 2);
    fs.writeFileSync(snap, JSON.stringify(s));
    const r = await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("version_unavailable");
    fs.writeFileSync(snap, original);
    expect((await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game))).status).toBe(200);
  });

  it("a snapshot belonging to another lesson (valid, correct fingerprint) is refused", async () => {
    const { lessonA, ada, game, v } = setup();
    const waiting = await start(lessonA.id, ada.id, v);
    const snap = snapshotPath(lessonA.id, v);
    const original = read(snap);
    fs.writeFileSync(snap, JSON.stringify({ ...JSON.parse(original), lesson_id: "lesson-b" }));
    expect((await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game))).status).toBe(503);
    fs.writeFileSync(snap, original);
    expect((await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game))).status).toBe(200);
  });
});

describe("an attempt file that belongs to another record", () => {
  it("another student's file at this student's path: 503, no write to either record, and recovery after restoring", async () => {
    const { lessonA, ada, ben, game, v } = setup();
    const adaWaiting = await start(lessonA.id, ada.id, v); // Ada finished; her save is pending in the browser
    const benOpen = await start(lessonA.id, ben.id, v); // Ben is mid-game
    const adaFile = attemptsPath(ada.id, lessonA.id);
    const benFile = attemptsPath(ben.id, lessonA.id);
    const adaOriginal = read(adaFile);
    fs.writeFileSync(adaFile, read(benFile)); // e.g. a restore put Ben's copy in Ada's place
    const before = tree();

    expect((await summary(lessonA.id, ada.id)).status).toBe(503);
    expect((await finish(lessonA.id, ada.id, adaWaiting.id, transcriptFor(game))).status).toBe(503);
    // Ada's requests must never act on (or write) Ben's attempt found in that file.
    const forged = await finish(lessonA.id, ada.id, benOpen.id, transcriptFor(game));
    expect(forged.status).toBe(503);
    expect((await start(lessonA.id, ada.id, v)).status).toBe(503);
    expect(await detail(lessonA.id, ada.id, adaWaiting.id)).toBe(503);
    expect(tree()).toEqual(before); // nothing written or moved, Ben's file included
    expect(resultEvents(ada.id)).toHaveLength(0);
    expect(resultEvents(ben.id)).toHaveLength(0);

    // Ben's own record is unaffected.
    expect((await finish(lessonA.id, ben.id, benOpen.id, transcriptFor(game, reproducedLossPlan))).status).toBe(200);

    fs.writeFileSync(adaFile, adaOriginal); // the right file is restored
    const ok = await finish(lessonA.id, ada.id, adaWaiting.id, transcriptFor(game));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ duplicate: false, attempt: { id: adaWaiting.id, score: 240 } });
    expect((await finish(lessonA.id, ada.id, adaWaiting.id, transcriptFor(game))).body.duplicate).toBe(true);
    expect(resultEvents(ada.id)).toHaveLength(1);
    expect((await summary(lessonA.id, ada.id)).body).toMatchObject({ finished_count: 1, latest: { id: adaWaiting.id } });
    expect((await summary(lessonA.id, ben.id)).body).toMatchObject({ finished_count: 1, latest: { id: benOpen.id, score: 30 } });
  });

  it("the student's own file from another lesson at this lesson's path: 503 and untouched", async () => {
    const { lessonA, lessonB, ada, v, vB } = setup();
    await start(lessonA.id, ada.id, v);
    await start(lessonB.id, ada.id, vB);
    const aFile = attemptsPath(ada.id, lessonA.id);
    fs.writeFileSync(aFile, read(attemptsPath(ada.id, lessonB.id)));
    const before = tree();
    expect((await summary(lessonA.id, ada.id)).status).toBe(503);
    expect((await start(lessonA.id, ada.id, v)).status).toBe(503);
    expect(tree()).toEqual(before);
    expect((await summary(lessonB.id, ada.id)).status).toBe(200);
  });

  it.each([
    ["a finished attempt whose score isn't a number", (f: any) => { f.attempts[0] = { ...f.attempts[0], status: "finished", score: "240", finished_at: "2024-01-01T00:00:00.000Z", outcome: "victory" }; }],
    ["a finished attempt without its answers", (f: any) => { f.attempts[0] = { ...f.attempts[0], status: "finished", score: 240, finished_at: "2024-01-01T00:00:00.000Z", outcome: "victory", lives_left: 3, levels_total: 3, levels_cleared: 3, review: [] }; }],
    ["an unknown status", (f: any) => { f.attempts[0].status = "won"; }],
    ["a malformed version", (f: any) => { f.attempts[0].version = "../x"; }],
    ["a malformed attempt id", (f: any) => { f.attempts[0].id = "not-a-uuid"; }],
    ["the same attempt id twice", (f: any) => { f.attempts.push({ ...f.attempts[0] }); }],
    ["another classroom", (f: any) => { f.classroom_id = "class-2"; }],
  ])("%s: 503, file untouched", async (_name, mutate) => {
    const { lessonA, ada, v } = setup();
    const waiting = await start(lessonA.id, ada.id, v);
    const file = attemptsPath(ada.id, lessonA.id);
    const f = JSON.parse(read(file));
    mutate(f);
    const bad = JSON.stringify(f);
    fs.writeFileSync(file, bad);
    expect((await summary(lessonA.id, ada.id)).status).toBe(503);
    expect((await finish(lessonA.id, ada.id, waiting.id, transcriptFor(mockGame(0)))).status).toBe(503);
    expect(read(file)).toBe(bad);
  });

  it("the teacher sees such a student as unreadable (not counted) and nothing is changed", async () => {
    const { classroom, lessonA, ada, ben, game, v } = setup();
    const b = await start(lessonA.id, ben.id, v);
    await finish(lessonA.id, ben.id, b.id, transcriptFor(game));
    await start(lessonA.id, ada.id, v);
    fs.writeFileSync(attemptsPath(ada.id, lessonA.id), read(attemptsPath(ben.id, lessonA.id)));
    const before = tree();
    const res = await lessonResultsRoute.GET(req("/x", "GET"), { params: { id: classroom.id, lessonId: lessonA.id } });
    const t = (await res.json()) as TeacherLessonGameResults;
    expect(t.students.find((s) => s.student_id === ada.id)).toMatchObject({ results_unavailable: true, finished_count: 0, latest: null });
    expect(t.students.find((s) => s.student_id === ben.id)).toMatchObject({ results_unavailable: false, finished_count: 1 });
    expect(t.totals).toMatchObject({ finished_attempts: 1, students_unavailable: 1 });
    expect(tree()).toEqual(before);
  });
});
