import { NextRequest, NextResponse } from "next/server";
import { lessonChat } from "@/lib/platform";
import { logEvent } from "@/lib/db";
import { ChatMessage } from "@/lib/types";

export const maxDuration = 60;

// Student asks the AI tutor a question about a specific lesson. Logs the question for observability.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const question: string = (body.question || "").trim();
    const history: ChatMessage[] = body.history || [];
    if (!question) return NextResponse.json({ error: "Empty question" }, { status: 400 });

    if (body.classroom_id && body.student_id) {
      logEvent({
        classroom_id: body.classroom_id,
        student_id: body.student_id,
        student_name: body.student_name || "Student",
        lesson_id: params.id,
        type: "question",
        text: question,
      });
    }

    // Runs through the Raven harness: recalls this student's EverMind memories,
    // answers, then remembers the exchange for the professor's long-term view.
    const answer = await lessonChat(params.id, history, question, {
      classroomId: body.classroom_id,
      studentId: body.student_id,
      studentName: body.student_name,
    });
    return NextResponse.json({ answer });
  } catch (err) {
    console.error("chat error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Chat failed" }, { status: 500 });
  }
}
