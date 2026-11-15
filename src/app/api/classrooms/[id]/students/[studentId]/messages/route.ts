import { NextRequest, NextResponse } from "next/server";
import { getClassroom, getStudent, getDirectMessages, saveDirectMessage } from "@/lib/db";
import { remember } from "@/lib/evermind";

// Direct teacher↔student thread. One thread per (classroom, student).
// Both sides poll GET; POST appends and writes the message to EverMind
// so the professor's AI remembers every conversation over time.

export async function GET(_req: NextRequest, { params }: { params: { id: string; studentId: string } }) {
  return NextResponse.json({ messages: getDirectMessages(params.id, params.studentId) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; studentId: string } }) {
  try {
    const body = await req.json();
    const text: string = (body.text || "").trim();
    const sender: "professor" | "student" = body.sender === "professor" ? "professor" : "student";
    if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });

    const classroom = getClassroom(params.id);
    if (!classroom) return NextResponse.json({ error: "Classroom not found" }, { status: 404 });
    const student = getStudent(params.studentId);
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

    const sender_name = sender === "professor" ? classroom.professor_name : student.name;
    const message = saveDirectMessage({
      classroom_id: params.id,
      student_id: params.studentId,
      sender,
      sender_name,
      text,
    });

    remember(
      {
        classroomId: params.id,
        studentId: params.studentId,
        senderId: sender === "professor" ? "professor" : params.studentId,
        senderName: sender_name,
        // Personal-memory extraction needs a dialog: the student is "user",
        // anyone talking TO the student (professor) is "assistant".
        role: sender === "professor" ? "assistant" : "user",
        text: `[direct message ${sender === "professor" ? `to ${student.name}` : `to Professor ${classroom.professor_name}`}] ${sender_name}: ${text}`,
      },
      { flush: true, sessionId: `dm-${params.studentId}` }
    );

    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
