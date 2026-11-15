import { NextRequest, NextResponse } from "next/server";
import { getClassroom, listStudentsInClassroom } from "@/lib/db";
import { getProject } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const classroom = getClassroom(params.id);
  if (!classroom) return NextResponse.json({ error: "Classroom not found" }, { status: 404 });

  const lessons = classroom.lesson_ids
    .map((lid) => getProject(lid))
    .filter(Boolean)
    .map((p) => ({
      id: p!.id,
      title: p!.blueprint.title,
      subject: p!.blueprint.subject,
      summary: p!.blueprint.summary,
      source_name: p!.source_name,
      generated: Object.keys(p!.outputs),
      created_at: p!.created_at,
    }));

  const students = listStudentsInClassroom(classroom.id).map((s) => ({
    id: s.id,
    name: s.name,
    interests: s.interests,
    favorite_modality_guess: s.vibe?.favorite_modality_guess,
  }));

  return NextResponse.json({ classroom, lessons, students });
}
