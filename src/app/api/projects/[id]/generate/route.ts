import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/store";
import {
  generateMindMap,
  generateFlashcards,
  generateStorySlides,
  generatePodcastScript,
  generateStoryAudioScript,
  generateGameSpec,
  generateVideoStoryboard,
  generateSongSpec,
} from "@/lib/generators";
import { generateImage } from "@/lib/runpod";
import { isOutputType } from "@/lib/progressShared";
import { singleFlight } from "@/lib/singleFlight";
import { LearningBlueprint, OutputType, Project } from "@/lib/types";

export const maxDuration = 300;

type OutputData = NonNullable<Project["outputs"][OutputType]>;

// The slow part: build one output from the blueprint (no store access here).
async function buildOutput(type: OutputType, bp: LearningBlueprint): Promise<OutputData> {
  switch (type) {
    case "mindmap":
      return generateMindMap(bp);
    case "flashcards":
      return generateFlashcards(bp);
    case "story_slides": {
      const data = await generateStorySlides(bp);
      await Promise.all(
        data.slides.map(async (s) => {
          const img = await generateImage(s.image_prompt, bp.visual_style);
          s.image_url = img.image_url;
        })
      );
      return data;
    }
    case "podcast":
      return generatePodcastScript(bp);
    case "story_audio":
      return generateStoryAudioScript(bp);
    case "game": {
      const data = await generateGameSpec(bp);
      await Promise.all(
        data.levels.map(async (l) => {
          const img = await generateImage(l.background_prompt, bp.visual_style);
          l.background_url = img.image_url;
        })
      );
      return data;
    }
    case "video": {
      const data = await generateVideoStoryboard(bp);
      await Promise.all(
        data.scenes.map(async (s) => {
          const img = await generateImage(s.image_prompt, bp.visual_style);
          s.image_url = img.image_url;
        })
      );
      return data;
    }
    case "song":
      return generateSongSpec(bp);
  }
}

// POST { type: OutputType, force?: boolean }
// Generates (and caches) one learning output from the project's blueprint.
//
// Many students can hit this at once (formats are generated on first open):
// - identical requests share one generation (one AI call, one deck for everyone);
// - the result is merged into the *current* lesson file, so outputs generated
//   concurrently for other formats are never overwritten.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { type, force } = (await req.json()) as { type: unknown; force?: boolean };
  if (!isOutputType(type)) return NextResponse.json({ error: `Unknown output type: ${String(type)}` }, { status: 400 });

  if (!force && project.outputs[type]) {
    return NextResponse.json({ type, data: project.outputs[type], cached: true });
  }

  try {
    const key = `generate:${params.id}:${type}:${force ? "regenerate" : "fill"}`;
    const data = await singleFlight(key, async () => {
      // Filled by a request that finished just before this one joined? Reuse it.
      const fresh = getProject(params.id);
      if (!force && fresh?.outputs[type]) return fresh.outputs[type] as OutputData;
      return buildOutput(type, project.blueprint);
    });

    const saved = updateProject(params.id, (current) => {
      // A plain "open" never replaces an output someone else already saved.
      if (!force && current.outputs[type]) return;
      (current.outputs as Record<OutputType, OutputData>)[type] = data;
    });
    if (!saved) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ type, data: saved.outputs[type], cached: false });
  } catch (err) {
    console.error(`generate ${type} error`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
