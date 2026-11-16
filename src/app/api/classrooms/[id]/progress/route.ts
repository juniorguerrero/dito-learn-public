import { NextRequest, NextResponse } from "next/server";
import { getClassroom, getEvents, getStudent } from "@/lib/db";
import { summarizeStudentProgress } from "@/lib/progress";
import { OUTPUT_TYPES } from "@/lib/progressShared";

export const dynamic = "force-dynamic";

// GET /api/classrooms/[id]/progress?student_id=... -> { total_formats, lessons: LessonProgressSummary[] }
// A student's own progress on every lesson of a class (for their class page).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const classroom = getClassroom(params.id);
  if (!classroom) return NextResponse.json({ error: "Classroom not found" }, { status: 404 });
  const student = getStudent(req.nextUrl.searchParams.get("student_id") || "");
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (!student.classroom_ids.includes(classroom.id)) {
    return NextResponse.json({ error: "Join this class to see your progress" }, { status: 403 });
  }
  return NextResponse.json(
    { total_formats: OUTPUT_TYPES.length, lessons: summarizeStudentProgress(student, classroom, getEvents(classroom.id)) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
