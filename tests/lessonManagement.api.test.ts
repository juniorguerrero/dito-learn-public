import crypto from "crypto";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Every generator is spied on: editing, archiving and restoring must regenerate nothing.
vi.mock("@/lib/generators", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" ? vi.fn(v as (...a: unknown[]) => unknown) : v]));
});

import * as generators from "@/lib/generators";
import * as lessonRoute from "@/app/api/classrooms/[id]/lessons/[lessonId]/route";
import * as classroomRoute from "@/app/api/classrooms/[id]/route";
import * as classProgressRoute from "@/app/api/classrooms/[id]/progress/route";
import * as progressRoute from "@/app/api/lessons/[id]/progress/route";
import * as completeRoute from "@/app/api/lessons/[id]/progress/complete/route";
import * as eventsRoute from "@/app/api/events/route";
import * as generateRoute from "@/app/api/projects/[id]/generate/route";
import { getClassroom } from "@/lib/db";
import { getProject, saveProject } from "@/lib/store";
import { classroomLessons, studentLessonView } from "@/lib/lessons";
import { buildClassroomAnalytics, buildStudentDetail } from "@/lib/platform";
import { flashcardDeckKey } from "@/lib/progressShared";
import { mockMindMap } from "@/lib/mocks";
import { MAX_LESSON_SUMMARY_CHARS, MAX_LESSON_TITLE_CHARS } from "@/lib/lessonRules";
import { LessonProgress, Project } from "@/lib/types";
import { seedFixture, useTempDataDir } from "./fixtures";

const data = useTempDataDir();
const BASE = "http://localhost";
const generatorSpies = () => Object.values(generators).filter((f): f is ReturnType<typeof vi.fn> => vi.isMockFunction(f));
const generatorCalls = () => generatorSpies().reduce((n, f) => n + f.mock.calls.length, 0);

beforeEach(() => {
  generatorSpies().forEach((f) => f.mockClear());
});

it("the generator spies are real (so 'nothing regenerated' is a meaningful check)", () => {
  expect(generatorSpies().length).toBeGreaterThanOrEqual(9); // blueprint + 8 formats
});

// ---------- helpers ----------

async function patch(classroomId: string, lessonId: string, body: unknown, raw = false) {
  const req = new NextRequest(`${BASE}/api/classrooms/${classroomId}/lessons/${lessonId}`, {
    method: "PATCH",
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const res = await lessonRoute.PATCH(req, { params: { id: classroomId, lessonId } });
  return { status: res.status, body: (await res.json()) as { lesson?: { id: string; title: string; summary: string; archived_at: string | null }; changed?: boolean; error?: string; code?: string } };
}

async function classroomApi(classroomId: string) {
  const res = await classroomRoute.GET(new NextRequest(`${BASE}/x`), { params: { id: classroomId } });
  return (await res.json()) as { lessons: { id: string; title: string }[]; archived_lessons: { id: string; title: string }[] };
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function saveCards(lessonId: string, studentId: string, snapshot: Record<string, unknown>, rev: number) {
  const res = await progressRoute.PUT(new NextRequest(`${BASE}/x`, json("PUT", { student_id: studentId, rev, flashcards: snapshot })), { params: { id: lessonId } });
  return { status: res.status, body: await res.json() };
}
async function complete(lessonId: string, studentId: string, modality: string) {
  const res = await completeRoute.POST(new NextRequest(`${BASE}/x`, json("POST", { student_id: studentId, modality })), { params: { id: lessonId } });
  return { status: res.status, body: await res.json() };
}
async function progressOf(lessonId: string, studentId: string): Promise<LessonProgress> {
  const res = await progressRoute.GET(new NextRequest(`${BASE}/x?student_id=${studentId}`), { params: { id: lessonId } });
  return (await res.json()).progress;
}

/** sha256 of every file in the data dir. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(data.dir(), p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(data.dir());
  return out;
}
const lessonFile = (id: string) => path.join("projects", `${id}.json`);

/** Synthetic class with generated formats and real student progress on lesson A. */
async function seedWithProgress() {
  const s = seedFixture();
  saveProject({ ...s.lessonA, outputs: { ...s.lessonA.outputs, mindmap: mockMindMap(s.lessonA.blueprint) } });
  const deck_key = flashcardDeckKey(s.lessonA.outputs.flashcards);
  expect((await saveCards(s.lessonA.id, s.ada.id, { deck_key, current_index: 2, known: [0], review: [1] }, 1)).status).toBe(200);
  expect((await complete(s.lessonA.id, s.ada.id, "mindmap")).status).toBe(200);
  expect((await complete(s.lessonB.id, s.ben.id, "song")).status).toBe(200);
  return { ...s, deck_key, lessonA: getProject(s.lessonA.id)! };
}

const withoutMeta = (p: Project) => {
  const { metadata_updated_at: _m, archived_at: _a, blueprint, ...rest } = p;
  const { title: _t, summary: _s, ...bp } = blueprint;
  return { ...rest, blueprint: bp };
};

// ---------- editing ----------

describe("editing a lesson's title and summary", () => {
  it("changes only the title and summary; id, source, generated formats and progress are untouched, nothing regenerated", async () => {
    const { classroom, lessonA, ada, deck_key } = await seedWithProgress();
    const before = snapshot();
    const progressBefore = await progressOf(lessonA.id, ada.id);

    const r = await patch(classroom.id, lessonA.id, { title: "Light & Leaves — revised", summary: "How plants turn light into sugar.\n\nRevised by the teacher." });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ changed: true, lesson: { id: lessonA.id, title: "Light & Leaves — revised" } });

    const after = getProject(lessonA.id)!;
    expect(after.blueprint.title).toBe("Light & Leaves — revised");
    expect(after.blueprint.summary).toBe("How plants turn light into sugar.\n\nRevised by the teacher.");
    expect(after.metadata_updated_at).toEqual(expect.any(String));
    expect(withoutMeta(after)).toEqual(withoutMeta(lessonA)); // same id, source text, outputs, profile, other blueprint fields
    expect(flashcardDeckKey(after.outputs.flashcards)).toBe(deck_key);

    // Only the lesson file changed; progress, events, classroom, students are byte-identical.
    const now = snapshot();
    for (const [f, h] of Object.entries(before)) if (f !== lessonFile(lessonA.id)) expect(now[f], f).toBe(h);
    expect(Object.keys(now).sort()).toEqual(Object.keys(before).sort());
    expect(await progressOf(lessonA.id, ada.id)).toEqual(progressBefore);
    expect(generatorCalls()).toBe(0);
  });

  it("the edit is what every view shows, including after a fresh read (page refresh)", async () => {
    const { classroom, lessonA, ada } = await seedWithProgress();
    await patch(classroom.id, lessonA.id, { title: "Renamed lesson" });
    // Each of these reads from disk, like a reload would.
    expect((await classroomApi(classroom.id)).lessons.map((l) => l.title)).toContain("Renamed lesson");
    expect(classroomLessons(getClassroom(classroom.id)!).active.map((p) => p.blueprint.title)).toContain("Renamed lesson"); // teacher + student lists
    const view = studentLessonView(classroom.id, lessonA.id);
    expect(view.kind === "lesson" && view.project.blueprint.title).toBe("Renamed lesson"); // student lesson page
    expect(buildStudentDetail(classroom.id, ada.id)!.progress.find((p) => p.lesson_id === lessonA.id)!.title).toBe("Renamed lesson"); // teacher progress view
  });

  it("normalizes input and accepts the length limits exactly", async () => {
    const { classroom, lessonA } = seedFixture();
    let r = await patch(classroom.id, lessonA.id, { title: "  Two\nlines \t title  ", summary: "Para one.  \r\n\r\n\r\n\r\nPara two.\r\n" });
    expect(r.body.lesson).toMatchObject({ title: "Two lines title", summary: "Para one.\n\nPara two." });
    r = await patch(classroom.id, lessonA.id, { title: "T".repeat(MAX_LESSON_TITLE_CHARS), summary: "S".repeat(MAX_LESSON_SUMMARY_CHARS) });
    expect(r.status).toBe(200);
    expect(getProject(lessonA.id)!.blueprint.title).toHaveLength(120);
    expect(getProject(lessonA.id)!.blueprint.summary).toHaveLength(1000);
  });

  it("rejects invalid edits with a clear message and writes nothing", async () => {
    const { classroom, lessonA } = seedFixture();
    const before = snapshot();
    const cases: [unknown, string, RegExp][] = [
      [{}, "invalid_request", /Nothing to change/],
      [{ title: "" }, "invalid_title", /can't be empty/],
      [{ title: "   \n " }, "invalid_title", /can't be empty/],
      [{ title: "T".repeat(MAX_LESSON_TITLE_CHARS + 1) }, "invalid_title", /121 characters.*120 or fewer/],
      [{ title: 42 }, "invalid_title", /must be text/],
      [{ summary: "" }, "invalid_summary", /can't be empty/],
      [{ summary: "S".repeat(MAX_LESSON_SUMMARY_CHARS + 1) }, "invalid_summary", /1,001 characters.*1,000 or fewer/],
      [{ archived: "yes" }, "invalid_request", /true or false/],
      [{ title: "ok", subject: "Biology" }, "invalid_request", /Unknown field\(s\): subject/],
      [[], "invalid_request", /JSON object/],
      [null, "invalid_request", /JSON object/],
      [{ title: "Valid", summary: "" }, "invalid_summary", /can't be empty/], // all-or-nothing: the valid title isn't saved either
    ];
    for (const [body, code, message] of cases) {
      const r = await patch(classroom.id, lessonA.id, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.code).toBe(code);
      expect(r.body.error).toMatch(message);
    }
    const bad = await patch(classroom.id, lessonA.id, "{not json", true);
    expect(bad).toMatchObject({ status: 400, body: { code: "invalid_request" } });
    expect(snapshot()).toEqual(before);
  });

  it("saving unchanged values writes nothing", async () => {
    const { classroom, lessonA } = seedFixture();
    const file = path.join(data.dir(), lessonFile(lessonA.id));
    const bytes = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    const r = await patch(classroom.id, lessonA.id, { title: lessonA.blueprint.title, summary: lessonA.blueprint.summary, archived: false });
    expect(r.body.changed).toBe(false);
    expect(fs.readFileSync(file)).toEqual(bytes);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it("an edit made while a format is being generated keeps both", async () => {
    const { classroom, lessonB } = seedFixture();
    process.env.MOCK_GENERATION_DELAY_MS = "300";
    try {
      const gen = generateRoute.POST(new NextRequest(`${BASE}/x`, json("POST", { type: "mindmap" })), { params: { id: lessonB.id } });
      await new Promise((r) => setTimeout(r, 50)); // generation is in flight
      expect((await patch(classroom.id, lessonB.id, { title: "Edited during generation" })).status).toBe(200);
      expect((await gen).status).toBe(200);
    } finally {
      delete process.env.MOCK_GENERATION_DELAY_MS;
    }
    expect(vi.mocked(generators.generateMindMap)).toHaveBeenCalledTimes(1); // the spies do see generation
    const p = getProject(lessonB.id)!;
    expect(p.blueprint.title).toBe("Edited during generation");
    expect(p.outputs.mindmap).toBeDefined();
    expect(p.outputs.flashcards).toEqual(lessonB.outputs.flashcards);
  });
});

// ---------- archive / restore ----------

describe("archiving and restoring a lesson", () => {
  it("archive hides the lesson from active lists but keeps its place, content and progress", async () => {
    const { classroom, lessonA, lessonB, ada } = await seedWithProgress();
    const before = snapshot();
    const r = await patch(classroom.id, lessonA.id, { archived: true });
    expect(r).toMatchObject({ status: 200, body: { changed: true, lesson: { archived_at: expect.any(String) } } });

    const api = await classroomApi(classroom.id);
    expect(api.lessons.map((l) => l.id)).toEqual([lessonB.id]); // teacher active list + student list
    expect(api.archived_lessons.map((l) => l.id)).toEqual([lessonA.id]); // teacher's archived section
    expect(classroomLessons(getClassroom(classroom.id)!).active.map((p) => p.id)).toEqual([lessonB.id]);
    expect(getClassroom(classroom.id)!.lesson_ids).toEqual(["lesson-a", "lesson-b"]); // position kept

    // Only the lesson file changed (classroom, progress, events untouched).
    const now = snapshot();
    for (const [f, h] of Object.entries(before)) if (f !== lessonFile(lessonA.id)) expect(now[f], f).toBe(h);
    const archived = getProject(lessonA.id)!;
    expect(withoutMeta(archived)).toEqual(withoutMeta(lessonA));
    expect(archived.blueprint).toEqual(lessonA.blueprint);
    expect(generatorCalls()).toBe(0);

    // Student link → archived notice (not the lesson, not a 404).
    expect(studentLessonView(classroom.id, lessonA.id)).toMatchObject({ kind: "archived", title: lessonA.blueprint.title });
    // The student's saved progress is still there.
    expect((await progressOf(lessonA.id, ada.id)).completed).toHaveProperty("mindmap");
  });

  it("teachers keep the archived lesson's progress history, clearly labelled", async () => {
    const { classroom, lessonA, ada } = await seedWithProgress();
    const analyticsBefore = buildClassroomAnalytics(classroom.id);
    await patch(classroom.id, lessonA.id, { archived: true });

    const detail = buildStudentDetail(classroom.id, ada.id)!;
    const a = detail.progress.find((p) => p.lesson_id === lessonA.id)!;
    expect(a).toMatchObject({ archived: true, completed: ["mindmap"], flashcards: { known: 1, review: 1 } });
    expect(detail.progress.find((p) => p.lesson_id === "lesson-b")!.archived).toBe(false);
    const analyticsAfter = buildClassroomAnalytics(classroom.id);
    expect(analyticsAfter.completions).toBe(analyticsBefore.completions); // history isn't erased
    expect(analyticsAfter.modality_opens).toEqual(analyticsBefore.modality_opens);
  });

  it("students who already have the lesson open can keep saving progress", async () => {
    const { classroom, lessonA, ada, deck_key } = await seedWithProgress();
    await patch(classroom.id, lessonA.id, { archived: true });

    const saved = await saveCards(lessonA.id, ada.id, { deck_key, current_index: 4, known: [0, 3], review: [1] }, 2);
    expect(saved.status).toBe(200);
    expect(saved.body.applied).toBe(true);
    expect((await complete(lessonA.id, ada.id, "flashcards")).status).toBe(200);
    // The legacy event path used by older open tabs works too.
    const ev = await eventsRoute.POST(new NextRequest(`${BASE}/x`, json("POST", { classroom_id: classroom.id, student_id: ada.id, student_name: ada.name, lesson_id: lessonA.id, type: "modality_complete", modality: "song" })));
    expect(ev.status).toBe(200);

    const p = await progressOf(lessonA.id, ada.id);
    expect(p.flashcards).toMatchObject({ current_index: 4, known: [0, 3], review: [1] });
    expect(Object.keys(p.completed).sort()).toEqual(["flashcards", "mindmap", "song"]);
    expect(buildStudentDetail(classroom.id, ada.id)!.progress.find((x) => x.lesson_id === lessonA.id)).toMatchObject({ archived: true, completed: ["mindmap", "flashcards", "song"] });
  });

  it("restore brings it back in its original position, with everything saved meanwhile", async () => {
    const { classroom, lessonA, lessonB, ada, deck_key } = await seedWithProgress();
    await patch(classroom.id, lessonA.id, { archived: true });
    await saveCards(lessonA.id, ada.id, { deck_key, current_index: 3, known: [0, 2], review: [] }, 5);
    const r = await patch(classroom.id, lessonA.id, { archived: false });
    expect(r).toMatchObject({ status: 200, body: { changed: true, lesson: { archived_at: null } } });
    expect(getProject(lessonA.id)!.archived_at).toBeUndefined();

    expect((await classroomApi(classroom.id)).lessons.map((l) => l.id)).toEqual([lessonA.id, lessonB.id]); // original order
    expect(studentLessonView(classroom.id, lessonA.id).kind).toBe("lesson");
    const cp = await classProgressRoute.GET(new NextRequest(`${BASE}/x?student_id=${ada.id}`), { params: { id: classroom.id } });
    const mine = (await cp.json()).lessons.find((l: { lesson_id: string }) => l.lesson_id === lessonA.id);
    expect(mine).toMatchObject({ archived: false, completed: ["mindmap"], flashcards: { known: 2, review: 0 } });
    expect(withoutMeta(getProject(lessonA.id)!)).toEqual(withoutMeta(lessonA));
  });

  it("repeating archive or restore is a no-op, and cycles never duplicate or touch anything else", async () => {
    const { classroom, lessonA } = await seedWithProgress();
    const first = await patch(classroom.id, lessonA.id, { archived: true });
    const file = path.join(data.dir(), lessonFile(lessonA.id));
    const bytes = fs.readFileSync(file);
    const again = await patch(classroom.id, lessonA.id, { archived: true });
    expect(again.body.changed).toBe(false);
    expect(again.body.lesson!.archived_at).toBe(first.body.lesson!.archived_at); // original archive time kept
    expect(fs.readFileSync(file)).toEqual(bytes);

    await patch(classroom.id, lessonA.id, { archived: false });
    const restoredBytes = fs.readFileSync(file);
    expect((await patch(classroom.id, lessonA.id, { archived: false })).body.changed).toBe(false);
    expect(fs.readFileSync(file)).toEqual(restoredBytes);

    const others = () => Object.fromEntries(Object.entries(snapshot()).filter(([f]) => f !== lessonFile(lessonA.id)));
    const before = others();
    // Rapid repeated clicks: many requests at once, then several cycles.
    const burst = await Promise.all(Array.from({ length: 10 }, () => patch(classroom.id, lessonA.id, { archived: true })));
    expect(burst.filter((r) => r.body.changed)).toHaveLength(1);
    expect(new Set(burst.map((r) => r.body.lesson!.archived_at)).size).toBe(1);
    for (let i = 0; i < 5; i++) {
      await patch(classroom.id, lessonA.id, { archived: false });
      await patch(classroom.id, lessonA.id, { archived: true });
      await patch(classroom.id, lessonA.id, { archived: false });
    }
    expect(getClassroom(classroom.id)!.lesson_ids).toEqual(["lesson-a", "lesson-b"]);
    expect((await classroomApi(classroom.id)).lessons.map((l) => l.id)).toEqual(["lesson-a", "lesson-b"]);
    expect(others()).toEqual(before); // other lessons, other classroom, students, progress, events: byte-identical
    expect(generatorCalls()).toBe(0);
  });

  it("an archived lesson can still be edited and stays archived", async () => {
    const { classroom, lessonA } = seedFixture();
    await patch(classroom.id, lessonA.id, { archived: true });
    const r = await patch(classroom.id, lessonA.id, { summary: "Updated while archived." });
    expect(r.body.lesson).toMatchObject({ summary: "Updated while archived.", archived_at: expect.any(String) });
    expect(studentLessonView(classroom.id, lessonA.id).kind).toBe("archived");
  });
});

// ---------- isolation ----------

describe("isolation between classrooms", () => {
  it("a lesson can only be managed through its own classroom", async () => {
    const { classroom, otherClassroom, lessonA, lessonX } = await seedWithProgress();
    const before = snapshot();
    const attempts: [string, string, string][] = [
      [otherClassroom.id, lessonA.id, "lesson_not_found"], // class-2 URL, class-1 lesson
      [classroom.id, lessonX.id, "lesson_not_found"], // class-1 URL, class-2 lesson
      ["no-such-class", lessonA.id, "classroom_not_found"],
      [classroom.id, "no-such-lesson", "lesson_not_found"],
      [classroom.id, "..%2Fclassrooms%2Fclass-1", "lesson_not_found"],
    ];
    for (const [cid, lid, code] of attempts) {
      for (const body of [{ archived: true }, { title: "Hijacked" }]) {
        const r = await patch(cid, lid, body);
        expect(r.status, `${cid}/${lid}`).toBe(404);
        expect(r.body.code).toBe(code);
      }
      const g = await lessonRoute.GET(new NextRequest(`${BASE}/x`), { params: { id: cid, lessonId: lid } });
      expect(g.status).toBe(404);
    }
    expect(snapshot()).toEqual(before);
  });

  it("both sides must agree: a listed lesson that belongs to another classroom is refused", async () => {
    const { classroom, lessonX } = seedFixture();
    // Corrupt/legacy data: class-1 lists a class-2 lesson.
    const c = getClassroom(classroom.id)!;
    fs.writeFileSync(path.join(data.dir(), "classrooms", `${c.id}.json`), JSON.stringify({ ...c, lesson_ids: [...c.lesson_ids, lessonX.id] }));
    expect((await patch(classroom.id, lessonX.id, { archived: true })).status).toBe(404);
    expect(classroomLessons(getClassroom(classroom.id)!).active.map((p) => p.id)).not.toContain(lessonX.id);
    expect(getProject(lessonX.id)!.archived_at).toBeUndefined();
  });

  it("archiving in one classroom doesn't change another classroom's lists", async () => {
    const { classroom, otherClassroom, lessonA, lessonX, outsider } = await seedWithProgress();
    await complete(lessonX.id, outsider.id, "game");
    const otherBefore = await classroomApi(otherClassroom.id);
    await patch(classroom.id, lessonA.id, { archived: true });
    await patch(classroom.id, lessonA.id, { title: "Class 1 only" });
    expect(await classroomApi(otherClassroom.id)).toEqual(otherBefore);
    expect(getProject(lessonX.id)!.blueprint.title).toBe(lessonX.blueprint.title);
    expect(buildStudentDetail(otherClassroom.id, outsider.id)!.progress).toEqual([
      expect.objectContaining({ lesson_id: lessonX.id, archived: false, completed: ["game"] }),
    ]);
  });
});
