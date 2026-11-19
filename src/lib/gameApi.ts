import { NextRequest, NextResponse } from "next/server";
import { ProgressError } from "./progress";
import { GameAttemptError } from "./gameAttempts";

// Small helpers shared by the Concept Quest attempt routes.

export type BodyResult = { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse };

/** Read a JSON object body, refusing anything larger than `maxBytes`. */
export async function readJsonBody(req: NextRequest, maxBytes: number): Promise<BodyResult> {
  const tooLarge = () => ({ ok: false as const, response: NextResponse.json({ error: "Request body is too large", code: "body_too_large" }, { status: 413 }) });
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) return tooLarge();
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid request body", code: "invalid_json" }, { status: 400 }) };
  }
  if (Buffer.byteLength(text, "utf-8") > maxBytes) return tooLarge();
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return { ok: true, body };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON body", code: "invalid_json" }, { status: 400 }) };
  }
}

export function gameErrorResponse(err: unknown, label: string): NextResponse {
  if (err instanceof GameAttemptError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof ProgressError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(`${label} error`, err);
  return NextResponse.json({ error: "Something went wrong saving the game. Please try again." }, { status: 500 });
}

export const NO_STORE = { "Cache-Control": "no-store" };
