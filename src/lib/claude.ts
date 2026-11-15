import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

export function hasClaudeKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Ask Claude for a JSON object. The prompt must describe the exact schema.
 * We prefill "{" so the model responds with raw JSON, and we still strip
 * code fences defensively before parsing.
 */
export async function claudeJSON<T>(
  system: string,
  userPrompt: string,
  maxTokens = 8000
): Promise<T> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [
      { role: "user", content: userPrompt },
      { role: "assistant", content: "{" },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  let text = "{" + (block && block.type === "text" ? block.text : "");
  text = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  // Trim anything after the final closing brace
  const last = text.lastIndexOf("}");
  if (last !== -1) text = text.slice(0, last + 1);

  return JSON.parse(text) as T;
}
