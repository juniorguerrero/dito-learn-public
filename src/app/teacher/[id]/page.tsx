import { notFound } from "next/navigation";
import { getClassroom, listStudentsInClassroom, listClassrooms } from "@/lib/db";
import { getProject } from "@/lib/store";
import ClassroomWorkspace from "@/components/teacher/ClassroomWorkspace";

export const dynamic = process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic";

export function generateStaticParams() {
  return listClassrooms().map((c) => ({ id: c.id }));
}

export default function ClassroomPage({ params }: { params: { id: string } }) {
  const classroom = getClassroom(params.id);
  if (!classroom) notFound();

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
      concept_count: p!.blueprint.key_concepts.length,
    }));

  const students = listStudentsInClassroom(classroom.id).map((s) => ({
    id: s.id,
    name: s.name,
    interests: s.interests,
    favorite_modality_guess: s.vibe?.favorite_modality_guess || null,
  }));

  return <ClassroomWorkspace classroom={classroom} lessons={lessons} students={students} />;
}
