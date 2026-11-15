"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getLocalStudent } from "@/lib/studentClient";
import { Student } from "@/lib/types";
import ProfessorDM from "./ProfessorDM";

interface LessonLite { id: string; title: string; summary: string; concept_count: number; objectives: string[] }
interface ClassroomLite { id: string; name: string; subject: string; professor_name: string }

const MODALITY_ICON: Record<string, string> = {
  mindmap: "🧠", flashcards: "🃏", story_slides: "📖", podcast: "🎙️",
  story_audio: "🔊", game: "🎮", video: "🎬", song: "🎵",
};

export default function StudentHome({ classroom, lessons }: { classroom: ClassroomLite; lessons: LessonLite[] }) {
  const router = useRouter();
  const [student, setStudent] = useState<Student | null>(null);

  useEffect(() => {
    const local = getLocalStudent();
    if (!local) { router.push("/student"); return; }
    fetch(`/api/students?id=${local.id}`).then((r) => r.json()).then((j) => setStudent(j.student || null));
  }, [router]);

  const vibe = student?.vibe;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Link href="/student" className="text-sm text-slate-400 hover:text-fuchsia-600">← My classes</Link>

      <div className="mt-3 grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Inspiring personalized sidebar */}
        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="relative aspect-[16/10] bg-gradient-to-br from-fuchsia-500 to-violet-600">
              {vibe?.hero_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vibe.hero_image_url} alt="Your inspiration" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="p-5">
              <p className="text-lg font-bold leading-snug">{vibe?.greeting || `Welcome${student ? `, ${student.name}` : ""}!`}</p>
              <p className="mt-2 text-sm text-slate-500">{vibe?.motivation || "Learn this class your way."}</p>

              {student && student.interests.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">You love</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {student.interests.map((i) => (
                      <span key={i} className="rounded-full bg-fuchsia-50 px-2.5 py-0.5 text-xs font-medium text-fuchsia-600">{i}</span>
                    ))}
                  </div>
                </div>
              )}

              {vibe?.favorite_modality_guess && (
                <div className="mt-4 rounded-2xl bg-violet-50 p-3">
                  <p className="text-xs text-violet-500">We think you&apos;ll love learning through</p>
                  <p className="mt-0.5 font-bold text-violet-700">
                    {MODALITY_ICON[vibe.favorite_modality_guess]} {vibe.favorite_modality_guess.replace("_", " ")}
                  </p>
                </div>
              )}
            </div>
          </div>

          <ProfessorDM
            classroomId={classroom.id}
            professorName={classroom.professor_name}
            student={student ? { id: student.id, name: student.name } : null}
          />
        </aside>

        {/* Lessons */}
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{classroom.name}</h1>
              <p className="text-slate-500">{classroom.subject} · with {classroom.professor_name}</p>
            </div>
          </div>

          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">Your lessons</h2>
          <div className="mt-3 space-y-3">
            {lessons.length === 0 && (
              <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
                Your professor hasn&apos;t added lessons yet. Check back soon!
              </p>
            )}
            {lessons.map((l, i) => (
              <Link key={l.id} href={`/student/${classroom.id}/${l.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-fuchsia-300 hover:shadow-md">
                <div className="flex items-start gap-4">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 font-bold text-white">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold">{l.title}</h3>
                    <p className="mt-1 text-sm text-slate-500 line-clamp-2">{l.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {l.objectives.map((o, j) => (
                        <span key={j} className="max-w-[220px] truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">🎯 {o}</span>
                      ))}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">{l.concept_count} concepts</span>
                    </div>
                  </div>
                  <span className="shrink-0 self-center text-fuchsia-500">→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
