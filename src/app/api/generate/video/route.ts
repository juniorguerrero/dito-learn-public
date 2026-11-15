import { NextRequest, NextResponse } from "next/server";
import { generateVideo } from "@/lib/runpod";

export const maxDuration = 600;

// POST { prompt, image_url?, duration?, aspect_ratio? } -> { video_url, status }
export async function POST(req: NextRequest) {
  try {
    const { prompt, image_url, duration, aspect_ratio } = await req.json();
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const result = await generateVideo(prompt, image_url, duration, aspect_ratio);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Video generation failed" }, { status: 500 });
  }
}
