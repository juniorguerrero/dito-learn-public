import { NextRequest, NextResponse } from "next/server";
import { generateMusic } from "@/lib/runpod";

export const maxDuration = 600;

// POST { prompt, lyrics?, duration? } -> { audio_url, status }
export async function POST(req: NextRequest) {
  try {
    const { prompt, lyrics, duration } = await req.json();
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const result = await generateMusic(prompt, lyrics, duration);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Music generation failed" }, { status: 500 });
  }
}
