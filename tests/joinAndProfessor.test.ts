import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import * as studentsRoute from "@/app/api/students/route";
import * as progressRoute from "@/app/api/lessons/[id]/progress/route";
import * as completeRoute from "@/app/api/lessons/[id]/progress/complete/route";
import * as studentDetailRoute from "@/app/api/classrooms/[id]/students/[studentId]/route";
import * as classroomRoute from "@/app/api/classrooms/[id]/route";
import * as seedRoute from "@/app/api/seed/route";
import { getStudent, listClassrooms, logEvent, normalizeJoinCode } from "@/lib/db";
import { saveProject } from "@/lib/store";
import { joinClass, JoinError } from "@/lib/joinClass";
import { KeyValueStorage, loadLocalFlashcards, localFlashcardsKey, saveLocalFlashcards } from "@/lib/localProgress";
import { flashcardDeckKey } from "@/lib/progressShared";
import type { StudentDetail } from "@/lib/platform";
import { seedFixture, useTempDataDir } from "./fixtures";

const data = useTempDataDir();
const BASE = "http://localhost";

// A fetch that goes straight to the real /api/students route handlers.
const routeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const req = new NextRequest(BASE + url, init as ConstructorParameters<typeof NextRequest>[1]);
  if (init?.method === "POST") return studentsRoute.POST(req);
  if (init?.method === "PATCH") return studentsRoute.PATCH(req);
  throw new Error("unexpected " + init?.method);
};

const join = (o: Partial<Parameters<typeof joinClass>[0]> & { joinCode: string }) =>
  joinClass({ remembered: null, name: "", interests: [], ...o }, routeFetch);

describe("students joining with a class code", () => {
  it("normalizes codes the way students type them", () => {
    expect(normalizeJoinCode(" test01 ")).toBe("TEST01");
    expect(normalizeJoinCode("tes t01")).toBe("TEST01");
    expect(normalizeJoinCode("TES-T01")).toBe("TEST01");
    expect(normalizeJoinCode(42)).toBe("");
  });

  it.each(["TEST01", "test01", " Test01 ", "TES T01", "tes-t01"])("a new student can join with %j", async (code) => {
    const { classroom } = seedFixture();
    const r = await join({ name: "Nina New", joinCode: code, interests: ["Art"] });
    expect(r.classroom_id).toBe(classroom.id);
    expect(r.recreated).toBe(false);
    const saved = getStudent(r.student.id)!;
    expect(saved).toMatchObject({ name: "Nina New", interests: ["Art"], classroom_ids: [classroom.id] });
  });

  it("a returning student joins another class without retyping their name, keeping their progress", async () => {
    const { classroom, otherClassroom, lessonA, ada } = seedFixture();
    await completeRoute.POST(
      new NextRequest(`${BASE}/x`, { method: "POST", body: JSON.stringify({ student_id: ada.id, modality: "song" }) }),
      { params: { id: lessonA.id } }
    );

    const r = await join({ remembered: { id: ada.id, name: ada.name }, name: "", joinCode: otherClassroom.join_code.toLowerCase() });
    expect(r).toEqual({ student: { id: ada.id, name: ada.name }, classroom_id: otherClassroom.id, recreated: false });
    expect(getStudent(ada.id)!.classroom_ids).toEqual([classroom.id, otherClassroom.id]);

    const res = await progressRoute.GET(new NextRequest(`${BASE}/x?student_id=${ada.id}`), { params: { id: lessonA.id } });
    expect(Object.keys((await res.json()).progress.completed)).toEqual(["song"]); // same identity, same progress
  });

  it("joining a class you're already in is fine (no duplicate enrollment)", async () => {
    const { classroom, ada } = seedFixture();
    const r = await join({ remembered: { id: ada.id, name: ada.name }, joinCode: classroom.join_code });
    expect(r.classroom_id).toBe(classroom.id);
    expect(getStudent(ada.id)!.classroom_ids).toEqual([classroom.id]);
  });

  it("a browser remembering a student the server no longer has can still join (new profile)", async () => {
    const { classroom } = seedFixture();
    const stale = { id: "deleted-student-1234", name: "Old Me" };

    const typed = await join({ remembered: stale, name: "Dani", joinCode: classroom.join_code });
    expect(typed.recreated).toBe(true);
    expect(typed.student.id).not.toBe(stale.id);
    expect(getStudent(typed.student.id)).toMatchObject({ name: "Dani", classroom_ids: [classroom.id] });

    const untyped = await join({ remembered: stale, name: "  ", joinCode: classroom.join_code });
    expect(getStudent(untyped.student.id)!.name).toBe("Old Me"); // falls back to the remembered name
  });

  it("a wrong code gives a clear error and never creates or changes a student", async () => {
    const { ada } = seedFixture();
    const before = fs.readdirSync(path.join(data.dir(), "students")).length;
    await expect(join({ name: "Zed", joinCode: "NOPE99" })).rejects.toThrow("No classroom found for that join code");
    await expect(join({ remembered: { id: ada.id, name: ada.name }, joinCode: "NOPE99" })).rejects.toThrow("No classroom found");
    await expect(join({ name: "Zed", joinCode: "   " })).rejects.toThrow(/join code/);
    await expect(join({ name: "  ", joinCode: "TEST01" })).rejects.toThrow("What's your name?");
    expect(fs.readdirSync(path.join(data.dir(), "students")).length).toBe(before);
    expect(getStudent(ada.id)!.classroom_ids).toEqual(["class-1"]);
  });

  it("network failures and non-JSON responses (e.g. the static demo) give a readable error", async () => {
    const offline = () => Promise.reject(new TypeError("Failed to fetch"));
    await expect(joinClass({ remembered: null, name: "A", joinCode: "X", interests: [] }, offline)).rejects.toThrow(/Couldn't reach the server/);
    const html = async () => new Response("<!doctype html>", { status: 404 });
    const err = await joinClass({ remembered: null, name: "A", joinCode: "X", interests: [] }, html).catch((e) => e);
    expect(err).toBeInstanceOf(JoinError);
    expect(err.message).toBe("Couldn't join the class");
  });
});

describe("professor: seeing each student's saved progress", () => {
  async function detail(classroomId: string, studentId: string): Promise<StudentDetail> {
    const res = await studentDetailRoute.GET(new NextRequest(`${BASE}/x`), { params: { id: classroomId, studentId } });
    return res.json();
  }
  const put = (lessonId: string, studentId: string, flashcards: unknown, rev: number) =>
    progressRoute.PUT(new NextRequest(`${BASE}/x`, { method: "PUT", body: JSON.stringify({ student_id: studentId, rev, flashcards }) }), { params: { id: lessonId } });
  const done = (lessonId: string, studentId: string, modality: string) =>
    completeRoute.POST(new NextRequest(`${BASE}/x`, { method: "POST", body: JSON.stringify({ student_id: studentId, modality }) }), { params: { id: lessonId } });

  it("shows completed formats and flashcard progress per lesson, and 'not started' lessons", async () => {
    const { classroom, lessonA, lessonB, ada, ben } = seedFixture();
    const total = lessonA.outputs.flashcards!.cards.length;
    await put(lessonA.id, ada.id, { deck_key: flashcardDeckKey(lessonA.outputs.flashcards), current_index: 3, known: [0, 1], review: [2] }, 1);
    await done(lessonA.id, ada.id, "flashcards");
    await done(lessonA.id, ada.id, "game");
    await done(lessonA.id, ben.id, "song"); // someone else's progress must not leak in

    const d = await detail(classroom.id, ada.id);
    expect(d.progress).toEqual([
      { lesson_id: lessonA.id, title: lessonA.blueprint.title, archived: false, completed: ["flashcards", "game"], flashcards: { known: 2, review: 1, total }, updated_at: expect.any(String) },
      { lesson_id: lessonB.id, title: lessonB.blueprint.title, archived: false, completed: [], flashcards: null, updated_at: null },
    ]);
  });

  it("includes completions recorded before progress was saved, and hides positions on a regenerated deck", async () => {
    const { classroom, lessonA, ada } = seedFixture();
    logEvent({ classroom_id: classroom.id, lesson_id: lessonA.id, student_id: ada.id, student_name: ada.name, type: "modality_complete", modality: "video" });
    expect((await detail(classroom.id, ada.id)).progress[0].completed).toEqual(["video"]);

    await put(lessonA.id, ada.id, { deck_key: flashcardDeckKey(lessonA.outputs.flashcards), current_index: 1, known: [0], review: [] }, 1);
    saveProject({ ...lessonA, outputs: { flashcards: { cards: lessonA.outputs.flashcards!.cards.slice(0, 3) } } });
    expect((await detail(classroom.id, ada.id)).progress[0]).toMatchObject({ completed: ["video"], flashcards: null });
  });

  it("the classroom roster API lists students who joined after the page loaded", async () => {
    const { classroom } = seedFixture();
    const r = await join({ name: "Late Joiner", joinCode: classroom.join_code });
    const res = await classroomRoute.GET(new NextRequest(`${BASE}/x`), { params: { id: classroom.id } });
    const names = (await res.json()).students.map((s: { name: string }) => s.name);
    expect(names).toContain("Late Joiner");
    expect(r.classroom_id).toBe(classroom.id);
  });
});

describe("professor: practice progress kept in the browser", () => {
  const memoryStorage = (): KeyValueStorage & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  };
  const fc = { deck_key: "10-abc", current_index: 4, known: [0, 1, 3], review: [2] };

  it("saves and restores per lesson", () => {
    const s = memoryStorage();
    expect(saveLocalFlashcards(s, "lesson-a", fc)).toBe(true);
    expect(loadLocalFlashcards(s, "lesson-a")).toEqual(fc);
    expect(loadLocalFlashcards(s, "lesson-b")).toBeNull();
  });

  it("ignores corrupt values and survives storage that throws", () => {
    const s = memoryStorage();
    s.map.set(localFlashcardsKey("lesson-a"), "{broken");
    expect(loadLocalFlashcards(s, "lesson-a")).toBeNull();
    s.map.set(localFlashcardsKey("lesson-a"), JSON.stringify({ deck_key: "x" }));
    expect(loadLocalFlashcards(s, "lesson-a")).toBeNull();

    const full: KeyValueStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
    expect(saveLocalFlashcards(full, "lesson-a", fc)).toBe(false);
    expect(loadLocalFlashcards(full, "lesson-a")).toBeNull();
    expect(loadLocalFlashcards(null, "lesson-a")).toBeNull();
  });
});

describe("Load demo keeps everyone's data", () => {
  it("adds the demo next to existing classes and doesn't duplicate it on a second click", async () => {
    const { classroom, lessonA, ada } = seedFixture();
    await done(lessonA.id, ada.id, "song");
    const snapshot = () =>
      ["classrooms", "projects", "students", "progress/student-ada"].map((d) =>
        fs.readdirSync(path.join(data.dir(), d)).sort().map((f) => [f, fs.readFileSync(path.join(data.dir(), d, f), "utf-8")])
      );
    const mine = snapshot()
      .map((files, i) => (i === 0 ? files.filter(([f]) => f.startsWith("class-")) : files));
    const events = fs.readFileSync(path.join(data.dir(), "events.jsonl"), "utf-8");

    const first = await (await seedRoute.POST()).json();
    expect(first.ok).toBe(true);
    const second = await (await seedRoute.POST()).json();
    expect(second).toMatchObject({ ok: true, existing: true, classroom_id: first.classroom_id });

    // Original data is byte-for-byte intact, events were only appended to.
    const after = snapshot();
    for (const [f, body] of mine[0]) expect(after[0]).toContainEqual([f, body]);
    for (const i of [1, 2, 3]) for (const entry of mine[i]) expect(after[i]).toContainEqual(entry);
    expect(fs.readFileSync(path.join(data.dir(), "events.jsonl"), "utf-8").startsWith(events)).toBe(true);

    expect(listClassrooms().filter((c) => c.is_demo)).toHaveLength(1);
    expect(listClassrooms().map((c) => c.id)).toEqual(expect.arrayContaining([classroom.id, "class-2", first.classroom_id]));
    expect(normalizeJoinCode(first.join_code)).not.toBe(classroom.join_code);
  }, 30000);

  async function done(lessonId: string, studentId: string, modality: string) {
    await completeRoute.POST(new NextRequest(`${BASE}/x`, { method: "POST", body: JSON.stringify({ student_id: studentId, modality }) }), { params: { id: lessonId } });
  }
});
