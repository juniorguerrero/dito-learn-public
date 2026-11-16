// ---------- Learning Blueprint ----------

export interface KeyConcept {
  name: string;
  definition: string;
  example: string;
  common_misconception: string;
}

export interface Chapter {
  title: string;
  summary: string;
  concepts: string[];
}

export interface LearningBlueprint {
  title: string;
  student_level: string;
  subject: string;
  summary: string;
  learning_objectives: string[];
  key_concepts: KeyConcept[];
  chapters: Chapter[];
  visual_style: string;
  tone: string;
  quiz_difficulty: "easy" | "medium" | "hard";
}

export interface StudentProfile {
  grade_level: string;
  goal: string;
  preferred_style: string;
  study_time: string;
}

// ---------- Generated outputs ----------

export interface MindMapNode {
  id: string;
  label: string;
  type: "root" | "chapter" | "concept" | "detail";
  description?: string;
}

export interface MindMapEdge {
  source: string;
  target: string;
  label?: string;
}

export interface MindMapData {
  nodes: MindMapNode[];
  edges: MindMapEdge[];
}

export interface Flashcard {
  question: string;
  answer: string;
  hint: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
}

export interface FlashcardsData {
  cards: Flashcard[];
}

export interface StorySlide {
  title: string;
  narration: string;
  image_prompt: string;
  image_url?: string;
}

export interface StorySlidesData {
  story_title: string;
  slides: StorySlide[];
}

export interface PodcastLine {
  speaker: "Teacher" | "Student";
  text: string;
  audio_url?: string;
}

export interface PodcastData {
  episode_title: string;
  lines: PodcastLine[];
  full_audio_url?: string;
}

export interface SoundCue {
  at_line: number;
  description: string;
}

export interface StoryAudioData {
  title: string;
  narration_lines: string[];
  sound_cues: SoundCue[];
  narration_audio_url?: string;
}

export interface QuizGate {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface MatchingPair {
  term: string;
  match: string;
}

export interface GameLevel {
  title: string;
  concept_name: string;
  concept_explanation: string;
  quiz_gates: QuizGate[];
  matching_pairs: MatchingPair[];
  boss_question: QuizGate;
  background_prompt: string;
  background_url?: string;
}

export interface GameSpecData {
  game_title: string;
  intro_text: string;
  levels: GameLevel[];
}

export interface VideoScene {
  title: string;
  narration: string;
  image_prompt: string;
  video_prompt: string;
  duration: number;
  camera_motion: string;
  image_url?: string;
  video_url?: string;
}

export interface VideoStoryboardData {
  video_title: string;
  scenes: VideoScene[];
}

export interface SongSpecData {
  song_title: string;
  genre: string;
  tempo: string;
  learning_hook: string;
  music_prompt: string;
  lyrics: string;
  audio_url?: string;
}

// ---------- Project (a single uploaded document + everything generated) ----------

export type OutputType =
  | "mindmap"
  | "flashcards"
  | "story_slides"
  | "podcast"
  | "story_audio"
  | "game"
  | "video"
  | "song";

export interface Project {
  id: string;
  created_at: string;
  source_name: string;
  document_text: string;
  student_profile: StudentProfile;
  blueprint: LearningBlueprint;
  outputs: Partial<{
    mindmap: MindMapData;
    flashcards: FlashcardsData;
    story_slides: StorySlidesData;
    podcast: PodcastData;
    story_audio: StoryAudioData;
    game: GameSpecData;
    video: VideoStoryboardData;
    song: SongSpecData;
  }>;
  // Platform linkage (a Project is a "Lesson" once attached to a classroom)
  classroom_id?: string;
  professor_name?: string;
}

// ---------- Platform: classrooms, students, observability ----------

export interface Classroom {
  id: string;
  name: string;
  subject: string;
  description: string;
  professor_name: string;
  join_code: string;
  created_at: string;
  lesson_ids: string[]; // Project ids
  is_demo?: boolean; // created by "Load demo data"
}

export interface Student {
  id: string;
  name: string;
  interests: string[];
  // AI-generated personalization shown in the student's sidebar
  vibe?: {
    greeting: string;
    motivation: string;
    hero_image_prompt: string;
    hero_image_url?: string;
    favorite_modality_guess: OutputType;
  };
  classroom_ids: string[];
  created_at: string;
}

export type EventType =
  | "lesson_open"
  | "modality_open"
  | "modality_complete"
  | "question"
  | "game_result";

export interface LearningEvent {
  id: string;
  created_at: string;
  classroom_id: string;
  lesson_id?: string;
  student_id: string;
  student_name: string;
  type: EventType;
  modality?: OutputType;
  value?: number; // e.g. game score
  text?: string; // e.g. the question asked
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Direct teacher↔student messaging. One thread per (classroom, student).
export interface DirectMessage {
  id: string;
  created_at: string;
  classroom_id: string;
  student_id: string;
  sender: "professor" | "student";
  sender_name: string;
  text: string;
}

// ---------- Per-student lesson progress (persisted per student + lesson) ----------

// Flashcard self-assessment state. Indices refer to cards in the deck whose
// fingerprint is `deck_key`; if the deck is regenerated the key changes and the
// saved indices are no longer applied (they would point at different cards).
export interface FlashcardProgress {
  deck_key: string;
  current_index: number;
  known: number[];
  review: number[];
}

export interface LessonProgress {
  student_id: string;
  lesson_id: string;
  classroom_id: string;
  // modality -> ISO time it was first completed. A key is only ever added once.
  completed: Partial<Record<OutputType, string>>;
  flashcards: FlashcardProgress | null;
  // Revision of the last applied flashcard snapshot. Snapshots carry the
  // revision assigned when the student acted; older ones are never applied, so
  // network arrival order can't roll progress back. 0 = nothing saved yet.
  flashcards_rev: number;
  created_at: string;
  updated_at: string;
}
