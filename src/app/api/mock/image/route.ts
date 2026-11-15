import { NextRequest } from "next/server";

// Mock image endpoint: renders a pretty gradient SVG placeholder with the
// prompt text, so the UI looks alive without a RunPod image endpoint.

const PALETTES = [
  ["#667eea", "#764ba2"],
  ["#f093fb", "#f5576c"],
  ["#4facfe", "#00f2fe"],
  ["#43e97b", "#38f9d7"],
  ["#fa709a", "#fee140"],
  ["#30cfd0", "#330867"],
  ["#a8edea", "#fed6e3"],
  ["#ff9a9e", "#fecfef"],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export async function GET(req: NextRequest) {
  const label = req.nextUrl.searchParams.get("label") || "generated image";
  const ar = req.nextUrl.searchParams.get("ar") || "16:9";
  const [wr, hr] = ar.split(":").map(Number);
  const width = 800;
  const height = Math.round((width * (hr || 9)) / (wr || 16));

  const h = hash(label);
  const [c1, c2] = PALETTES[h % PALETTES.length];

  const words = label.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 32) { lines.push(cur.trim()); cur = w; }
    else cur += " " + w;
    if (lines.length >= 3) break;
  }
  if (cur.trim() && lines.length < 3) lines.push(cur.trim());

  const circles = Array.from({ length: 6 }, (_, i) => {
    const cx = ((h >> (i * 3)) % 100) * (width / 100);
    const cy = ((h >> (i * 4 + 1)) % 100) * (height / 100);
    const r = 30 + ((h >> i) % 80);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" opacity="0.08"/>`;
  }).join("");

  const textLines = lines
    .map((l, i) => `<tspan x="50%" dy="${i === 0 ? 0 : 26}">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</tspan>`)
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  ${circles}
  <text x="50%" y="${height / 2 - (lines.length - 1) * 13}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="600" fill="white" opacity="0.95">${textLines}</text>
  <text x="50%" y="${height - 20}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="white" opacity="0.6">mock image — connect RUNPOD_IMAGE_ENDPOINT for FLUX</text>
</svg>`;

  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000" },
  });
}
