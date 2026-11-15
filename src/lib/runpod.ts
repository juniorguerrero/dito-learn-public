import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

// Wrappers around RunPod Flash serverless endpoints for the media models.
//
// Each endpoint env var may be EITHER:
//   - a full URL:      https://api.runpod.ai/v2/<id>/runsync
//   - a bare endpoint id: <id>   (we build the URL for you)
// Auth uses RUNPOD_API_KEY (Bearer). If an endpoint var is missing, we fall
// back to mock assets so the whole UI still works locally.

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || "";
const POLL_INTERVAL_MS = Number(process.env.RUNPOD_POLL_INTERVAL_SECONDS || 3) * 1000;
const REQUEST_TIMEOUT_MS = Number(process.env.RUNPOD_REQUEST_TIMEOUT_SECONDS || 300) * 1000;

function runsyncUrl(endpoint: string): string {
  if (endpoint.startsWith("http")) return endpoint;
  return `https://api.runpod.ai/v2/${endpoint}/runsync`;
}
function runUrl(endpoint: string): string {
  // async submit endpoint — returns a job id immediately (for long jobs like video)
  if (endpoint.startsWith("http")) return endpoint.replace(/\/runsync$/, "/run");
  return `https://api.runpod.ai/v2/${endpoint}/run`;
}
function statusUrl(endpoint: string, jobId: string): string {
  const base = endpoint.startsWith("http")
    ? endpoint.replace(/\/(runsync|run)$/, "")
    : `https://api.runpod.ai/v2/${endpoint}`;
  return `${base}/status/${jobId}`;
}

const authHeaders = () => ({
  "Content-Type": "application/json",
  ...(RUNPOD_API_KEY ? { Authorization: `Bearer ${RUNPOD_API_KEY}` } : {}),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call a RunPod Flash endpoint and return its `output`.
 * Handles both synchronous responses and async jobs (polls /status until done).
 */
async function callRunpod(endpoint: string, input: Record<string, unknown>, async = false): Promise<any> {
  // Long jobs (video) use /run to avoid Cloudflare's ~100s sync timeout (520s); everything else uses /runsync.
  const url = async ? runUrl(endpoint) : runsyncUrl(endpoint);
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`RunPod error ${res.status}: ${await res.text()}`);
  let result = await res.json();

  // Async job: poll /status until terminal.
  if (result.id && !["COMPLETED", "FAILED", "CANCELLED"].includes(result.status) && !result.output) {
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const s = await fetch(statusUrl(endpoint, String(result.id)), { headers: authHeaders() });
      if (!s.ok) throw new Error(`RunPod status error ${s.status}`);
      result = await s.json();
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(result.status) || result.output || result.error) break;
    }
  }

  if (result.status === "FAILED" || result.error) {
    throw new Error(`RunPod job failed: ${result.error || "unknown error"}`);
  }
  return result.output ?? result;
}

/** Save a base64 asset into public/generated and return its public URL. */
function saveBase64Asset(base64: string, ext: string): string {
  const dir = path.join(process.cwd(), "public", "generated");
  fs.mkdirSync(dir, { recursive: true });
  const clean = base64.includes(",") ? base64.split(",")[1] : base64; // strip data: prefix if present
  const name = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(clean, "base64"));
  return `/generated/${name}`;
}

// Pull an asset URL or base64 out of a variety of common worker output shapes.
function extractAsset(out: any, kind: "image" | "audio" | "video", ext: string): string | null {
  if (!out) return null;
  const url = out[`${kind}_url`] || out.url || out.output_url;
  if (typeof url === "string") return url;
  const b64 =
    out[`${kind}_base64`] ||
    out.base64 ||
    out[kind] ||
    (Array.isArray(out.images) ? out.images[0] : undefined) ||
    (Array.isArray(out.audio) ? out.audio[0] : undefined);
  if (typeof b64 === "string" && b64.length > 100) return saveBase64Asset(b64, ext);
  return null;
}

export interface ImageResult { image_url: string; mock: boolean }

export async function generateImage(prompt: string, style?: string, aspectRatio = "16:9"): Promise<ImageResult> {
  const endpoint = process.env.RUNPOD_IMAGE_ENDPOINT;
  if (!endpoint) {
    const seed = encodeURIComponent(prompt.slice(0, 80));
    return { image_url: `/api/mock/image?label=${seed}&ar=${aspectRatio}`, mock: true };
  }
  const out = await callRunpod(endpoint, {
    prompt: style ? `${prompt}, ${style}` : prompt,
    aspect_ratio: aspectRatio,
    width: aspectRatio === "16:9" ? 1024 : 768,
    height: aspectRatio === "16:9" ? 576 : 768,
  });
  const asset = extractAsset(out, "image", "png");
  if (!asset) throw new Error("RunPod image endpoint returned no image");
  return { image_url: asset, mock: false };
}

export interface TTSResult { audio_url: string; mock: boolean }

export async function generateTTS(text: string, voice = "af_heart"): Promise<TTSResult> {
  const endpoint = process.env.RUNPOD_TTS_ENDPOINT;
  if (!endpoint) {
    return { audio_url: `/api/mock/audio?voice=${encodeURIComponent(voice)}&len=${Math.min(text.length, 400)}`, mock: true };
  }
  const out = await callRunpod(endpoint, { text, voice });
  const asset = extractAsset(out, "audio", "wav");
  if (!asset) throw new Error("RunPod TTS endpoint returned no audio");
  return { audio_url: asset, mock: false };
}

export interface VideoResult { video_url: string | null; status: "done" | "mock_unavailable"; }

export async function generateVideo(prompt: string, imageUrl?: string, duration = 5, aspectRatio = "16:9"): Promise<VideoResult> {
  const endpoint = process.env.RUNPOD_VIDEO_ENDPOINT;
  if (!endpoint) return { video_url: null, status: "mock_unavailable" };
  const out = await callRunpod(endpoint, { prompt, image_url: imageUrl, duration, aspect_ratio: aspectRatio }, true);
  const asset = extractAsset(out, "video", "mp4");
  if (!asset) throw new Error("RunPod video endpoint returned no video");
  return { video_url: asset, status: "done" };
}

export interface MusicResult { audio_url: string | null; status: "done" | "mock_unavailable"; }

export async function generateMusic(prompt: string, lyrics?: string, duration = 60): Promise<MusicResult> {
  const endpoint = process.env.RUNPOD_MUSIC_ENDPOINT;
  if (!endpoint) return { audio_url: null, status: "mock_unavailable" };
  const out = await callRunpod(endpoint, { prompt, lyrics, duration });
  const asset = extractAsset(out, "audio", "wav");
  if (!asset) throw new Error("RunPod music endpoint returned no audio");
  return { audio_url: asset, status: "done" };
}
