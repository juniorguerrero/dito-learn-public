import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/store";
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
  // Attach each clip to the *current* lesson file as soon as it's ready (so other
  // outputs saved meanwhile are kept), and only if that scene wasn't regenerated.
  const attach = (i: number, prompt: string, url: string) =>
    updateProject(params.id, (cur) => {
      const sc = cur.outputs.video?.scenes[i];
      if (sc && sc.video_prompt === prompt) sc.video_url = url;
    });
  try {
    for (const i of indices) {
      const scene = video.scenes[i];
      if (!scene) continue;
      const res = await generateVideo(scene.video_prompt, scene.image_url, scene.duration, "16:9");
      if (res.video_url) {
        scene.video_url = res.video_url;
        rendered.push(i);
        attach(i, scene.video_prompt, res.video_url);
      }
    }
    return NextResponse.json({ rendered, scenes: video.scenes.map((s) => ({ title: s.title, video_url: s.video_url })) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Video render failed", rendered },
      { status: 500 }
    );
  }
}
