import Link from "next/link";
import { listProjects } from "@/lib/store";
import UploadForm from "@/components/UploadForm";

export const dynamic = process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic";

export default function UploadPage() {
  const projects = listProjects();

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <Link href="/" className="text-sm text-slate-400 hover:text-violet-600">← Home</Link>
      <div className="mt-3 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="text-2xl font-bold">Turn any document into a full learning experience</h1>
          <p className="mt-1 text-slate-500">
            Upload a PDF, Word doc, or paste text. Antclass builds a Learning Blueprint, then generates a mind
            map, flashcards, story, podcast, game, video and song — all from the same blueprint.
          </p>
          <div className="mt-6">
            <UploadForm />
          </div>
        </div>

        <aside>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Recent materials</h2>
          <div className="mt-3 space-y-2">
            {projects.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-400">
                Nothing yet — upload your first document to get started.
              </p>
            )}
            {projects.slice(0, 8).map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/${p.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-violet-300 hover:shadow"
              >
                <p className="truncate font-medium text-sm">{p.blueprint.title}</p>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {p.source_name} · {p.blueprint.subject} · {new Date(p.created_at).toLocaleDateString()}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {Object.keys(p.outputs).map((o) => (
                    <span key={o} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-600">
                      {o.replace("_", " ")}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
