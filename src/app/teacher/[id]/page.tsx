import { notFound } from "next/navigation";
import { getClassroom, listStudentsInClassroom, listClassrooms } from "@/lib/db";
import { classroomLessons, lessonSummary } from "@/lib/lessons";
import ClassroomWorkspace from "@/components/teacher/ClassroomWorkspace";

export const dynamic = process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic";

export function generateStaticParams() {
  return listClassrooms().map((c) => ({ id: c.id }));
}

export default function ClassroomPage({ params }: { params: { id: string } }) {
  const classroom = getClassroom(params.id);
  if (!classroom) notFound();

  const { active, archived } = classroomLessons(classroom);

  const students = listStudentsInClassroom(classroom.id).map((s) => ({
    id: s.id,
    name: s.name,
    interests: s.interests,
    favorite_modality_guess: s.vibe?.favorite_modality_guess || null,
  }));

  return (
    <ClassroomWorkspace
      classroom={classroom}
      lessons={active.map(lessonSummary)}
      archivedLessons={archived.map(lessonSummary)}
      students={students}
    />
  );
}
