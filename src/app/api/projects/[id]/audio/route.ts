import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/store";
import { generateTTS, generateMusic } from "@/lib/runpod";

export const maxDuration = 600;

const TEACHER_VOICE = process.env.KOKORO_TEACHER_VOICE || "af_heart";
const STUDENT_VOICE = process.env.KOKORO_STUDENT_VOICE || "am_adam";
const NARRATOR_VOICE = process.env.KOKORO_NARRATOR_VOICE || "bf_emma";

// POST { type: "podcast" | "story_audio" }
// Synthesizes TTS audio for an already-generated script.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { type } = (await req.json()) as { type: "podcast" | "story_audio" | "song" };

  try {
    if (type === "podcast") {
      const podcast = project.outputs.podcast;
      if (!podcast) return NextResponse.json({ error: "Generate the podcast script first" }, { status: 400 });
      await Promise.all(
        podcast.lines.map(async (line) => {
          const tts = await generateTTS(line.text, line.speaker === "Teacher" ? TEACHER_VOICE : STUDENT_VOICE);
          line.audio_url = tts.audio_url;
        })
      );
      saveProject(project);
      return NextResponse.json({ type, data: podcast });
    }

    if (type === "story_audio") {
      const story = project.outputs.story_audio;
      if (!story) return NextResponse.json({ error: "Generate the story audio script first" }, { status: 400 });
      const tts = await generateTTS(story.narration_lines.join(" ... "), NARRATOR_VOICE);
      story.narration_audio_url = tts.audio_url;
      saveProject(project);
      return NextResponse.json({ type, data: story });
    }

    if (type === "song") {
      const song = project.outputs.song;
      if (!song) return NextResponse.json({ error: "Generate the song first" }, { status: 400 });
      const music = await generateMusic(song.music_prompt, song.lyrics, 30);
      if (music.audio_url) {
        song.audio_url = music.audio_url;
        saveProject(project);
      }
      return NextResponse.json({ type, data: song });
    }

    return NextResponse.json({ error: `Unknown audio type: ${type}` }, { status: 400 });
  } catch (err) {
    console.error(`audio ${type} error`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Audio synthesis failed" },
      { status: 500 }
    );
  }
}
