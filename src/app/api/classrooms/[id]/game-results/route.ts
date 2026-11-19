import { NextRequest } from "next/server";
import { teacherGameOverview } from "@/lib/gameTeacher";
import { teacherGameRoute } from "@/lib/gameTeacherApi";

export const dynamic = "force-dynamic";

// GET -> { lessons: [{ id, title, archived, has_game, students_played, finished_attempts }] }
// Every lesson of the classroom (active and archived), finished attempts only.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return teacherGameRoute("game overview", () => teacherGameOverview(params.id));
}
