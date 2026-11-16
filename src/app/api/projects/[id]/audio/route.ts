import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/store";
import { generateTTS, generateMusic } from "@/lib/runpod";
import { singleFlight } from "@/lib/singleFlight";

export const maxDuration = 600;

const TEACHER_VOICE = process.env.KOKORO_TEACHER_VOICE || "af_heart";
const STUDENT_VOICE = process.env.KOKORO_STUDENT_VOICE || "am_adam";
const NARRATOR_VOICE = process.env.KOKORO_NARRATOR_VOICE || "bf_emma";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// POST { type: "podcast" | "story_audio" | "song" }
// Synthesizes audio for an already-generated script.
//
// Safe with many students at once: identical requests share one synthesis, and
// the audio is merged into the *current* lesson file (other outputs are never
// overwritten). Audio is only attached if the script is still the one it was
// made for; if someone regenerated the script meanwhile, it's not attached.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { type } = (await req.json()) as { type: "podcast" | "story_audio" | "song" };

  try {
    if (type === "podcast") {
      const podcast = project.outputs.podcast;
      if (!podcast) return NextResponse.json({ error: "Generate the podcast script first" }, { status: 400 });
      const texts = podcast.lines.map((l) => l.text);
      const urls = await singleFlight(`audio:${params.id}:podcast:${JSON.stringify(texts)}`, () =>
        Promise.all(
          podcast.lines.map(async (line) => (await generateTTS(line.text, line.speaker === "Teacher" ? TEACHER_VOICE : STUDENT_VOICE)).audio_url)
        )
      );
      const saved = updateProject(params.id, (cur) => {
        const p = cur.outputs.podcast;
        if (p && same(p.lines.map((l) => l.text), texts)) p.lines.forEach((l, i) => (l.audio_url = urls[i]));
      });
      return NextResponse.json({ type, data: saved?.outputs.podcast ?? podcast });
    }

    if (type === "story_audio") {
      const story = project.outputs.story_audio;
      if (!story) return NextResponse.json({ error: "Generate the story audio script first" }, { status: 400 });
      const lines = story.narration_lines;
      const url = await singleFlight(`audio:${params.id}:story_audio:${JSON.stringify(lines)}`, async () =>
        (await generateTTS(lines.join(" ... "), NARRATOR_VOICE)).audio_url
      );
      const saved = updateProject(params.id, (cur) => {
        const s = cur.outputs.story_audio;
        if (s && same(s.narration_lines, lines)) s.narration_audio_url = url;
      });
      return NextResponse.json({ type, data: saved?.outputs.story_audio ?? story });
    }

    if (type === "song") {
      const song = project.outputs.song;
      if (!song) return NextResponse.json({ error: "Generate the song first" }, { status: 400 });
      const music = await singleFlight(`audio:${params.id}:song:${song.music_prompt}\u0000${song.lyrics}`, () =>
        generateMusic(song.music_prompt, song.lyrics, 30)
      );
      const url = music.audio_url;
      const saved = url
        ? updateProject(params.id, (cur) => {
            const s = cur.outputs.song;
            if (s && s.lyrics === song.lyrics && s.music_prompt === song.music_prompt) s.audio_url = url;
          })
        : null;
      return NextResponse.json({ type, data: saved?.outputs.song ?? song });
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
