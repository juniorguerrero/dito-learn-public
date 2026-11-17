import { NextRequest, NextResponse } from "next/server";
import { getClassroom, listStudentsInClassroom } from "@/lib/db";
import { classroomLessons, lessonSummary } from "@/lib/lessons";

export const dynamic = "force-dynamic";

// -> { classroom, lessons (active, in class order), archived_lessons, students }
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const classroom = getClassroom(params.id);
  if (!classroom) return NextResponse.json({ error: "Classroom not found" }, { status: 404 });

  const { active, archived } = classroomLessons(classroom);
  const students = listStudentsInClassroom(classroom.id).map((s) => ({
    id: s.id,
    name: s.name,
    interests: s.interests,
    favorite_modality_guess: s.vibe?.favorite_modality_guess,
  }));

  return NextResponse.json({ classroom, lessons: active.map(lessonSummary), archived_lessons: archived.map(lessonSummary), students });
}
