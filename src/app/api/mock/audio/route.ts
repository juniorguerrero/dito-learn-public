import { NextRequest } from "next/server";

// Mock TTS/audio endpoint: synthesizes a short pleasant melody as a WAV so
// audio players work end-to-end without a RunPod TTS endpoint.

const SAMPLE_RATE = 22050;
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // C major pentatonic

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export async function GET(req: NextRequest) {
  const voice = req.nextUrl.searchParams.get("voice") || "default";
  const len = Number(req.nextUrl.searchParams.get("len") || 120);
  const seconds = Math.min(8, Math.max(1.5, len / 60));
  const h = hash(voice + len);

  const totalSamples = Math.floor(SAMPLE_RATE * seconds);
  const samples = new Int16Array(totalSamples);
  const noteLen = Math.floor(SAMPLE_RATE * 0.28);
  // Different "voices" get transposed melodies so speakers sound distinct
  const transpose = voice.startsWith("am") ? 0.7 : voice.startsWith("bf") ? 1.2 : 1.0;

  for (let i = 0; i < totalSamples; i++) {
    const note = Math.floor(i / noteLen);
    const freq = SCALE[(h + note * 3) % SCALE.length] * transpose;
    const t = i / SAMPLE_RATE;
    const noteT = (i % noteLen) / noteLen;
    const env = Math.sin(Math.PI * noteT); // smooth attack/decay per note
    const fade = Math.min(1, (totalSamples - i) / (SAMPLE_RATE * 0.3));
    const s = Math.sin(2 * Math.PI * freq * t) * 0.5 + Math.sin(4 * Math.PI * freq * t) * 0.15;
    samples[i] = Math.floor(s * env * fade * 12000);
  }

  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(samples.buffer).copy(buffer, 44);

  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=31536000" },
  });
}
