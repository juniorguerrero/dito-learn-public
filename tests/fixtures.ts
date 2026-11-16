import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach } from "vitest";
import { saveClassroom, saveStudent } from "@/lib/db";
import { saveProject } from "@/lib/store";
import { mockFlashcards } from "@/lib/mocks";
import { SEED_LESSONS } from "@/lib/seedData";
import { Classroom, Project, Student } from "@/lib/types";

/** Point the filesystem store at a fresh temp dir for every test. */
export function useTempDataDir(): { dir: () => string } {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dito-progress-"));
    process.env.DITO_DATA_DIR = dir;
  });
  afterEach(() => {
    delete process.env.DITO_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir: () => dir };
}

const at = "2024-01-01T00:00:00.000Z";

function lesson(id: string, classroomId: string, seedIndex: number): Project {
  const seed = SEED_LESSONS[seedIndex];
  return {
    id,
    created_at: at,
    source_name: seed.source_name,
    document_text: seed.document_text,
    student_profile: { grade_level: "High school", goal: "test", preferred_style: "plain", study_time: "10m" },
    blueprint: seed.blueprint,
    // Built-in mock generator: deterministic, no API keys needed.
    outputs: { flashcards: mockFlashcards(seed.blueprint) },
    classroom_id: classroomId,
    professor_name: "Synthetic Teacher",
  };
}

function student(id: string, name: string, classroomIds: string[]): Student {
  return { id, name, interests: ["testing"], classroom_ids: classroomIds, created_at: at };
}

/** Synthetic classroom with two lessons, two enrolled students and one outsider. */
export function seedFixture() {
  const classroom: Classroom = {
    id: "class-1",
    name: "Synthetic Science",
    subject: "Science",
    description: "fixture",
    professor_name: "Synthetic Teacher",
    join_code: "TEST01",
    created_at: at,
    lesson_ids: ["lesson-a", "lesson-b"],
  };
  const otherClassroom: Classroom = { ...classroom, id: "class-2", name: "Other", join_code: "TEST02", lesson_ids: ["lesson-x"] };
  const lessonA = lesson("lesson-a", classroom.id, 0);
  const lessonB = lesson("lesson-b", classroom.id, 1);
  const lessonX = lesson("lesson-x", otherClassroom.id, 0);
  const ada = student("student-ada", "Ada Synthetic", [classroom.id]);
  const ben = student("student-ben", "Ben Synthetic", [classroom.id]);
  const outsider = student("student-out", "Olive Outsider", [otherClassroom.id]);

  [classroom, otherClassroom].forEach(saveClassroom);
  [lessonA, lessonB, lessonX].forEach(saveProject);
  [ada, ben, outsider].forEach(saveStudent);
  return { classroom, otherClassroom, lessonA, lessonB, lessonX, ada, ben, outsider };
}
