import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/db";
import { getProject } from "@/lib/store";
import { remember } from "@/lib/evermind";
import { EventType, LearningEvent, OutputType } from "@/lib/types";

function describeEvent(e: LearningEvent): string {
  const lesson = e.lesson_id ? getProject(e.lesson_id)?.blueprint.title : undefined;
  const where = lesson ? ` in lesson "${lesson}"` : "";
  switch (e.type) {
    case "lesson_open":
      return `${e.student_name} opened${where || " a lesson"}.`;
    case "modality_open":
      return `${e.student_name} started learning through the ${e.modality?.replace("_", " ")} activity${where}.`;
    case "modality_complete":
      return `${e.student_name} completed the ${e.modality?.replace("_", " ")} activity${where}.`;
    case "question":
      return `${e.student_name} asked${where}: "${e.text}"`;
    case "game_result":
      return `${e.student_name} scored ${e.value ?? "?"} in the learning game${where}.`;
  }
}

// Fire-and-forget event logging from the student experience -> feeds professor observability.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.classroom_id || !b.student_id || !b.type) {
      return NextResponse.json({ error: "classroom_id, student_id and type are required" }, { status: 400 });
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
    // Long-term memory: the professor's AI can recall this activity forever.
    remember(
      {
        classroomId: event.classroom_id,
        studentId: event.student_id,
        senderId: event.student_id,
        senderName: event.student_name,
        role: "user",
        text: describeEvent(event),
      },
      { flush: event.type === "question" || event.type === "game_result", sessionId: event.lesson_id }
    );

    return NextResponse.json({ ok: true, id: event.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
