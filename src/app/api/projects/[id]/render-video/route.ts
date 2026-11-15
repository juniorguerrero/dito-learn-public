import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/store";
import { generateVideo } from "@/lib/runpod";

export const maxDuration = 800;

// POST { scenes?: number[] }  (default: [0] — the hook scene)
// Renders the given storyboard scenes into video clips (Wan2.2) and persists
// scene.video_url so the demo shows them without any real-time generation.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const video = project.outputs.video;
  if (!video) return NextResponse.json({ error: "Generate the video storyboard first" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const indices: number[] = Array.isArray(body.scenes) && body.scenes.length ? body.scenes : [0];

  const rendered: number[] = [];
  try {
    for (const i of indices) {
      const scene = video.scenes[i];
      if (!scene) continue;
      const res = await generateVideo(scene.video_prompt, scene.image_url, scene.duration, "16:9");
      if (res.video_url) {
        scene.video_url = res.video_url;
        rendered.push(i);
        saveProject(project); // save after each clip so progress persists even if a later one fails
      }
    }
    return NextResponse.json({ rendered, scenes: video.scenes.map((s) => ({ title: s.title, video_url: s.video_url })) });
  } catch (err) {
    saveProject(project);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Video render failed", rendered },
      { status: 500 }
    );
  }
}
