import { NextRequest } from "next/server";
import { teacherStudentGameResults } from "@/lib/gameTeacher";
import { teacherGameRoute } from "@/lib/gameTeacherApi";

export const dynamic = "force-dynamic";

// GET -> TeacherStudentGameResults: one student's finished attempts on the lesson.
// 404 unless the student is enrolled in this classroom.
export async function GET(_req: NextRequest, { params }: { params: { id: string; lessonId: string; studentId: string } }) {
  return teacherGameRoute("student game results", () => teacherStudentGameResults(params.id, params.lessonId, params.studentId));
}
