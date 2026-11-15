import fs from "fs";
import path from "path";
import { randomUUID, randomInt } from "crypto";
import { Classroom, Student, LearningEvent, DirectMessage } from "./types";

// Filesystem store for the platform entities. Same spirit as store.ts —
// swap for Supabase later without changing callers.

const ROOT = path.join(process.cwd(), "data");
const CLASSROOMS = path.join(ROOT, "classrooms");
const STUDENTS = path.join(ROOT, "students");
const EVENTS_FILE = path.join(ROOT, "events.jsonl");
const MESSAGES_FILE = path.join(ROOT, "messages.jsonl");

function ensure() {
  fs.mkdirSync(CLASSROOMS, { recursive: true });
  fs.mkdirSync(STUDENTS, { recursive: true });
}

const safeId = (id: string) => /^[a-zA-Z0-9-]+$/.test(id);

// ---------- Classrooms ----------

export function saveClassroom(c: Classroom): void {
  ensure();
  fs.writeFileSync(path.join(CLASSROOMS, `${c.id}.json`), JSON.stringify(c, null, 2));
}

export function getClassroom(id: string): Classroom | null {
  if (!safeId(id)) return null;
  const f = path.join(CLASSROOMS, `${id}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf-8")) as Classroom;
}

export function listClassrooms(): Classroom[] {
  ensure();
  return fs
    .readdirSync(CLASSROOMS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(CLASSROOMS, f), "utf-8")) as Classroom)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getClassroomByCode(code: string): Classroom | null {
  const norm = code.trim().toUpperCase();
  return listClassrooms().find((c) => c.join_code === norm) || null;
}

export function makeJoinCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const existing = new Set(listClassrooms().map((c) => c.join_code));
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join("");
  } while (existing.has(code));
  return code;
}

// ---------- Students ----------

export function saveStudent(s: Student): void {
  ensure();
  fs.writeFileSync(path.join(STUDENTS, `${s.id}.json`), JSON.stringify(s, null, 2));
}

export function getStudent(id: string): Student | null {
  if (!safeId(id)) return null;
  const f = path.join(STUDENTS, `${id}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf-8")) as Student;
}

export function listStudents(): Student[] {
  ensure();
  return fs
    .readdirSync(STUDENTS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(STUDENTS, f), "utf-8")) as Student);
}

export function listStudentsInClassroom(classroomId: string): Student[] {
  return listStudents().filter((s) => s.classroom_ids.includes(classroomId));
}

// ---------- Events (append-only log powering observability) ----------

export function logEvent(e: Omit<LearningEvent, "id" | "created_at">): LearningEvent {
  ensure();
  const full: LearningEvent = { ...e, id: randomUUID(), created_at: new Date().toISOString() };
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(full) + "\n");
  return full;
}

export function getEvents(classroomId?: string): LearningEvent[] {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  const events = fs
    .readFileSync(EVENTS_FILE, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LearningEvent);
  return classroomId ? events.filter((e) => e.classroom_id === classroomId) : events;
}

// ---------- Direct messages (teacher↔student, append-only like events) ----------

export function saveDirectMessage(m: Omit<DirectMessage, "id" | "created_at">): DirectMessage {
  ensure();
  const full: DirectMessage = { ...m, id: randomUUID(), created_at: new Date().toISOString() };
  fs.appendFileSync(MESSAGES_FILE, JSON.stringify(full) + "\n");
  return full;
}

export function getDirectMessages(classroomId: string, studentId?: string): DirectMessage[] {
  if (!fs.existsSync(MESSAGES_FILE)) return [];
  return fs
    .readFileSync(MESSAGES_FILE, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as DirectMessage)
    .filter((m) => m.classroom_id === classroomId && (!studentId || m.student_id === studentId));
}

export interface ConversationSummary {
  student_id: string;
  last_text: string;
  last_sender: "professor" | "student";
  last_at: string;
  count: number;
}

export function getConversationSummaries(classroomId: string): ConversationSummary[] {
  const byStudent = new Map<string, ConversationSummary>();
  getDirectMessages(classroomId).forEach((m) => {
    const prev = byStudent.get(m.student_id);
    byStudent.set(m.student_id, {
      student_id: m.student_id,
      last_text: m.text,
      last_sender: m.sender,
      last_at: m.created_at,
      count: (prev?.count || 0) + 1,
    });
  });
  return Array.from(byStudent.values()).sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
}
