"use client";

import { GenState } from "./Dashboard";

interface Props {
  title: string;
  description: string;
  emoji: string;
  hasData: boolean;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
  generateLabel?: string;
  loadingLabel?: string;
  children?: React.ReactNode;
}

/**
 * Shared wrapper for every output tab: empty state with a Generate button,
 * loading spinner, error + retry, and a Regenerate control once data exists.
 */
export default function TabShell({
  title,
  description,
  emoji,
  hasData,
  state,
  onGenerate,
  generateLabel = "Generate",
  loadingLabel = "Generating…",
  children,
}: Props) {
  if (state?.loading) {
    return (
      <div className="rounded-2xl border border-violet-200 bg-white p-14 text-center shadow-sm">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
        <p className="mt-4 font-semibold text-violet-700">{loadingLabel}</p>
        <p className="mt-1 text-sm text-slate-400">Built from your Learning Blueprint for a coherent experience.</p>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-14 text-center shadow-sm">
        <div className="text-5xl">{emoji}</div>
        <h2 className="mt-3 text-lg font-bold">{title}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">{description}</p>
        {state?.error && <p className="mx-auto mt-3 max-w-md rounded-xl bg-red-50 p-3 text-sm text-red-600">{state.error}</p>}
        <button
          onClick={() => onGenerate()}
          className="mt-5 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3 font-semibold text-white shadow-lg shadow-violet-200 transition hover:opacity-95 active:scale-[0.99]"
        >
          ✨ {generateLabel}
        </button>
      </div>
    );
  }

  return (
    <div>
      {state?.error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{state.error}</p>}
      {children}
      <div className="mt-4 text-right">
        <button onClick={() => onGenerate(true)} className="text-xs font-medium text-slate-400 hover:text-violet-600">
          ↻ Regenerate
        </button>
      </div>
    </div>
  );
}
