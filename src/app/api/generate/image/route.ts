import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/runpod";

export const maxDuration = 120;

// POST { prompt, style?, aspect_ratio? } -> { image_url }
export async function POST(req: NextRequest) {
  try {
    const { prompt, style, aspect_ratio } = await req.json();
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const result = await generateImage(prompt, style, aspect_ratio);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Image generation failed" }, { status: 500 });
  }
}
