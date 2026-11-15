import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/store";
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
import { OutputType } from "@/lib/types";

export const maxDuration = 300;

// POST { type: OutputType, force?: boolean }
// Generates (and caches) one learning output from the project's blueprint.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { type, force } = (await req.json()) as { type: OutputType; force?: boolean };

  if (!force && project.outputs[type]) {
    return NextResponse.json({ type, data: project.outputs[type], cached: true });
  }

  const bp = project.blueprint;
  try {
    switch (type) {
      case "mindmap":
        project.outputs.mindmap = await generateMindMap(bp);
        break;
      case "flashcards":
        project.outputs.flashcards = await generateFlashcards(bp);
        break;
      case "story_slides": {
        const data = await generateStorySlides(bp);
        await Promise.all(
          data.slides.map(async (s) => {
            const img = await generateImage(s.image_prompt, bp.visual_style);
            s.image_url = img.image_url;
          })
        );
        project.outputs.story_slides = data;
        break;
      }
      case "podcast":
        project.outputs.podcast = await generatePodcastScript(bp);
        break;
      case "story_audio":
        project.outputs.story_audio = await generateStoryAudioScript(bp);
        break;
      case "game": {
        const data = await generateGameSpec(bp);
        await Promise.all(
          data.levels.map(async (l) => {
            const img = await generateImage(l.background_prompt, bp.visual_style);
            l.background_url = img.image_url;
          })
        );
        project.outputs.game = data;
        break;
      }
      case "video": {
        const data = await generateVideoStoryboard(bp);
        await Promise.all(
          data.scenes.map(async (s) => {
            const img = await generateImage(s.image_prompt, bp.visual_style);
            s.image_url = img.image_url;
          })
        );
        project.outputs.video = data;
        break;
      }
      case "song":
        project.outputs.song = await generateSongSpec(bp);
        break;
      default:
        return NextResponse.json({ error: `Unknown output type: ${type}` }, { status: 400 });
    }

    saveProject(project);
    return NextResponse.json({ type, data: project.outputs[type], cached: false });
  } catch (err) {
    console.error(`generate ${type} error`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
