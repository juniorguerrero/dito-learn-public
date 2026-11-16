import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/db";
import { getProject } from "@/lib/store";
import { rememberEvent } from "@/lib/eventMemory";
import { ProgressError, recordCompletion } from "@/lib/progress";
import { EventType, OutputType } from "@/lib/types";

// Fire-and-forget event logging from the student experience -> feeds professor observability.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.classroom_id || !b.student_id || !b.type) {
      return NextResponse.json({ error: "classroom_id, student_id and type are required" }, { status: 400 });
    }

    // Completions are idempotent per (student, lesson, format): route them through
    // the progress store so repeated/legacy requests can't inflate teacher totals.
    if (b.type === "modality_complete") {
      if (typeof b.lesson_id !== "string" || !b.lesson_id) {
        return NextResponse.json({ error: "lesson_id is required for completions" }, { status: 400 });
      }
      const lesson = getProject(b.lesson_id);
      if (lesson && lesson.classroom_id !== b.classroom_id) {
        return NextResponse.json({ error: "Lesson does not belong to that classroom" }, { status: 400 });
      }
      const result = recordCompletion(b.student_id, b.lesson_id, b.modality);
      if (result.event) rememberEvent(result.event);
      return NextResponse.json({ ok: true, id: result.event?.id ?? null, duplicate: !result.newly_completed });
    }

    const event = logEvent({
      classroom_id: b.classroom_id,
      student_id: b.student_id,
      student_name: b.student_name || "Student",
      type: b.type as EventType,
      lesson_id: b.lesson_id,
      modality: b.modality as OutputType | undefined,
      value: typeof b.value === "number" ? b.value : undefined,
      text: b.text,
    });
    rememberEvent(event);

    return NextResponse.json({ ok: true, id: event.id });
  } catch (err) {
    if (err instanceof ProgressError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
