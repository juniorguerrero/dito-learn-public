import { NextRequest, NextResponse } from "next/server";
import { findClassroomLesson, lessonSummary, patchLesson } from "@/lib/lessons";

export const dynamic = "force-dynamic";

// GET -> { lesson } (active or archived), for the teacher.
export async function GET(_req: NextRequest, { params }: { params: { id: string; lessonId: string } }) {
  const found = findClassroomLesson(params.id, params.lessonId);
  if (!found.ok) return NextResponse.json({ error: found.message, code: found.code }, { status: found.status });
  return NextResponse.json({ lesson: lessonSummary(found.project) });
}

// PATCH { title?, summary?, archived? } -> { lesson, changed }
// Edits title/summary and archives/restores without regenerating anything or
// touching source material, generated formats or student progress.
// Repeating a request is harmless: unchanged requests write nothing (changed: false).
export async function PATCH(req: NextRequest, { params }: { params: { id: string; lessonId: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = undefined;
  }
  // Look up before validating the body so a wrong classroom/lesson is always a 404.
  const found = findClassroomLesson(params.id, params.lessonId);
  if (!found.ok) return NextResponse.json({ error: found.message, code: found.code }, { status: found.status });
  if (body === undefined) return NextResponse.json({ error: "Send a JSON object with title, summary and/or archived.", code: "invalid_request" }, { status: 400 });

  const r = patchLesson(params.id, params.lessonId, body);
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
  return NextResponse.json({ lesson: r.lesson, changed: r.changed });
}
