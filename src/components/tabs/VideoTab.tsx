"use client";

import { useState } from "react";
import { VideoStoryboardData } from "@/lib/types";
import { GenState } from "../Dashboard";
import TabShell from "../TabShell";

export default function VideoTab({
  data,
  state,
  onGenerate,
}: {
  data?: VideoStoryboardData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
}) {
  const [rendering, setRendering] = useState<number | null>(null);
  const [videoUrls, setVideoUrls] = useState<Record<number, string>>({});
  const [renderError, setRenderError] = useState("");

  // Persisted (pre-baked) clips take priority over anything rendered this session.
  const clipUrl = (i: number): string | undefined => videoUrls[i] || data?.scenes[i]?.video_url;

  async function renderScene(i: number) {
    if (!data) return;
    const scene = data.scenes[i];
    setRendering(i);
    setRenderError("");
    try {
      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: scene.video_prompt,
          image_url: scene.image_url,
          duration: scene.duration,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Video render failed");
      if (json.status === "mock_unavailable") {
        setRenderError("No RUNPOD_VIDEO_ENDPOINT configured — connect Wan2.2 TI2V 5B to render clips.");
      } else if (json.video_url) {
        setVideoUrls((v) => ({ ...v, [i]: json.video_url }));
      }
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "Render failed");
    } finally {
      setRendering(null);
    }
  }

  const totalDuration = data?.scenes.reduce((s, sc) => s + sc.duration, 0) || 0;

  return (
    <TabShell
      title="Video"
      description="A scene-by-scene storyboard with keyframe images, narration, and motion prompts — ready to render with Wan2.2 on RunPod."
      emoji="🎬"
      hasData={Boolean(data)}
      state={state}
      onGenerate={onGenerate}
      generateLabel="Create Storyboard"
      loadingLabel="Storyboarding your video…"
    >
      {data && (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="font-bold">{data.video_title}</h2>
              <p className="text-xs text-slate-400">
                {data.scenes.length} scenes · ~{totalDuration}s total · image-to-video via Wan2.2 TI2V 5B
              </p>
            </div>
            {renderError && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{renderError}</p>}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.scenes.map((scene, i) => (
              <div key={i} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="relative aspect-video bg-slate-100">
                  {clipUrl(i) ? (
                    <video src={clipUrl(i)} controls className="h-full w-full object-cover" />
                  ) : (
                    scene.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={scene.image_url} alt={scene.title} className="h-full w-full object-cover" />
                    )
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2.5 py-0.5 text-[11px] font-medium text-white">
                    Scene {i + 1} · {scene.duration}s · {scene.camera_motion}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="font-semibold text-sm">{scene.title}</h3>
                  <p className="mt-1 flex-1 text-sm text-slate-600 line-clamp-3">{scene.narration}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-slate-400 hover:text-violet-600">🎥 motion prompt</summary>
                    <p className="mt-1 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">{scene.video_prompt}</p>
                  </details>
                  {!clipUrl(i) && (
                    <button
                      onClick={() => renderScene(i)}
                      disabled={rendering !== null}
                      className="mt-3 rounded-xl border border-violet-200 bg-violet-50 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
                    >
                      {rendering === i ? "Rendering… (Wan2.2 is slow)" : "🎬 Render clip"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </TabShell>
  );
}
