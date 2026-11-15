import Link from "next/link";
import { listClassrooms, listStudentsInClassroom } from "@/lib/db";
import CreateClassroom from "@/components/teacher/CreateClassroom";
import LoadDemoButton from "@/components/LoadDemoButton";

export const dynamic = process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic";

export default function TeachPage() {
  const classrooms = listClassrooms();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/" className="text-sm text-slate-400 hover:text-violet-600">← Home</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">👩‍🏫 Teacher studio</h1>
          <p className="mt-1 text-slate-500">Create a classroom, upload your material, and see how your students learn.</p>
        </div>
        <div className="flex items-center gap-2">
          <LoadDemoButton variant="subtle" />
          <CreateClassroom />
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {classrooms.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-300 p-10 text-center">
            <p className="text-slate-400">No classrooms yet — create one, or load the demo to explore.</p>
            <div className="mt-4"><LoadDemoButton /></div>
          </div>
        )}
        {classrooms.map((c) => {
          const students = listStudentsInClassroom(c.id).length;
          return (
            <Link
              key={c.id}
              href={`/teacher/${c.id}`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-violet-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-600">{c.subject}</span>
                <span className="font-mono text-xs text-slate-400">#{c.join_code}</span>
              </div>
              <h2 className="mt-3 font-bold">{c.name}</h2>
              <p className="mt-1 text-sm text-slate-500 line-clamp-2">{c.description || "No description"}</p>
              <div className="mt-4 flex gap-4 text-xs text-slate-400">
                <span>📚 {c.lesson_ids.length} lessons</span>
                <span>🧑‍🎓 {students} students</span>
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
