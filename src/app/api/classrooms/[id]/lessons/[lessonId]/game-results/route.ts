import { NextRequest } from "next/server";
import { teacherLessonGameResults } from "@/lib/gameTeacher";
import { teacherGameRoute } from "@/lib/gameTeacherApi";

export const dynamic = "force-dynamic";

// GET -> TeacherLessonGameResults: per enrolled student the latest result, best
// score per game version and finished-attempt count (unfinished attempts never count).
// 404 unless the classroom lists the lesson and the lesson belongs to it.
export async function GET(_req: NextRequest, { params }: { params: { id: string; lessonId: string } }) {
  return teacherGameRoute("lesson game results", () => teacherLessonGameResults(params.id, params.lessonId));
}
