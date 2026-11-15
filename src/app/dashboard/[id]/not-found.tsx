import Link from "next/link";

export default function LessonNotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-20 text-center">
      <div className="text-5xl">🔍</div>
      <h1 className="mt-4 text-2xl font-bold">This lesson doesn&apos;t exist (yet)</h1>
      <p className="mt-2 text-slate-500">
        The link points to a project that isn&apos;t on this device — it may have been from an old
        test session, or created in a different environment.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/upload" className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2.5 font-semibold text-white shadow-md transition hover:opacity-95">
          + Upload new material
        </Link>
        <Link href="/teacher" className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-semibold text-slate-600 shadow-sm transition hover:border-violet-300">
          👩‍🏫 Teacher studio
        </Link>
      </div>
    </main>
  );
}
