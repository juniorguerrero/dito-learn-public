import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Save/retry gaps: partial failures between the steps of recording a finish,
// and unfinished attempts whose result is still waiting in the browser.
// Writes of game-attempt files can be made to fail on demand.
const faults = vi.hoisted(() => ({ failAttemptWrites: 0, failed: 0 }));
vi.mock("@/lib/dataDir", async (orig) => {
  const real = await orig<typeof import("@/lib/dataDir")>();
  return {
    ...real,
    writeJsonAtomic: (file: string, value: unknown) => {
      if (faults.failAttemptWrites > 0 && file.includes(`${path.sep}game-attempts${path.sep}`)) {
        faults.failAttemptWrites--;
        faults.failed++;
        throw new Error("synthetic disk failure (EIO)");
      }
      return real.writeJsonAtomic(file, value);
    },
  };
});

import * as attemptsRoute from "@/app/api/lessons/[id]/game/attempts/route";
import * as finishRoute from "@/app/api/lessons/[id]/game/attempts/[attemptId]/finish/route";
import { getEvents } from "@/lib/db";
import { saveProject } from "@/lib/store";
import { gameVersionKey, TranscriptEntry } from "@/lib/gameEngine";
import type { AttemptSummary, GameResultsSummary } from "@/lib/gameResults";
import { seedFixture, useTempDataDir } from "./fixtures";
import { mockGame, reproducedLossPlan, transcriptFor } from "./gameFixtures";

const data = useTempDataDir();
afterEach(() => {
  faults.failAttemptWrites = 0;
  faults.failed = 0;
});
const U = "http://localhost";
const req = (url: string, method: string, body?: unknown) => new NextRequest(`${U}${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

async function start(lessonId: string, studentId: string, version: string, attemptId: string = randomUUID()) {
  const res = await attemptsRoute.POST(req(`/api/lessons/${lessonId}/game/attempts`, "POST", { student_id: studentId, attempt_id: attemptId, version }), { params: { id: lessonId } });
  return { status: res.status, id: attemptId };
}
async function finish(lessonId: string, studentId: string, attemptId: string, transcript: TranscriptEntry[]) {
  const res = await finishRoute.POST(req(`/api/lessons/${lessonId}/game/attempts/${attemptId}/finish`, "POST", { student_id: studentId, transcript }), { params: { id: lessonId, attemptId } });
  return { status: res.status, body: (await res.json()) as { attempt: AttemptSummary; duplicate: boolean; error?: string; code?: string } };
}
async function summary(lessonId: string, studentId: string) {
  const res = await attemptsRoute.GET(req(`/api/lessons/${lessonId}/game/attempts?student_id=${studentId}`, "GET"), { params: { id: lessonId } });
  return (await res.json()) as GameResultsSummary;
}
const gameEvents = () => getEvents().filter((e) => e.type === "game_result");

function setup() {
  const f = seedFixture();
  const game = mockGame(0);
  saveProject({ ...f.lessonA, outputs: { ...f.lessonA.outputs, game } });
  return { ...f, game, v: gameVersionKey(game) };
}

describe("gap 1: an unfinished attempt whose result is still waiting to be saved", () => {
  it("is still accepted after many newer attempts were started (it is never pruned)", async () => {
    const { lessonA, ada, game, v } = setup();
    const waiting = await start(lessonA.id, ada.id, v); // played to the end; its finish never reached the server
    for (let i = 0; i < 30; i++) await start(lessonA.id, ada.id, v); // flaky connection: more games started
    const late = await finish(lessonA.id, ada.id, waiting.id, transcriptFor(game));
    expect(late.status).toBe(200);
    expect(late.body.attempt).toMatchObject({ id: waiting.id, score: 240 });
    expect((await summary(lessonA.id, ada.id)).finished_count).toBe(1);
  });
});

describe("gap 2: the result is stored but a later step fails, then the browser retries", () => {
  it("event logged, then the attempt-file write fails: the retry doesn't log the result again", async () => {
    const { lessonA, ada, game, v } = setup();
    const s = await start(lessonA.id, ada.id, v);
    const t = transcriptFor(game, reproducedLossPlan);
    // 1st attempt-file write (the finished result) succeeds, the 2nd (after logging the event) fails.
    let writes = 0;
    const attemptsFile = path.join(data.dir(), "game-attempts", ada.id, `${lessonA.id}.json`);
    const realWrite = fs.writeFileSync;
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (typeof file === "string" && file.startsWith(attemptsFile) && ++writes === 2) throw new Error("synthetic disk failure (ENOSPC)");
      return (realWrite as (...a: unknown[]) => void)(file, ...rest);
    }) as typeof fs.writeFileSync);
    const first = await finish(lessonA.id, ada.id, s.id, t);
    spy.mockRestore();
    expect(first.status).toBe(500); // the browser keeps the result and retries
    expect(gameEvents()).toHaveLength(1);

    const retry = await finish(lessonA.id, ada.id, s.id, t);
    expect(retry.status).toBe(200);
    expect(retry.body.attempt).toMatchObject({ score: 30, outcome: "game_over" });
    expect(gameEvents()).toHaveLength(1); // not logged twice
    const again = await finish(lessonA.id, ada.id, s.id, t);
    expect(again.status).toBe(200);
    expect(gameEvents()).toHaveLength(1);
  });

  it("the first write (the result itself) fails: nothing is logged, and the retry records it once", async () => {
    const { lessonA, ada, game, v } = setup();
    const s = await start(lessonA.id, ada.id, v);
    faults.failAttemptWrites = 1;
    const first = await finish(lessonA.id, ada.id, s.id, transcriptFor(game));
    expect(first.status).toBe(500);
    expect(faults.failed).toBe(1);
    expect(gameEvents()).toHaveLength(0);
    expect((await summary(lessonA.id, ada.id)).finished_count).toBe(0);
    const retry = await finish(lessonA.id, ada.id, s.id, transcriptFor(game));
    expect(retry.status).toBe(200);
    expect(gameEvents()).toHaveLength(1);
    expect((await summary(lessonA.id, ada.id)).finished_count).toBe(1);
  });

  it("the event was logged but its 'logged' mark is lost: every later retry still finds it", async () => {
    const { lessonA, ada, game, v } = setup();
    const s = await start(lessonA.id, ada.id, v);
    const t = transcriptFor(game);
    faults.failAttemptWrites = 0;
    // Let the result write succeed, fail every attempt-file write after it.
    let n = 0;
    const attemptsFile = path.join(data.dir(), "game-attempts", ada.id, `${lessonA.id}.json`);
    const realWrite = fs.writeFileSync;
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (typeof file === "string" && file.startsWith(attemptsFile) && ++n >= 2) throw new Error("synthetic disk failure");
      return (realWrite as (...a: unknown[]) => void)(file, ...rest);
    }) as typeof fs.writeFileSync);
    expect((await finish(lessonA.id, ada.id, s.id, t)).status).toBe(500);
    expect((await finish(lessonA.id, ada.id, s.id, t)).status).toBe(500); // disk still failing
    spy.mockRestore();
    expect((await finish(lessonA.id, ada.id, s.id, t)).status).toBe(200);
    expect(gameEvents()).toHaveLength(1);
  });
});
