"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoadDemoButton({ variant = "primary" }: { variant?: "primary" | "subtle" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadDemo() {
    if (!confirm("Add the demo classroom? It comes with lessons, students and activity. Your existing classrooms, students and progress are kept.")) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      router.push(`/teacher/${json.classroom_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setLoading(false);
    }
  }

  const cls =
    variant === "primary"
      ? "rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white shadow-md transition hover:bg-slate-800 disabled:opacity-60"
      : "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-violet-300 disabled:opacity-60";

  return (
    <div className="inline-flex flex-col items-center">
      <button onClick={loadDemo} disabled={loading} className={cls}>
        {loading ? "Building demo…" : "✨ Load demo data"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
