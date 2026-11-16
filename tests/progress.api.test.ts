import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as progressRoute from "@/app/api/lessons/[id]/progress/route";
import * as completeRoute from "@/app/api/lessons/[id]/progress/complete/route";
import * as eventsRoute from "@/app/api/events/route";
import * as analyticsRoute from "@/app/api/classrooms/[id]/analytics/route";
import * as studentDetailRoute from "@/app/api/classrooms/[id]/students/[studentId]/route";
import { getEvents, logEvent } from "@/lib/db";
import { saveProject } from "@/lib/store";
import { flashcardDeckKey } from "@/lib/progressShared";
import type { ClassroomAnalytics, StudentDetail } from "@/lib/platform";
import { LessonProgress, OutputType } from "@/lib/types";
import { seedFixture, useTempDataDir } from "./fixtures";

const data = useTempDataDir();
const URL_BASE = "http://localhost";

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

async function getProgress(lessonId: string, studentId?: string) {
  const qs = studentId === undefined ? "" : `?student_id=${encodeURIComponent(studentId)}`;
  const res = await progressRoute.GET(new NextRequest(`${URL_BASE}/api/lessons/${lessonId}/progress${qs}`), { params: { id: lessonId } });
  return { status: res.status, body: (await res.json()) as { progress: LessonProgress; error?: string } };
}

// Each call gets a newer revision unless one is given (like clicks in one tab).
let revCounter = 1000;
async function putFlashcards(lessonId: string, studentId: string, flashcards: unknown, rev: unknown = ++revCounter) {
  const req = new NextRequest(`${URL_BASE}/api/lessons/${lessonId}/progress`, { ...json({ student_id: studentId, rev, flashcards }), method: "PUT" });
  const res = await progressRoute.PUT(req, { params: { id: lessonId } });
  return { status: res.status, body: (await res.json()) as { progress: LessonProgress; applied: boolean; error?: string } };
}

async function complete(lessonId: string, studentId: string, modality: unknown) {
  const req = new NextRequest(`${URL_BASE}/api/lessons/${lessonId}/progress/complete`, json({ student_id: studentId, modality }));
  const res = await completeRoute.POST(req, { params: { id: lessonId } });
  return { status: res.status, body: (await res.json()) as { progress: LessonProgress; newly_completed: boolean; error?: string } };
}

async function postEvent(body: Record<string, unknown>) {
  const res = await eventsRoute.POST(new NextRequest(`${URL_BASE}/api/events`, json(body)));
  return { status: res.status, body: await res.json() };
}

async function analytics(classroomId: string): Promise<ClassroomAnalytics> {
  const res = await analyticsRoute.GET(new NextRequest(`${URL_BASE}/x`), { params: { id: classroomId } });
  return res.json();
}

async function detail(classroomId: string, studentId: string): Promise<StudentDetail> {
  const res = await studentDetailRoute.GET(new NextRequest(`${URL_BASE}/x`), { params: { id: classroomId, studentId } });
  return res.json();
}

const completionEvents = () => getEvents().filter((e) => e.type === "modality_complete");
const progressPath = (studentId: string, lessonId: string) => path.join(data.dir(), "progress", studentId, `${lessonId}.json`);

describe("restoring progress after leaving / refreshing", () => {
  it("starts empty for a student who hasn't studied the lesson yet", async () => {
    const { lessonA, ada } = seedFixture();
    const r = await getProgress(lessonA.id, ada.id);
    expect(r.status).toBe(200);
    expect(r.body.progress).toMatchObject({ student_id: ada.id, lesson_id: lessonA.id, completed: {}, flashcards: null });
    expect(fs.existsSync(progressPath(ada.id, lessonA.id))).toBe(false); // reads don't write
  });

  it("persists flashcard choices + card position and returns them on the next load", async () => {
    const { lessonA, ada } = seedFixture();
    const deck_key = flashcardDeckKey(lessonA.outputs.flashcards);
    const snapshot = { deck_key, current_index: 3, known: [0, 2], review: [1] };

    const saved = await putFlashcards(lessonA.id, ada.id, snapshot);
    expect(saved.status).toBe(200);

    // "Refresh": a brand-new request that can only be answered from disk.
    const restored = await getProgress(lessonA.id, ada.id);
    expect(restored.body.progress.flashcards).toEqual(snapshot);
    const onDisk = JSON.parse(fs.readFileSync(progressPath(ada.id, lessonA.id), "utf-8"));
    expect(onDisk.flashcards).toEqual(snapshot);

    // Later snapshots replace earlier ones (e.g. the student changed their mind on card 1).
    await putFlashcards(lessonA.id, ada.id, { deck_key, current_index: 4, known: [0, 1, 2], review: [] });
    expect((await getProgress(lessonA.id, ada.id)).body.progress.flashcards).toEqual({ deck_key, current_index: 4, known: [0, 1, 2], review: [] });
  });

  it("restores completed formats after a refresh", async () => {
    const { lessonA, ada } = seedFixture();
    await complete(lessonA.id, ada.id, "mindmap");
    await complete(lessonA.id, ada.id, "song");
    const restored = await getProgress(lessonA.id, ada.id);
    expect(Object.keys(restored.body.progress.completed).sort()).toEqual(["mindmap", "song"]);
  });

  it("keeps progress separate per student and per lesson", async () => {
    const { lessonA, lessonB, ada, ben } = seedFixture();
    const keyA = flashcardDeckKey(lessonA.outputs.flashcards);
    const keyB = flashcardDeckKey(lessonB.outputs.flashcards);
    await putFlashcards(lessonA.id, ada.id, { deck_key: keyA, current_index: 5, known: [1], review: [2] });
    await putFlashcards(lessonB.id, ada.id, { deck_key: keyB, current_index: 1, known: [0], review: [] });
    await putFlashcards(lessonA.id, ben.id, { deck_key: keyA, current_index: 2, known: [], review: [0, 1] });
    await complete(lessonA.id, ada.id, "game");

    const adaA = (await getProgress(lessonA.id, ada.id)).body.progress;
    const adaB = (await getProgress(lessonB.id, ada.id)).body.progress;
    const benA = (await getProgress(lessonA.id, ben.id)).body.progress;
    const benB = (await getProgress(lessonB.id, ben.id)).body.progress;

    expect(adaA.flashcards).toMatchObject({ current_index: 5, known: [1], review: [2] });
    expect(Object.keys(adaA.completed)).toEqual(["game"]);
    expect(adaB.flashcards).toMatchObject({ current_index: 1, known: [0], review: [] });
    expect(adaB.completed).toEqual({});
    expect(benA.flashcards).toMatchObject({ current_index: 2, known: [], review: [0, 1] });
    expect(benA.completed).toEqual({});
    expect(benB).toMatchObject({ flashcards: null, completed: {} });
  });

  it("flashcard saves and completions never clobber each other", async () => {
    const { lessonA, ada } = seedFixture();
    const deck_key = flashcardDeckKey(lessonA.outputs.flashcards);
    await putFlashcards(lessonA.id, ada.id, { deck_key, current_index: 2, known: [0], review: [1] });
    await complete(lessonA.id, ada.id, "flashcards");
    await putFlashcards(lessonA.id, ada.id, { deck_key, current_index: 3, known: [0, 2], review: [1] });

    const p = (await getProgress(lessonA.id, ada.id)).body.progress;
    expect(Object.keys(p.completed)).toEqual(["flashcards"]);
    expect(p.flashcards).toMatchObject({ current_index: 3, known: [0, 2], review: [1] });
  });
});

describe("each student/lesson/format completion counts once", () => {
  it("ignores repeated completion clicks, including after a refresh", async () => {
    const { classroom, lessonA, ada } = seedFixture();
    const first = await complete(lessonA.id, ada.id, "flashcards");
    const second = await complete(lessonA.id, ada.id, "flashcards");
    await getProgress(lessonA.id, ada.id); // refresh
    const third = await complete(lessonA.id, ada.id, "flashcards");

    expect(first.body.newly_completed).toBe(true);
    expect(second.body.newly_completed).toBe(false);
    expect(third.body.newly_completed).toBe(false);
    expect(third.body.progress.completed.flashcards).toBe(first.body.progress.completed.flashcards); // original timestamp kept
    expect(completionEvents()).toHaveLength(1);

    const a = await analytics(classroom.id);
    expect(a.completions).toBe(1);
    expect(a.modality_opens.find((m) => m.modality === "flashcards")!.completions).toBe(1);
    expect(a.per_student.find((s) => s.student_id === ada.id)!.completions).toBe(1);
  });

  it("counts exactly once when many requests arrive at the same time", async () => {
    const { classroom, lessonA, ada } = seedFixture();
    const results = await Promise.all(Array.from({ length: 25 }, () => complete(lessonA.id, ada.id, "podcast")));

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.newly_completed)).toHaveLength(1);
    expect(completionEvents()).toHaveLength(1);
    expect((await analytics(classroom.id)).completions).toBe(1);
  });

  it("the legacy /api/events completion path is idempotent too (and shares the same record)", async () => {
    const { classroom, lessonA, ada } = seedFixture();
    const body = { classroom_id: classroom.id, student_id: ada.id, student_name: "Spoofed Name", lesson_id: lessonA.id, type: "modality_complete", modality: "video" };

    const r1 = await postEvent(body);
    const r2 = await postEvent(body);
    const r3 = await complete(lessonA.id, ada.id, "video");
    expect(r1.body).toMatchObject({ ok: true, duplicate: false });
    expect(r2.body).toMatchObject({ ok: true, duplicate: true });
    expect(r3.body.newly_completed).toBe(false);

    const events = completionEvents();
    expect(events).toHaveLength(1);
    expect(events[0].student_name).toBe(ada.name); // taken from the student record, not the request
    expect((await getProgress(lessonA.id, ada.id)).body.progress.completed.video).toBeTruthy();
    expect((await analytics(classroom.id)).completions).toBe(1);
  });

  it("different formats, lessons and students are counted separately", async () => {
    const { classroom, lessonA, lessonB, ada, ben } = seedFixture();
    const plan: [string, string, OutputType][] = [
      [lessonA.id, ada.id, "flashcards"],
      [lessonA.id, ada.id, "game"],
      [lessonB.id, ada.id, "flashcards"],
      [lessonA.id, ben.id, "flashcards"],
    ];
    for (const [l, s, m] of plan) {
      await complete(l, s, m);
      await complete(l, s, m); // double click
    }

    const a = await analytics(classroom.id);
    expect(a.completions).toBe(4);
    expect(a.modality_opens.find((m) => m.modality === "flashcards")!.completions).toBe(3);
    expect(a.modality_opens.find((m) => m.modality === "game")!.completions).toBe(1);
    expect(a.per_student.find((s) => s.student_id === ada.id)!.completions).toBe(3);
    expect(a.per_student.find((s) => s.student_id === ben.id)!.completions).toBe(1);

    const d = await detail(classroom.id, ada.id);
    expect(d.totals.completions).toBe(3);
    expect(Object.fromEntries(d.lessons.map((l) => [l.lesson_id, l.completions]))).toEqual({ [lessonA.id]: 2, [lessonB.id]: 1 });
  });
});

describe("existing data", () => {
  it("de-duplicates legacy completion events in teacher totals without rewriting the log", async () => {
    const { classroom, lessonA, ada, ben } = seedFixture();
    const base = { classroom_id: classroom.id, lesson_id: lessonA.id, type: "modality_complete" as const };
    // Pre-existing log from before this change: the same click recorded 3x.
    for (let i = 0; i < 3; i++) logEvent({ ...base, student_id: ada.id, student_name: ada.name, modality: "song" });
    logEvent({ ...base, student_id: ben.id, student_name: ben.name, modality: "song" });
    logEvent({ ...base, type: "modality_open", student_id: ada.id, student_name: ada.name, modality: "song" });
    const before = fs.readFileSync(path.join(data.dir(), "events.jsonl"), "utf-8");

    const a = await analytics(classroom.id);
    expect(a.completions).toBe(2);
    expect(a.modality_opens.find((m) => m.modality === "song")).toMatchObject({ opens: 1, completions: 2 });
    expect(a.per_student.find((s) => s.student_id === ada.id)!.completions).toBe(1);
    const d = await detail(classroom.id, ada.id);
    expect(d.totals.completions).toBe(1);
    expect(d.modality_breakdown.find((m) => m.modality === "song")!.completions).toBe(1);

    expect(fs.readFileSync(path.join(data.dir(), "events.jsonl"), "utf-8")).toBe(before); // history untouched
  });

  it("carries legacy completions into the student's restored progress and doesn't count them again", async () => {
    const { classroom, lessonA, lessonB, ada } = seedFixture();
    logEvent({ classroom_id: classroom.id, lesson_id: lessonA.id, student_id: ada.id, student_name: ada.name, type: "modality_complete", modality: "story_slides" });

    expect(Object.keys((await getProgress(lessonA.id, ada.id)).body.progress.completed)).toEqual(["story_slides"]);
    expect((await getProgress(lessonB.id, ada.id)).body.progress.completed).toEqual({});

    const again = await complete(lessonA.id, ada.id, "story_slides");
    expect(again.body.newly_completed).toBe(false);
    expect(completionEvents()).toHaveLength(1);
  });

  it("never modifies lesson, classroom or student records", async () => {
    const { lessonA, ada, classroom } = seedFixture();
    const read = () =>
      ["projects", "classrooms", "students"].flatMap((d) =>
        fs.readdirSync(path.join(data.dir(), d)).map((f) => [`${d}/${f}`, fs.readFileSync(path.join(data.dir(), d, f), "utf-8")])
      );
    const before = read();

    await putFlashcards(lessonA.id, ada.id, { deck_key: flashcardDeckKey(lessonA.outputs.flashcards), current_index: 1, known: [0], review: [] });
    await complete(lessonA.id, ada.id, "mindmap");
    await postEvent({ classroom_id: classroom.id, student_id: ada.id, lesson_id: lessonA.id, type: "modality_complete", modality: "song" });
    await analytics(classroom.id);

    expect(read()).toEqual(before);
  });

  it("other event types are still logged as before", async () => {
    const { classroom, lessonA, ada } = seedFixture();
    for (let i = 0; i < 2; i++) {
      const r = await postEvent({ classroom_id: classroom.id, student_id: ada.id, student_name: ada.name, lesson_id: lessonA.id, type: "modality_open", modality: "game" });
      expect(r.status).toBe(200);
    }
    expect(getEvents().filter((e) => e.type === "modality_open")).toHaveLength(2); // opens are activity, not de-duplicated
  });
});

describe("save ordering: snapshots that arrive out of order never roll progress back", () => {
  const snap = (deck_key: string, current_index: number, known: number[], review: number[] = []) => ({ deck_key, current_index, known, review });

  it("ignores an older snapshot that arrives after a newer one", async () => {
    const { lessonA, ada } = seedFixture();
    const k = flashcardDeckKey(lessonA.outputs.flashcards);
    // The student clicked twice (rev 10 then rev 11) but the network delivered 11 first.
    const newer = await putFlashcards(lessonA.id, ada.id, snap(k, 2, [0], [1]), 11);
    const older = await putFlashcards(lessonA.id, ada.id, snap(k, 1, [0]), 10);

    expect(newer.body.applied).toBe(true);
    expect(older.status).toBe(200);
    expect(older.body.applied).toBe(false);
    expect(older.body.progress.flashcards).toEqual(snap(k, 2, [0], [1])); // tells the client what's stored
    const p = (await getProgress(lessonA.id, ada.id)).body.progress;
    expect(p.flashcards).toEqual(snap(k, 2, [0], [1]));
    expect(p.flashcards_rev).toBe(11);
  });

  it("treats a re-sent snapshot (same revision) as a harmless duplicate", async () => {
    const { lessonA, ada } = seedFixture();
    const k = flashcardDeckKey(lessonA.outputs.flashcards);
    expect((await putFlashcards(lessonA.id, ada.id, snap(k, 1, [0]), 5)).body.applied).toBe(true);
    const file = progressPath(ada.id, lessonA.id);
    const before = fs.readFileSync(file, "utf-8");
    expect((await putFlashcards(lessonA.id, ada.id, snap(k, 1, [0]), 5)).body.applied).toBe(false);
    expect(fs.readFileSync(file, "utf-8")).toBe(before); // not even rewritten
  });

  it("the highest revision wins whatever order concurrent requests are processed in", async () => {
    const { lessonA, ada } = seedFixture();
    const k = flashcardDeckKey(lessonA.outputs.flashcards);
    const n = lessonA.outputs.flashcards!.cards.length;
    // 40 successive snapshots from one study session: rev i has answered cards 0..i-1.
    const snaps = Array.from({ length: 40 }, (_, i) => ({ rev: 100 + i, fc: snap(k, (i + 1) % n, Array.from({ length: Math.min(i, n) }, (_, j) => j)) }));
    for (let round = 0; round < 5; round++) {
      const shuffled = [...snaps].sort(() => Math.random() - 0.5);
      await Promise.all(shuffled.map((x) => putFlashcards(lessonA.id, ada.id, x.fc, x.rev + round * 1000)));
      const p = (await getProgress(lessonA.id, ada.id)).body.progress;
      const last = snaps[snaps.length - 1];
      expect(p.flashcards_rev).toBe(last.rev + round * 1000);
      expect(p.flashcards).toEqual(last.fc);
    }
  });

  it("a completion arriving between flashcard saves doesn't disturb the revision", async () => {
    const { lessonA, ada } = seedFixture();
    const k = flashcardDeckKey(lessonA.outputs.flashcards);
    await putFlashcards(lessonA.id, ada.id, snap(k, 1, [0]), 20);
    await complete(lessonA.id, ada.id, "flashcards");
    expect((await putFlashcards(lessonA.id, ada.id, snap(k, 0, []), 19)).body.applied).toBe(false);
    const p = (await getProgress(lessonA.id, ada.id)).body.progress;
    expect(p).toMatchObject({ flashcards_rev: 20, flashcards: snap(k, 1, [0]) });
    expect(Object.keys(p.completed)).toEqual(["flashcards"]);
  });

  it("accepts saves onto a progress file written before revisions existed", async () => {
    const { lessonA, ada } = seedFixture();
    const k = flashcardDeckKey(lessonA.outputs.flashcards);
    fs.mkdirSync(path.dirname(progressPath(ada.id, lessonA.id)), { recursive: true });
    fs.writeFileSync(
      progressPath(ada.id, lessonA.id),
      JSON.stringify({ student_id: ada.id, lesson_id: lessonA.id, classroom_id: "class-1", completed: { song: "2024-01-01T00:00:00.000Z" }, flashcards: snap(k, 3, [0, 1]), created_at: "x", updated_at: "x" })
    );
    expect((await getProgress(lessonA.id, ada.id)).body.progress.flashcards_rev).toBe(0);
    expect((await putFlashcards(lessonA.id, ada.id, snap(k, 4, [0, 1, 3]), 1)).body.applied).toBe(true);
    const p = (await getProgress(lessonA.id, ada.id)).body.progress;
    expect(p).toMatchObject({ flashcards_rev: 1, flashcards: snap(k, 4, [0, 1, 3]), completed: { song: "2024-01-01T00:00:00.000Z" } });
  });

  it("rejects a snapshot with no rev", async () => {
    const { lessonA, ada } = seedFixture();
    const flashcards = snap(flashcardDeckKey(lessonA.outputs.flashcards), 0, []);
    const req = new NextRequest(`${URL_BASE}/api/lessons/${lessonA.id}/progress`, { ...json({ student_id: ada.id, flashcards }), method: "PUT" });
    expect((await progressRoute.PUT(req, { params: { id: lessonA.id } })).status).toBe(400);
  });

  it.each([[null], [0], [-5], [1.5], ["7"], [Number.MAX_SAFE_INTEGER + 2]])("rejects rev=%s", async (rev) => {
    const { lessonA, ada } = seedFixture();
    const r = await putFlashcards(lessonA.id, ada.id, snap(flashcardDeckKey(lessonA.outputs.flashcards), 0, []), rev);
    expect(r.status).toBe(400);
    expect(fs.existsSync(progressPath(ada.id, lessonA.id))).toBe(false);
  });
});

describe("flashcard deck changes", () => {
  it("rejects a snapshot made against a different deck", async () => {
    const { lessonA, ada } = seedFixture();
    const r = await putFlashcards(lessonA.id, ada.id, { deck_key: "stale-deck", current_index: 0, known: [], review: [] });
    expect(r.status).toBe(409);
    expect(fs.existsSync(progressPath(ada.id, lessonA.id))).toBe(false);
  });

  it("drops saved card positions when the deck is regenerated but keeps completions", async () => {
    const { lessonA, ada } = seedFixture();
    await putFlashcards(lessonA.id, ada.id, { deck_key: flashcardDeckKey(lessonA.outputs.flashcards), current_index: 3, known: [0], review: [1] });
    await complete(lessonA.id, ada.id, "flashcards");

    const regenerated = structuredClone(lessonA);
    regenerated.outputs.flashcards!.cards = regenerated.outputs.flashcards!.cards.slice(0, 4).reverse();
    saveProject(regenerated);

    const p = (await getProgress(lessonA.id, ada.id)).body.progress;
    expect(p.flashcards).toBeNull();
    expect(Object.keys(p.completed)).toEqual(["flashcards"]);
  });

  it("returns 409 when the lesson has no flashcards yet", async () => {
    const { lessonA, ada } = seedFixture();
    saveProject({ ...lessonA, outputs: {} });
    const r = await putFlashcards(lessonA.id, ada.id, { deck_key: flashcardDeckKey(undefined), current_index: 0, known: [], review: [] });
    expect(r.status).toBe(409);
  });
});

describe("validation", () => {
  it.each([
    ["missing student", undefined, 400],
    ["path traversal", "../students/x", 400],
    ["unknown student", "student-ghost", 404],
    ["student from another class", "student-out", 403],
  ])("GET rejects %s", async (_label, studentId, status) => {
    const { lessonA } = seedFixture();
    expect((await getProgress(lessonA.id, studentId)).status).toBe(status);
  });

  it("rejects unknown lessons and lessons outside the student's class", async () => {
    const { lessonX, ada } = seedFixture();
    expect((await getProgress("lesson-ghost", ada.id)).status).toBe(404);
    expect((await getProgress(lessonX.id, ada.id)).status).toBe(403);
  });

  it("rejects malformed flashcard snapshots without writing", async () => {
    const { lessonA, ada } = seedFixture();
    const deck_key = flashcardDeckKey(lessonA.outputs.flashcards);
    const n = lessonA.outputs.flashcards!.cards.length;
    for (const bad of [
      { deck_key, current_index: n, known: [], review: [] },
      { deck_key, current_index: 0, known: [n + 5], review: [] },
      { deck_key, current_index: 0, known: [1], review: [1] },
      { deck_key, current_index: 0 },
    ]) {
      expect((await putFlashcards(lessonA.id, ada.id, bad)).status).toBe(400);
    }
    expect(fs.existsSync(progressPath(ada.id, lessonA.id))).toBe(false);
  });

  it("rejects invalid completions without logging anything", async () => {
    const { classroom, otherClassroom, lessonA, lessonX, ada, outsider } = seedFixture();
    expect((await complete(lessonA.id, ada.id, "dance")).status).toBe(400);
    expect((await complete(lessonA.id, ada.id, undefined)).status).toBe(400);
    expect((await complete(lessonA.id, outsider.id, "game")).status).toBe(403);
    expect((await complete(lessonX.id, ada.id, "game")).status).toBe(403);
    expect((await complete(lessonA.id, "student-ghost", "game")).status).toBe(404);

    // Legacy route: lesson must match the classroom it claims to be in, and needs a lesson.
    expect((await postEvent({ classroom_id: otherClassroom.id, student_id: ada.id, lesson_id: lessonA.id, type: "modality_complete", modality: "game" })).status).toBe(400);
    expect((await postEvent({ classroom_id: classroom.id, student_id: ada.id, type: "modality_complete", modality: "game" })).status).toBe(400);

    expect(completionEvents()).toHaveLength(0);
    expect(fs.existsSync(path.join(data.dir(), "progress"))).toBe(false);
  });

  it("treats an unreadable progress file as empty and keeps it aside", async () => {
    const { lessonA, ada } = seedFixture();
    fs.mkdirSync(path.dirname(progressPath(ada.id, lessonA.id)), { recursive: true });
    fs.writeFileSync(progressPath(ada.id, lessonA.id), "{ not json");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await getProgress(lessonA.id, ada.id);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
    expect(r.status).toBe(200);
    expect(r.body.progress.completed).toEqual({});
    const kept = fs.readdirSync(path.dirname(progressPath(ada.id, lessonA.id))).filter((f) => f.includes(".corrupt-"));
    expect(kept).toHaveLength(1);
  });
});
