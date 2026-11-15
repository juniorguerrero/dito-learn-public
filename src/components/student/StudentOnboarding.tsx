"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getLocalStudent, setLocalStudent, clearLocalStudent, LocalStudent } from "@/lib/studentClient";

const SUGGESTED = ["Music", "Video games", "Sports", "Movies", "Anime", "Art", "Coding", "Science", "Space", "Animals", "Cooking", "Fashion", "Cars", "Nature"];

interface EnrolledClassroom { id: string; name: string; subject: string }

export default function StudentOnboarding() {
  const router = useRouter();
  const [existing, setExisting] = useState<LocalStudent | null>(null);
  const [classrooms, setClassrooms] = useState<EnrolledClassroom[]>([]);
  const [checking, setChecking] = useState(true);

  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);

  const LOADING_STEPS = ["Reading your interests…", "Finding what inspires you…", "Personalizing your space…", "Almost ready!"];

  useEffect(() => {
    const s = getLocalStudent();
    if (!s) { setChecking(false); return; }
    setExisting(s);
    fetch(`/api/students?id=${s.id}`)
      .then((r) => r.json())
      .then((j) => { if (j.classrooms) setClassrooms(j.classrooms); })
      .finally(() => setChecking(false));
  }, []);

  function toggle(i: string) {
    setInterests((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("What's your name?");
    if (!joinCode.trim()) return setError("Enter the class join code from your professor.");
    const allInterests = [...interests, ...custom.split(",").map((s) => s.trim()).filter(Boolean)];

    setLoading(true);
    setStep(0);
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 1600);
    try {
      // If there's already a local student, enroll them; otherwise create.
      const local = getLocalStudent();
      let res: Response, json: any;
      if (local) {
        res = await fetch("/api/students", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id: local.id, join_code: joinCode }),
        });
        json = await res.json();
      } else {
        res = await fetch("/api/students", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, join_code: joinCode, interests: allInterests }),
        });
        json = await res.json();
      }
      if (!res.ok) throw new Error(json.error || "Something went wrong");
      setLocalStudent({ id: json.student.id, name: json.student.name });
      router.push(`/student/${json.classroom_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setLoading(false);
    } finally {
      clearInterval(ticker);
    }
  }

  if (checking) {
    return <main className="mx-auto max-w-2xl px-4 py-20 text-center text-slate-400">Loading…</main>;
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-24 text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-fuchsia-200 border-t-fuchsia-600" />
        <p className="mt-5 font-semibold text-fuchsia-700">{LOADING_STEPS[step]}</p>
        <p className="mt-1 text-sm text-slate-400">Building a learning space just for you.</p>
      </main>
    );
  }

  // Returning student: show their classrooms + a way to join another.
  if (existing && classrooms.length > 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Welcome back, {existing.name} 👋</h1>
        <p className="mt-1 text-slate-500">Jump back into a class, or join a new one with a code.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {classrooms.map((c) => (
            <Link key={c.id} href={`/student/${c.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-fuchsia-300 hover:shadow-md">
              <span className="rounded-full bg-fuchsia-50 px-2.5 py-0.5 text-xs font-medium text-fuchsia-600">{c.subject}</span>
              <h2 className="mt-2 font-bold">{c.name}</h2>
              <span className="mt-3 inline-block text-sm font-semibold text-fuchsia-600">Continue learning →</span>
            </Link>
          ))}
        </div>

        <form onSubmit={submit} className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold">Join another class</h3>
          <input value={name || existing.name} onChange={(e) => setName(e.target.value)} className="mt-3 hidden" />
          <div className="mt-3 flex gap-2">
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="JOIN CODE"
              className="w-40 rounded-xl border border-slate-200 p-2.5 font-mono uppercase tracking-widest outline-none focus:border-fuchsia-400" />
            <button type="submit" className="rounded-xl bg-fuchsia-600 px-5 py-2.5 font-semibold text-white hover:bg-fuchsia-700">Join</button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </form>
        <button onClick={() => { clearLocalStudent(); setExisting(null); setClassrooms([]); }} className="mt-4 text-xs text-slate-400 hover:text-slate-600">
          Not {existing.name}? Start over
        </button>
      </main>
    );
  }

  // New student onboarding
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/" className="text-sm text-slate-400 hover:text-fuchsia-600">← Home</Link>
      <div className="mt-3 text-center">
        <div className="text-4xl">🧑‍🎓</div>
        <h1 className="mt-2 text-2xl font-bold">Let&apos;s make learning yours</h1>
        <p className="mt-1 text-slate-500">Tell us who you are and what you love — we&apos;ll shape every lesson around it.</p>
      </div>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-500">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex"
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-fuchsia-400" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">Class join code</span>
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="ABC123"
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 font-mono uppercase tracking-widest outline-none focus:border-fuchsia-400" />
          </label>
        </div>

        <div>
          <span className="text-sm text-slate-500">What are you into? (pick a few)</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGESTED.map((i) => (
              <button type="button" key={i} onClick={() => toggle(i)}
                className={`rounded-full border-2 px-3 py-1.5 text-sm font-medium transition ${
                  interests.includes(i) ? "border-fuchsia-400 bg-fuchsia-50 text-fuchsia-700" : "border-slate-200 bg-white text-slate-500 hover:border-fuchsia-300"
                }`}>
                {i}
              </button>
            ))}
          </div>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Anything else? (comma separated)"
            className="mt-3 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-fuchsia-400" />
        </div>

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        <button type="submit"
          className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-600 to-violet-600 py-3.5 font-semibold text-white shadow-lg shadow-fuchsia-200 transition hover:opacity-95">
          ✨ Enter my learning space
        </button>
      </form>
    </main>
  );
}
