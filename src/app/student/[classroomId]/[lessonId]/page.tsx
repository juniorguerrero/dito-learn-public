import { notFound } from "next/navigation";
import { getClassroom, listClassrooms } from "@/lib/db";
import { getProject } from "@/lib/store";
import StudentLesson from "@/components/student/StudentLesson";

export const dynamic = process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic";

export function generateStaticParams() {
  return listClassrooms().flatMap((c) => c.lesson_ids.map((lessonId) => ({ classroomId: c.id, lessonId })));
}

export default function LessonPage({ params }: { params: { classroomId: string; lessonId: string } }) {
  const classroom = getClassroom(params.classroomId);
  const project = getProject(params.lessonId);
  if (!classroom || !project || project.classroom_id !== classroom.id) notFound();

  return (
    <StudentLesson
      classroom={{ id: classroom.id, name: classroom.name }}
      project={project}
    />
  );
}
