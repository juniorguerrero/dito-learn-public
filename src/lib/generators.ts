import { claudeJSON, hasClaudeKey } from "./claude";
import {
  LearningBlueprint,
  StudentProfile,
  MindMapData,
  FlashcardsData,
  StorySlidesData,
  PodcastData,
  StoryAudioData,
  GameSpecData,
  VideoStoryboardData,
  SongSpecData,
} from "./types";
import * as mocks from "./mocks";

// Mock mode answers instantly, which hides timing problems that only show up
// when generation takes seconds (as it does with Claude). For realistic testing
// and demos, MOCK_GENERATION_DELAY_MS adds that latency. Default 0: no change.
async function mockResult<T>(value: T): Promise<T> {
  const ms = Number(process.env.MOCK_GENERATION_DELAY_MS) || 0;
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  return value;
}

const BLUEPRINT_SYSTEM = `You are Antclass, an expert learning designer. You turn raw study documents into a structured "Learning Blueprint" that powers mind maps, flashcards, stories, podcasts, games, videos and songs. You always respond with valid JSON only — no prose, no markdown.`;

export async function createLearningBlueprint(
  documentText: string,
  profile: StudentProfile
): Promise<LearningBlueprint> {
  if (!hasClaudeKey()) return mockResult(mocks.mockBlueprint(documentText, profile));

  const prompt = `Analyze this learning document and produce a Learning Blueprint as JSON.

STUDENT PROFILE:
- Grade level: ${profile.grade_level}
- Goal: ${profile.goal}
- Preferred style: ${profile.preferred_style}
- Available study time: ${profile.study_time}

JSON schema (respond with exactly this shape):
{
  "title": string,
  "student_level": string,
  "subject": string,
  "summary": string (3-5 sentences),
  "learning_objectives": string[] (4-6 items),
  "key_concepts": [{ "name": string, "definition": string, "example": string, "common_misconception": string }] (5-8 concepts),
  "chapters": [{ "title": string, "summary": string, "concepts": string[] }] (2-5 chapters, concepts reference key_concepts by name),
  "visual_style": string (an art-direction phrase matching the student's preferred style, e.g. "warm hand-drawn watercolor, friendly, bright"),
  "tone": string,
  "quiz_difficulty": "easy" | "medium" | "hard" (matched to grade level)
}

Adapt vocabulary and depth to the student's grade level. Do NOT just summarize — extract teachable structure.

DOCUMENT:
"""
${documentText.slice(0, 60000)}
"""`;

  return claudeJSON<LearningBlueprint>(BLUEPRINT_SYSTEM, prompt);
}

function blueprintContext(bp: LearningBlueprint): string {
  return `LEARNING BLUEPRINT (the single source of truth — every output must stay consistent with it):
${JSON.stringify(bp, null, 2)}`;
}

export async function generateMindMap(bp: LearningBlueprint): Promise<MindMapData> {
  if (!hasClaudeKey()) return mockResult(mocks.mockMindMap(bp));
  const prompt = `${blueprintContext(bp)}

Create a mind map as JSON:
{
  "nodes": [{ "id": string, "label": string (max 5 words), "type": "root"|"chapter"|"concept"|"detail", "description": string (one sentence) }],
  "edges": [{ "source": string, "target": string, "label": string (optional relationship, max 3 words) }]
}
Rules: exactly one root node (the title). Chapters connect to root. Concepts connect to their chapter. Add 1-2 "detail" nodes per concept for examples/misconceptions. 15-30 nodes total. Every edge must reference existing node ids.`;
  return claudeJSON<MindMapData>(BLUEPRINT_SYSTEM, prompt);
}

export async function generateFlashcards(bp: LearningBlueprint): Promise<FlashcardsData> {
  if (!hasClaudeKey()) return mockResult(mocks.mockFlashcards(bp));
  const prompt = `${blueprintContext(bp)}

Create 10-14 flashcards as JSON:
{ "cards": [{ "question": string, "answer": string (2-3 sentences max), "hint": string, "difficulty": "easy"|"medium"|"hard", "tags": string[] }] }
Cover every key concept at least once. Include cards that target the common misconceptions. Match overall difficulty to quiz_difficulty="${bp.quiz_difficulty}".`;
  return claudeJSON<FlashcardsData>(BLUEPRINT_SYSTEM, prompt);
}

export async function generateStorySlides(bp: LearningBlueprint): Promise<StorySlidesData> {
  if (!hasClaudeKey()) return mockResult(mocks.mockStorySlides(bp));
  const prompt = `${blueprintContext(bp)}

Write a short educational story that teaches the key concepts through narrative, as 6-8 slides:
{
  "story_title": string,
  "slides": [{ "title": string, "narration": string (3-4 sentences, story prose that teaches a concept), "image_prompt": string (detailed image generation prompt in the blueprint's visual_style: "${bp.visual_style}", no text in image) }]
}
The story needs a protagonist, a journey, and each slide should weave in one key concept naturally. Tone: ${bp.tone}.`;
  return claudeJSON<StorySlidesData>(BLUEPRINT_SYSTEM, prompt);
}

export async function generatePodcastScript(bp: LearningBlueprint): Promise<PodcastData> {
  if (!hasClaudeKey()) return mockResult(mocks.mockPodcast(bp));
  const prompt = `${blueprintContext(bp)}

Write a two-person educational podcast script as JSON:
{
  "episode_title": string,
  "lines": [{ "speaker": "Teacher"|"Student", "text": string (1-3 sentences, natural spoken language) }]
}
16-24 lines, alternating. The Student asks curious questions and makes the common misconceptions (which the Teacher corrects kindly). Cover all key concepts. Start with a fun hook, end with a recap. Keep each line short enough to speak in under 15 seconds.`;
  return claudeJSON<PodcastData>(BLUEPRINT_SYSTEM, prompt);
}

export async function generateStoryAudioScript(bp: LearningBlueprint): Promise<StoryAudioData> {
  if (!hasClaudeKey()) return mockResult(mocks.mockStoryAudio(bp));
  const prompt = `${blueprintContext(bp)}

Write a narrated audio-story script with sound design cues as JSON:
{
  "title": string,
  "narration_lines": string[] (10-16 lines of narration, each 1-2 sentences, dramatic storytelling that teaches the concepts),
  "sound_cues": [{ "at_line": number (0-based index into narration_lines), "description": string (e.g. "soft rain loop fades in", "magical chime") }]
}
5-8 sound cues total. Tone: ${bp.tone}.`;
  return claudeJSON<StoryAudioData>(BLUEPRINT_SYSTEM, prompt);
}

export async function generateGameSpec(bp: LearningBlueprint): Promise<GameSpecData> {
  if (!hasClaudeKey()) return mockResult(mocks.mockGameSpec(bp));
  const prompt = `${blueprintContext(bp)}

Design "Concept Quest", an educational game, as JSON:
{
  "game_title": string (playful, references the subject),
  "intro_text": string (2 sentences setting up the quest),
  "levels": [{
    "title": string,
    "concept_name": string (a key concept name),
    "concept_explanation": string (2-3 sentences shown before the level, kid-friendly),
    "quiz_gates": [{ "question": string, "options": string[4], "correct_index": number, "explanation": string }] (exactly 3),
    "matching_pairs": [{ "term": string, "match": string }] (exactly 4 pairs),
    "boss_question": { "question": string (harder, synthesis-level), "options": string[4], "correct_index": number, "explanation": string },
    "background_prompt": string (image prompt for the level backdrop in style: "${bp.visual_style}")
  }] (3-4 levels, one per major concept)
}
Difficulty: ${bp.quiz_difficulty}. Wrong-answer options must be plausible (use the misconceptions).`;
  return claudeJSON<GameSpecData>(BLUEPRINT_SYSTEM, prompt, 12000);
}

export async function generateVideoStoryboard(bp: LearningBlueprint): Promise<VideoStoryboardData> {
  if (!hasClaudeKey()) return mockResult(mocks.mockVideoStoryboard(bp));
  const prompt = `${blueprintContext(bp)}

Create a 60-90 second educational video storyboard as JSON:
{
  "video_title": string,
  "scenes": [{
    "title": string,
    "narration": string (voiceover, 2 sentences),
    "image_prompt": string (keyframe image prompt, style: "${bp.visual_style}", no text in image),
    "video_prompt": string (motion description for image-to-video, e.g. "slow push-in as leaves sway"),
    "duration": number (seconds, 5-10),
    "camera_motion": string ("push-in"|"pull-out"|"pan-left"|"pan-right"|"static"|"tilt-up")
  }] (6-9 scenes)
}
Scene 1 hooks, middle scenes teach one concept each, last scene recaps.`;
  return claudeJSON<VideoStoryboardData>(BLUEPRINT_SYSTEM, prompt);
}

export async function generateSongSpec(bp: LearningBlueprint): Promise<SongSpecData> {
  if (!hasClaudeKey()) return mockResult(mocks.mockSongSpec(bp));
  const prompt = `${blueprintContext(bp)}

Write a study song as JSON:
{
  "song_title": string,
  "genre": string (pick something fun that fits tone "${bp.tone}"),
  "tempo": string (e.g. "95 BPM, upbeat"),
  "learning_hook": string (the one line students will remember forever),
  "music_prompt": string (a prompt for a music generation model: genre, mood, instruments, tempo),
  "lyrics": string (verse 1, chorus, verse 2, chorus — chorus encodes the most important concept; use \\n for line breaks)
}
Lyrics must be factually accurate to the blueprint and singable.`;
  return claudeJSON<SongSpecData>(BLUEPRINT_SYSTEM, prompt);
}
