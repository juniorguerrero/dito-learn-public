"use client";

import { useEffect, useRef, useState } from "react";
import { OutputType } from "@/lib/types";

export const OUTPUT_ITEMS: { key: OutputType; label: string; icon: string }[] = [
  { key: "mindmap", label: "Mind Map", icon: "🧠" },
  { key: "flashcards", label: "Flashcards", icon: "🃏" },
  { key: "story_slides", label: "Story Slides", icon: "📖" },
  { key: "podcast", label: "Podcast", icon: "🎙️" },
  { key: "story_audio", label: "Story Audio", icon: "🔊" },
  { key: "game", label: "Game", icon: "🎮" },
  { key: "video", label: "Video", icon: "🎬" },
  { key: "song", label: "Song", icon: "🎵" },
];

interface Props {
  done: Set<OutputType>;
  busy: Set<OutputType>;
  anyBusy: boolean;
  onGenerateOne: (type: OutputType) => void;
  onGenerateAll: () => void;
}

export default function GenerateMenu({ done, busy, anyBusy, onGenerateOne, onGenerateAll }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const remaining = OUTPUT_ITEMS.filter((i) => !done.has(i.key)).length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={anyBusy}
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-200 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {anyBusy ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Generating…
          </>
        ) : (
          <>✨ Generate</>
        )}
        <svg width="12" height="12" viewBox="0 0 12 12" className={`transition ${open ? "rotate-180" : ""}`}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {/* Generate everything */}
          <button
            onClick={() => { setOpen(false); onGenerateAll(); }}
            className="flex w-full items-center justify-between rounded-xl bg-violet-50 px-3 py-2.5 text-left text-sm font-semibold text-violet-700 transition hover:bg-violet-100"
          >
            <span className="flex items-center gap-2">🚀 Generate everything</span>
            <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">
              {remaining > 0 ? `${remaining} left` : "refresh"}
            </span>
          </button>

          <div className="my-1.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            or generate just one
          </div>

          {OUTPUT_ITEMS.map((item) => {
            const isDone = done.has(item.key);
            const isBusy = busy.has(item.key);
            return (
              <button
                key={item.key}
                onClick={() => { setOpen(false); onGenerateOne(item.key); }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100"
              >
                <span className="flex items-center gap-2">
                  <span>{item.icon}</span>
                  {item.label}
                </span>
                {isBusy ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
                ) : isDone ? (
                  <span className="text-xs text-slate-400">↻ redo</span>
                ) : (
                  <span className="text-[10px] font-medium text-violet-500">generate</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
