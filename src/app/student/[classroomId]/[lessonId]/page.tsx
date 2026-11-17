import Link from "next/link";
import { notFound } from "next/navigation";
import { listClassrooms } from "@/lib/db";
import { studentLessonView } from "@/lib/lessons";
import StudentLesson from "@/components/student/StudentLesson";

export const dynamic = process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic";

export function generateStaticParams() {
  return listClassrooms().flatMap((c) => c.lesson_ids.map((lessonId) => ({ classroomId: c.id, lessonId })));
}

export default function LessonPage({ params }: { params: { classroomId: string; lessonId: string } }) {
  const view = studentLessonView(params.classroomId, params.lessonId);
  if (view.kind === "not_found") notFound();

  if (view.kind === "archived") {
    // A bookmarked or shared link to an archived lesson. Students who still have the
    // lesson open can keep working and saving; on the next visit they land here.
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Link href={`/student/${view.classroom.id}`} className="text-sm text-slate-400 hover:text-fuchsia-600">← {view.classroom.name}</Link>
        <div role="status" data-testid="archived-lesson-notice" className="mt-4 rounded-3xl border-2 border-amber-200 bg-amber-50 p-8 text-center">
          <div className="text-4xl">🗄️</div>
          <h1 className="mt-3 text-xl font-bold text-amber-900">This lesson has been archived</h1>
          <p className="mt-2 text-amber-800">
            <span className="font-semibold">“{view.title}”</span> is no longer one of the active lessons in {view.classroom.name}.
          </p>
          <p className="mt-2 text-sm text-amber-700">
            Your progress on it is kept. If {view.classroom.professor_name || "your professor"} restores the lesson, you&apos;ll pick up where you left off.
          </p>
          <Link
            href={`/student/${view.classroom.id}`}
            className="mt-5 inline-block rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-700"
          >
            See the active lessons →
          </Link>
        </div>
      </main>
    );
  }

  return <StudentLesson classroom={{ id: view.classroom.id, name: view.classroom.name }} project={view.project} />;
}
