import { notFound } from "next/navigation";
import { getClassroom, listClassrooms } from "@/lib/db";
import { classroomLessons } from "@/lib/lessons";
import StudentHome from "@/components/student/StudentHome";

export const dynamic = process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic";

export function generateStaticParams() {
  return listClassrooms().map((c) => ({ classroomId: c.id }));
}

export default function StudentClassroomPage({ params }: { params: { classroomId: string } }) {
  const classroom = getClassroom(params.classroomId);
  if (!classroom) notFound();

  // Archived lessons are hidden from students (their progress is kept).
  const lessons = classroomLessons(classroom).active.map((p) => ({
    id: p.id,
    title: p.blueprint.title,
    summary: p.blueprint.summary,
    concept_count: p.blueprint.key_concepts.length,
    objectives: p.blueprint.learning_objectives.slice(0, 2),
  }));

  return (
    <StudentHome
      classroom={{ id: classroom.id, name: classroom.name, subject: classroom.subject, professor_name: classroom.professor_name }}
      lessons={lessons}
    />
  );
}
