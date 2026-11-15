import Link from "next/link";
import LoadDemoButton from "@/components/LoadDemoButton";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-14">
      <div className="text-center">
        <span className="inline-block rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
          Multimodal AI learning platform
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">
          One classroom. <span className="text-violet-600">Every</span> way to learn.
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-slate-500">
          Professors upload their material once. Antclass turns it into mind maps, flashcards, stories, podcasts,
          games, videos and songs — personalized to each student — and shows the professor exactly how their
          class learns best.
        </p>
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <Link
          href="/teacher"
          className="group rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition hover:border-violet-300 hover:shadow-md"
        >
          <div className="text-4xl">👩‍🏫</div>
          <h2 className="mt-3 text-xl font-bold">I&apos;m a Professor</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Create classrooms, upload course material, and watch an observability dashboard reveal how your
            students actually learn.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-violet-600 group-hover:gap-2">
            Open teacher studio →
          </span>
        </Link>

        <Link
          href="/student"
          className="group rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition hover:border-fuchsia-300 hover:shadow-md"
        >
          <div className="text-4xl">🧑‍🎓</div>
          <h2 className="mt-3 text-xl font-bold">I&apos;m a Student</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Join with a code, tell us what you love, and learn each lesson your way — chat with an AI tutor
            anytime.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-fuchsia-600 group-hover:gap-2">
            Start learning →
          </span>
        </Link>
      </div>

      <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <p className="text-sm font-medium text-slate-600">First time here? See it fully populated.</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
          Loads a demo classroom (Ms. Chen&apos;s) with 3 ready lessons, 6 students, and live activity so
          the professor Insights dashboard is already alive.
        </p>
        <div className="mt-3">
          <LoadDemoButton />
        </div>
      </div>
    </main>
  );
}
