import { NextRequest, NextResponse } from "next/server";
import { generateTTS } from "@/lib/runpod";

export const maxDuration = 120;

// POST { text, voice? } -> { audio_url }
export async function POST(req: NextRequest) {
  try {
    const { text, voice } = await req.json();
    if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
    const result = await generateTTS(text, voice);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "TTS failed" }, { status: 500 });
  }
}
