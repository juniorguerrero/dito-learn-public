import crypto from "crypto";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Spy on blueprint creation: rejected uploads must never reach it.
vi.mock("@/lib/generators", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generators")>();
  return { ...actual, createLearningBlueprint: vi.fn(actual.createLearningBlueprint) };
});

import * as uploadRoute from "@/app/api/upload/route";
import * as lessonsRoute from "@/app/api/classrooms/[id]/lessons/route";
import { createLearningBlueprint } from "@/lib/generators";
import { getClassroom } from "@/lib/db";
import { getProject, listProjects } from "@/lib/store";
import { recordCompletion } from "@/lib/progress";
import { MAX_LESSON_TEXT_CHARS, MAX_REQUEST_BYTES, MAX_UPLOAD_BYTES, normalizeLessonText } from "@/lib/uploadRules";
import { Classroom } from "@/lib/types";
import { seedFixture, useTempDataDir } from "./fixtures";
import { REJECTED, VALID, readFixture } from "./documentFixtureCases";
import { buildPaddedDocx, parseSource } from "../scripts/generate-document-fixtures.mjs";

const data = useTempDataDir();
const blueprintSpy = vi.mocked(createLearningBlueprint);

// ---------- helpers ----------

type Part = { name: string; bytes: Uint8Array };
interface Submission {
  file?: Part | Part[];
  text?: string;
  fields?: Record<string, string>;
}

function formRequest(url: string, s: Submission): NextRequest {
  const fd = new FormData();
  const files = s.file === undefined ? [] : Array.isArray(s.file) ? s.file : [s.file];
  for (const f of files) fd.append("file", new File([f.bytes as Uint8Array<ArrayBuffer>], f.name));
  if (s.text !== undefined) fd.append("text", s.text);
  for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
  return new NextRequest(url, { method: "POST", body: fd });
}

const ROUTES = [
  { name: "POST /api/upload", call: (req: NextRequest) => uploadRoute.POST(req), url: "http://localhost/api/upload", attaches: false },
  {
    name: "POST /api/classrooms/[id]/lessons",
    call: (req: NextRequest) => lessonsRoute.POST(req, { params: { id: "class-1" } }),
    url: "http://localhost/api/classrooms/class-1/lessons",
    attaches: true,
  },
] as const;

async function send(route: (typeof ROUTES)[number], s: Submission | NextRequest) {
  const req = s instanceof NextRequest ? s : formRequest(route.url, s);
  const res = await route.call(req);
  return { status: res.status, body: (await res.json()) as { error?: string; code?: string; id?: string; lesson?: { id: string; title: string } } };
}

/** Every file in the data dir with a content hash. */
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

const newLessonId = (r: Awaited<ReturnType<typeof send>>) => r.body.id ?? r.body.lesson?.id ?? "";

/** Existing data that must survive every upload untouched: classrooms, lessons, students, progress, events. */
function seedExistingData() {
  const seeded = seedFixture();
  recordCompletion(seeded.ada.id, seeded.lessonA.id, "flashcards");
  return seeded;
}

beforeEach(() => {
  blueprintSpy.mockClear(); // (block body: a returned function would run as a teardown hook)
});

// ---------- both routes, same rules ----------

describe.each(ROUTES)("$name", (route) => {
  beforeEach(() => {
    seedExistingData(); // every test starts with existing classrooms, lessons, students, progress and events
  });

  for (const { file, title, phrases, chars } of VALID) {
    it(`accepts ${file}, stores its text, and changes nothing else`, async () => {
      const { classroom } = seedExistingData();
      const before = snapshot();
      const r = await send(route, { file: { name: file, bytes: readFixture(file) } });
      expect(r.status).toBe(200);

      const lesson = getProject(newLessonId(r))!;
      expect(lesson.source_name).toBe(file);
      expect(lesson.document_text.startsWith(title)).toBe(true);
      for (const p of phrases) expect(lesson.document_text).toContain(p);
      expect(lesson.document_text).not.toMatch(/\uFFFD|-- \d+ of \d+ --/);
      if (chars !== undefined) expect(lesson.document_text).toHaveLength(chars); // nothing cut, nothing lost
      expect(blueprintSpy).toHaveBeenCalledTimes(1);
      expect(blueprintSpy.mock.calls[0][0]).toBe(lesson.document_text); // the blueprint sees all of it

      // Only additions: the new lesson file, plus (lessons route) the class's lesson list.
      const after = snapshot();
      const classFile = path.join("classrooms", `${classroom.id}.json`);
      for (const [f, hash] of Object.entries(before)) {
        if (route.attaches && f === classFile) continue;
        expect(after[f], f).toBe(hash);
      }
      expect(Object.keys(after).length).toBe(Object.keys(before).length + 1);
      const cls = getClassroom(classroom.id)!;
      expect(cls.lesson_ids).toEqual(route.attaches ? [...classroom.lesson_ids, lesson.id] : classroom.lesson_ids);
      expect(lesson.classroom_id).toBe(route.attaches ? classroom.id : undefined);
    }, 30_000);
  }

  for (const { file, code, mentions } of REJECTED) {
    it(`rejects ${file} (${code}) without creating or changing anything`, async () => {
      seedExistingData();
      const before = snapshot();
      const r = await send(route, { file: { name: file, bytes: readFixture(file) } });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(r.body.code).toBe(code);
      expect(r.body.error).toMatch(mentions);
      expect(snapshot()).toEqual(before);
      expect(blueprintSpy).not.toHaveBeenCalled();
    }, 30_000);
  }

  describe("pasted text", () => {
    it("is accepted and stored (normalized) when no file is sent", async () => {
      seedExistingData();
      const text = "Tide Pools of the Glass Coast\r\n\r\n\r\n\r\nBarnacles, anemones and periwinkles live between the tides.   \r\nZoë counts 12 °C at dawn.";
      const r = await send(route, { text, fields: { grade_level: "College" } });
      expect(r.status).toBe(200);
      const lesson = getProject(newLessonId(r))!;
      expect(lesson.document_text).toBe(normalizeLessonText(text));
      expect(lesson.document_text).toBe("Tide Pools of the Glass Coast\n\nBarnacles, anemones and periwinkles live between the tides.\nZoë counts 12 °C at dawn.");
      expect(lesson.source_name).toMatch(/^Pasted/);
      expect(lesson.student_profile.grade_level).toBe("College");
    });

    it("length boundaries: 49 rejected, 50 accepted, 60,000 accepted, 60,001 rejected", async () => {
      seedExistingData();
      expect((await send(route, { text: "a".repeat(49) })).body.code).toBe("too_short");
      expect((await send(route, { text: "a".repeat(50) })).status).toBe(200);
      const atLimit = await send(route, { text: "b".repeat(MAX_LESSON_TEXT_CHARS) });
      expect(atLimit.status).toBe(200);
      expect(getProject(newLessonId(atLimit))!.document_text).toHaveLength(MAX_LESSON_TEXT_CHARS); // nothing cut
      const before = snapshot();
      const over = await send(route, { text: "c".repeat(MAX_LESSON_TEXT_CHARS + 1) });
      expect(over.status).toBe(422);
      expect(over.body.code).toBe("text_too_long");
      expect(over.body.error).toMatch(/The pasted text has 60,001 characters/);
      expect(snapshot()).toEqual(before);
    });

    it("blank text and no file asks for input", async () => {
      const r = await send(route, { text: "  \n\t " });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("no_input");
    });
  });

  describe("file and pasted text together", () => {
    it("is rejected with a request to choose one (even if the file is empty)", async () => {
      seedExistingData();
      const before = snapshot();
      for (const file of ["valid-lesson.txt", "empty-file.txt"]) {
        const r = await send(route, { file: { name: file, bytes: readFixture(file) }, text: "Some pasted notes about tide pools and barnacles, long enough." });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe("file_and_text");
        expect(r.body.error).toMatch(/choose one/i);
      }
      expect(snapshot()).toEqual(before);
      expect(blueprintSpy).not.toHaveBeenCalled();
    });

    it("whitespace-only text next to a file doesn't count as pasted text", async () => {
      const r = await send(route, { file: { name: "valid-lesson.md", bytes: readFixture("valid-lesson.md") }, text: "   \n" });
      expect(r.status).toBe(200);
    });

    it("an empty, nameless file part (HTML form with no file chosen) counts as no file", async () => {
      const r = await send(route, { file: { name: "", bytes: new Uint8Array(0) }, text: "Pasted material about orbits, gravity and the skyport of Caldera Nine." });
      expect(r.status).toBe(200);
    });

    it("more than one file is rejected", async () => {
      const f = { name: "valid-lesson.txt", bytes: readFixture("valid-lesson.txt") };
      const before = snapshot();
      const r = await send(route, { file: [f, f] });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("multiple_files");
      expect(snapshot()).toEqual(before);
    });
  });

  describe("size limits (actual bytes)", () => {
    it("accepts a valid DOCX of exactly 10 MiB", async () => {
      const bytes = new Uint8Array(buildPaddedDocx(parseSource(path.join(__dirname, "fixtures/documents/source/valid-lesson-docx.md")), MAX_UPLOAD_BYTES));
      expect(bytes.byteLength).toBe(MAX_UPLOAD_BYTES);
      const r = await send(route, { file: { name: "at-size-limit.docx", bytes } });
      expect(r.status).toBe(200);
      expect(getProject(newLessonId(r))!.document_text).toContain("Dunmere");
    }, 60_000);

    it("rejects a file one byte over 10 MiB by its real size", async () => {
      seedExistingData();
      const before = snapshot();
      const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(0x61);
      const r = await send(route, { file: { name: "oversized-lesson.txt", bytes } });
      expect(r.status).toBe(413);
      expect(r.body.code).toBe("file_too_large");
      expect(r.body.error).toMatch(/10\.0 MiB, but the maximum is 10 MiB/);
      expect(snapshot()).toEqual(before);
    }, 30_000);

    it("refuses a request whose declared size is too large without reading the body", async () => {
      const req = new NextRequest(route.url, {
        method: "POST",
        body: "irrelevant",
        headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_REQUEST_BYTES + 1) },
      });
      const r = await send(route, req);
      expect(r.status).toBe(413);
      expect(r.body.code).toBe("request_too_large");
      expect(req.bodyUsed).toBe(false);
    });

    it("stops reading a body that is larger than declared (or undeclared) once it passes the cap", async () => {
      let sent = 0;
      const chunk = new Uint8Array(256 * 1024).fill(0x62);
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent > MAX_REQUEST_BYTES * 3) return controller.close(); // would be 3x the cap if fully read
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        },
      });
      const req = new NextRequest(route.url, {
        method: "POST",
        body: stream,
        headers: { "content-type": "multipart/form-data; boundary=x" },
        // @ts-expect-error -- required by Node for streaming request bodies
        duplex: "half",
      });
      const r = await send(route, req);
      expect(r.status).toBe(413);
      expect(r.body.code).toBe("request_too_large");
      expect(sent).toBeLessThan(MAX_REQUEST_BYTES + 4 * chunk.byteLength);
    });
  });

  describe("malformed requests", () => {
    it("rejects non-form bodies with 400, not 500", async () => {
      const req = new NextRequest(route.url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      const r = await send(route, req);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("invalid_request");
    });

    it("rejects a broken multipart body with 400", async () => {
      const req = new NextRequest(route.url, { method: "POST", body: "--x\r\nnot really multipart", headers: { "content-type": "multipart/form-data; boundary=x" } });
      const r = await send(route, req);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("invalid_request");
    });
  });

  it("a failing blueprint step returns 502 and saves nothing", async () => {
    seedExistingData();
    const before = snapshot();
    blueprintSpy.mockRejectedValueOnce(new Error("upstream model unavailable (synthetic)"));
    const r = await send(route, { file: { name: "valid-lesson.txt", bytes: readFixture("valid-lesson.txt") } });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("blueprint_failed");
    expect(r.body.error).not.toMatch(/synthetic/); // internal details stay in the server log
    expect(snapshot()).toEqual(before);
  });
});

// ---------- classroom-specific ----------

describe("POST /api/classrooms/[id]/lessons only", () => {
  const route = ROUTES[1];

  it("404s for an unknown classroom before reading or parsing the upload", async () => {
    const req = formRequest("http://localhost/api/classrooms/nope/lessons", { file: { name: "valid-lesson.pdf", bytes: readFixture("valid-lesson.pdf") } });
    const res = await lessonsRoute.POST(req, { params: { id: "nope" } });
    expect(res.status).toBe(404);
    expect(req.bodyUsed).toBe(false);
    expect(blueprintSpy).not.toHaveBeenCalled();
    expect(listProjects()).toHaveLength(0);
  });

  it("doesn't leave an orphan lesson if the classroom disappears while the blueprint is built", async () => {
    const { classroom } = seedExistingData();
    const actual = await vi.importActual<typeof import("@/lib/generators")>("@/lib/generators");
    blueprintSpy.mockImplementationOnce(async (text, profile) => {
      fs.rmSync(path.join(data.dir(), "classrooms", `${classroom.id}.json`));
      return actual.createLearningBlueprint(text, profile);
    });
    const lessonsBefore = listProjects().map((p) => p.id).sort();
    const r = await send(route, { file: { name: "valid-lesson.txt", bytes: readFixture("valid-lesson.txt") } });
    expect(r.status).toBe(404);
    expect(listProjects().map((p) => p.id).sort()).toEqual(lessonsBefore);
  });

  it("other classrooms are never touched", async () => {
    const { otherClassroom } = seedExistingData();
    const otherFile = path.join(data.dir(), "classrooms", `${otherClassroom.id}.json`);
    const before = fs.readFileSync(otherFile, "utf-8");
    await send(route, { file: { name: "valid-lesson.docx", bytes: readFixture("valid-lesson.docx") } });
    await send(route, { file: { name: "unsupported-image.png", bytes: readFixture("unsupported-image.png") } });
    expect(fs.readFileSync(otherFile, "utf-8")).toBe(before);
    expect((JSON.parse(before) as Classroom).lesson_ids).toEqual(["lesson-x"]);
  }, 30_000);
});
