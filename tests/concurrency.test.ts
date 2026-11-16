import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Simulate real AI generation: slow, and a different result on every call
// (Claude never returns the exact same deck twice). Counts calls per type.
const calls: Record<string, number> = {};
vi.mock("@/lib/generators", async (orig) => {
  const real = await orig<typeof import("@/lib/generators")>();
  const slow = <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R> | R, mutate: (r: R, n: number) => void) =>
    async (...a: A): Promise<R> => {
      const n = (calls[name] = (calls[name] || 0) + 1);
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));
      const r = await fn(...a);
      mutate(r, n);
      return r;
    };
  return {
    ...real,
    generateFlashcards: slow("flashcards", real.generateFlashcards, (d, n) => { d.cards[0].question += ` (run ${n})`; }),
    generateMindMap: slow("mindmap", real.generateMindMap, (d, n) => { d.nodes[0].label += ` (run ${n})`; }),
    generateStorySlides: slow("story_slides", real.generateStorySlides, (d, n) => { d.story_title += ` (run ${n})`; }),
    generatePodcastScript: slow("podcast", real.generatePodcastScript, (d, n) => { d.episode_title += ` (run ${n})`; }),
    generateStoryAudioScript: slow("story_audio", real.generateStoryAudioScript, (d, n) => { d.title += ` (run ${n})`; d.narration_lines[0] += " again".repeat(n); }),
    generateGameSpec: slow("game", real.generateGameSpec, (d, n) => { d.game_title += ` (run ${n})`; }),
    generateVideoStoryboard: slow("video", real.generateVideoStoryboard, (d, n) => { d.video_title += ` (run ${n})`; }),
    generateSongSpec: slow("song", real.generateSongSpec, (d, n) => { d.song_title += ` (run ${n})`; }),
  };
});

// Speech synthesis is slow in real life: make it slower than regenerating a
// script so a regeneration can land while audio for the old script is in progress.
vi.mock("@/lib/runpod", async (orig) => {
  const real = await orig<typeof import("@/lib/runpod")>();
  return {
    ...real,
    generateTTS: async (...a: Parameters<typeof real.generateTTS>) => {
      await new Promise((r) => setTimeout(r, 120));
      return real.generateTTS(...a);
    },
  };
});

import * as generateRoute from "@/app/api/projects/[id]/generate/route";
import * as audioRoute from "@/app/api/projects/[id]/audio/route";
import * as progressRoute from "@/app/api/lessons/[id]/progress/route";
import { getProject, saveProject } from "@/lib/store";
import { flashcardDeckKey, OUTPUT_TYPES } from "@/lib/progressShared";
import { seedFixture, useTempDataDir } from "./fixtures";

useTempDataDir();
beforeEach(() => { for (const k of Object.keys(calls)) delete calls[k]; });

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });
async function generate(lessonId: string, type: string, force = false) {
  const res = await generateRoute.POST(post(`/api/projects/${lessonId}/generate`, { type, force }), { params: { id: lessonId } });
  return { status: res.status, body: await res.json() };
}

describe("many students opening lesson formats at the same time", () => {
  it("students opening different formats at once: every generated format is kept", async () => {
    const { lessonA } = seedFixture();
    saveProject({ ...lessonA, outputs: {} }); // teacher hasn't generated anything

    const results = await Promise.all(OUTPUT_TYPES.map((t) => generate(lessonA.id, t)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(Object.keys(getProject(lessonA.id)!.outputs).sort()).toEqual([...OUTPUT_TYPES].sort());
  });

  it("30 students opening the same new format at once: generated once, everyone gets the same deck", async () => {
    const { lessonA } = seedFixture();
    saveProject({ ...lessonA, outputs: {} });

    const results = await Promise.all(Array.from({ length: 30 }, () => generate(lessonA.id, "flashcards")));
    const keys = new Set(results.map((r) => flashcardDeckKey(r.body.data)));
    expect(calls.flashcards).toBe(1);
    expect(keys.size).toBe(1);
    expect(flashcardDeckKey(getProject(lessonA.id)!.outputs.flashcards)).toBe(Array.from(keys)[0]);
  });

  it("a student's flashcard progress survives other students opening the deck at the same time", async () => {
    const { lessonA, ada, ben } = seedFixture();
    saveProject({ ...lessonA, outputs: {} });

    // Ada opens flashcards first and starts studying while Ben's request is still generating.
    const adaOpen = generate(lessonA.id, "flashcards");
    await new Promise((r) => setTimeout(r, 5));
    const benOpen = generate(lessonA.id, "flashcards");
    const adaDeck = (await adaOpen).body.data;
    const benDeck = (await benOpen).body.data;
    expect(flashcardDeckKey(benDeck)).toBe(flashcardDeckKey(adaDeck)); // one deck for everyone
    const put = await progressRoute.PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify({ student_id: ada.id, rev: 1, flashcards: { deck_key: flashcardDeckKey(adaDeck), current_index: 2, known: [0, 1], review: [] } }) }),
      { params: { id: lessonA.id } }
    );
    expect(put.status).toBe(200);

    const res = await progressRoute.GET(new NextRequest(`http://localhost/x?student_id=${ada.id}`), { params: { id: lessonA.id } });
    expect((await res.json()).progress.flashcards).toMatchObject({ current_index: 2, known: [0, 1] });
    expect(ben.id).toBeTruthy();
  });

  it("synthesizing audio while another format is generated keeps both", async () => {
    const { lessonA } = seedFixture();
    saveProject({ ...lessonA, outputs: {} });
    await generate(lessonA.id, "podcast");

    const [audio, game] = await Promise.all([
      audioRoute.POST(post(`/api/projects/${lessonA.id}/audio`, { type: "podcast" }), { params: { id: lessonA.id } }),
      generate(lessonA.id, "game"),
    ]);
    expect(audio.status).toBe(200);
    expect(game.status).toBe(200);
    const saved = getProject(lessonA.id)!;
    expect(saved.outputs.game).toBeTruthy();
    expect(saved.outputs.podcast!.lines.every((l) => l.audio_url)).toBe(true);
  });

  it("audio made for an old script is not attached to a script that was regenerated meanwhile", async () => {
    const { lessonA } = seedFixture();
    saveProject({ ...lessonA, outputs: {} });
    await generate(lessonA.id, "story_audio");

    const [audio] = await Promise.all([
      audioRoute.POST(post(`/api/projects/${lessonA.id}/audio`, { type: "story_audio" }), { params: { id: lessonA.id } }),
      generate(lessonA.id, "story_audio", true), // someone clicks Regenerate at the same moment
    ]);
    expect(audio.status).toBe(200);
    const saved = getProject(lessonA.id)!.outputs.story_audio!;
    expect(saved.title).toContain("(run 2)"); // the regenerated script won
    expect(saved.narration_audio_url).toBeUndefined(); // audio made for run 1 was not attached to it
  });
});
