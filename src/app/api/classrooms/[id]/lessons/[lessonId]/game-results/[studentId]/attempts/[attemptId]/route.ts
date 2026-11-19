import { NextRequest } from "next/server";
import { teacherAttemptDetail } from "@/lib/gameTeacher";
import { teacherGameRoute } from "@/lib/gameTeacherApi";

export const dynamic = "force-dynamic";

// GET -> { attempt: AttemptDetail } one finished attempt with every question,
// the chosen and the correct answer and the explanation, as in that game version.
export async function GET(_req: NextRequest, { params }: { params: { id: string; lessonId: string; studentId: string; attemptId: string } }) {
  return teacherGameRoute("attempt detail", () => ({ attempt: teacherAttemptDetail(params.id, params.lessonId, params.studentId, params.attemptId) }));
}
