"use client";

import { useState } from "react";
import { StorySlidesData } from "@/lib/types";
import { GenState } from "../Dashboard";
import TabShell from "../TabShell";

export default function StorySlidesTab({
  data,
  state,
  onGenerate,
}: {
  data?: StorySlidesData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const slides = data?.slides || [];
  const slide = slides[index];

  return (
    <TabShell
      title="Story Slides"
      description="An illustrated storybook that teaches the concepts through a narrative adventure, with AI-generated art."
      emoji="📖"
      hasData={slides.length > 0}
      state={state}
      onGenerate={onGenerate}
      generateLabel="Write my Story"
      loadingLabel="Writing your story & illustrating it…"
    >
      {slide && (
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-4 text-center text-lg font-bold text-violet-700">{data!.story_title}</h2>
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md">
            <div className="relative aspect-video w-full bg-slate-100">
              {slide.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={slide.image_url} alt={slide.title} className="h-full w-full object-cover" />
              )}
              <span className="absolute left-3 top-3 rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                {index + 1} / {slides.length}
              </span>
            </div>
            <div className="p-6">
              <h3 className="text-lg font-bold">{slide.title}</h3>
              <p className="mt-2 max-h-40 overflow-y-auto leading-relaxed text-slate-600 nice-scroll">{slide.narration}</p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-400 hover:text-violet-600">
                  🎨 image prompt
                </summary>
                <p className="mt-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">{slide.image_prompt}</p>
              </details>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-medium shadow-sm transition hover:border-violet-300 disabled:opacity-40"
            >
              ← Previous
            </button>
            <div className="flex gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIndex(i)}
                  className={`h-2 rounded-full transition-all ${i === index ? "w-6 bg-violet-600" : "w-2 bg-slate-300"}`}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
            <button
              onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
              disabled={index === slides.length - 1}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-medium shadow-sm transition hover:border-violet-300 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </TabShell>
  );
}
