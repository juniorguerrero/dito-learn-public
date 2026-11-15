import {
  LearningBlueprint,
  StudentProfile,
  MindMapData,
  MindMapNode,
  MindMapEdge,
  FlashcardsData,
  StorySlidesData,
  PodcastData,
  PodcastLine,
  StoryAudioData,
  GameSpecData,
  VideoStoryboardData,
  SongSpecData,
} from "./types";

// Mock generators: used when ANTHROPIC_API_KEY is missing so the whole UI
// still works in local development / demos.

export function mockBlueprint(documentText: string, profile: StudentProfile): LearningBlueprint {
  const firstLine = documentText.trim().split("\n")[0].slice(0, 60) || "Uploaded Document";
  const conceptNames = ["Core Idea", "Key Process", "Important Term", "Real-World Link", "Common Pitfall"];
  return {
    title: `${firstLine} (Mock Blueprint)`,
    student_level: profile.grade_level || "Middle school",
    subject: "General Studies",
    summary:
      "This is a MOCK blueprint generated without an ANTHROPIC_API_KEY. Set the key in .env.local to get real Claude-powered analysis. The document was parsed successfully and contains " +
      documentText.split(/\s+/).length +
      " words.",
    learning_objectives: [
      "Understand the main idea of the document",
      "Identify the key concepts and how they connect",
      "Apply the concepts to a real-world example",
      "Recognize and avoid common misconceptions",
    ],
    key_concepts: conceptNames.map((name, i) => ({
      name,
      definition: `Mock definition for "${name}" — concept ${i + 1} extracted from your document.`,
      example: `A concrete everyday example illustrating ${name.toLowerCase()}.`,
      common_misconception: `Students often confuse ${name.toLowerCase()} with something similar but different.`,
    })),
    chapters: [
      { title: "Foundations", summary: "The basics you need first.", concepts: conceptNames.slice(0, 3) },
      { title: "Going Deeper", summary: "Connections and applications.", concepts: conceptNames.slice(3) },
    ],
    visual_style: profile.preferred_style || "bright flat illustration, friendly, colorful",
    tone: "encouraging and playful",
    quiz_difficulty: "medium",
  };
}

export function mockMindMap(bp: LearningBlueprint): MindMapData {
  const nodes: MindMapNode[] = [{ id: "root", label: bp.title.slice(0, 40), type: "root", description: bp.summary.slice(0, 100) }];
  const edges: MindMapEdge[] = [];
  bp.chapters.forEach((ch, ci) => {
    const cid = `ch-${ci}`;
    nodes.push({ id: cid, label: ch.title, type: "chapter", description: ch.summary });
    edges.push({ source: "root", target: cid });
    ch.concepts.forEach((cn, ki) => {
      const kc = bp.key_concepts.find((k) => k.name === cn);
      const kid = `c-${ci}-${ki}`;
      nodes.push({ id: kid, label: cn, type: "concept", description: kc?.definition });
      edges.push({ source: cid, target: kid, label: "includes" });
      if (kc) {
        const did = `d-${ci}-${ki}`;
        nodes.push({ id: did, label: "Example", type: "detail", description: kc.example });
        edges.push({ source: kid, target: did, label: "e.g." });
      }
    });
  });
  return { nodes, edges };
}

export function mockFlashcards(bp: LearningBlueprint): FlashcardsData {
  return {
    cards: bp.key_concepts.flatMap((kc) => [
      {
        question: `What is ${kc.name}?`,
        answer: kc.definition,
        hint: `Think about: ${kc.example.slice(0, 60)}...`,
        difficulty: bp.quiz_difficulty,
        tags: [bp.subject, kc.name],
      },
      {
        question: `True or false check: "${kc.common_misconception}" — what's wrong with this?`,
        answer: `That's the common misconception! Actually: ${kc.definition}`,
        hint: "It's a trap — this is the misconception itself.",
        difficulty: "hard" as const,
        tags: ["misconception", kc.name],
      },
    ]),
  };
}

export function mockStorySlides(bp: LearningBlueprint): StorySlidesData {
  return {
    story_title: `The Quest for ${bp.title.slice(0, 30)}`,
    slides: bp.key_concepts.slice(0, 6).map((kc, i) => ({
      title: `Chapter ${i + 1}: Discovering ${kc.name}`,
      narration: `Our hero ventured onward and discovered ${kc.name}. ${kc.definition} They saw it in action: ${kc.example}`,
      image_prompt: `${bp.visual_style}, a young explorer discovering ${kc.name.toLowerCase()}, scene ${i + 1}, no text`,
    })),
  };
}

export function mockPodcast(bp: LearningBlueprint): PodcastData {
  const lines: PodcastLine[] = [
    { speaker: "Teacher", text: `Welcome back to Antclass Radio! Today we're diving into ${bp.title}.` },
    { speaker: "Student", text: "I've been so curious about this — where do we start?" },
  ];
  bp.key_concepts.slice(0, 5).forEach((kc) => {
    lines.push({ speaker: "Teacher", text: `Let's talk about ${kc.name}. ${kc.definition}` });
    lines.push({ speaker: "Student", text: `Wait, I always thought... ${kc.common_misconception}` });
    lines.push({ speaker: "Teacher", text: `Great question — that's a super common mix-up! Here's an example that clears it up: ${kc.example}` });
  });
  lines.push({ speaker: "Student", text: "That all makes so much more sense now. Thanks!" });
  lines.push({ speaker: "Teacher", text: "That's a wrap — keep being curious, and we'll see you next episode!" });
  return { episode_title: `Ep. 1 — ${bp.title}`, lines };
}

export function mockStoryAudio(bp: LearningBlueprint): StoryAudioData {
  const narration = [
    `Close your eyes and imagine a world shaped by ${bp.subject.toLowerCase()}.`,
    ...bp.key_concepts.slice(0, 5).map((kc) => `${kc.name}: ${kc.definition}`),
    "And so, piece by piece, the whole picture came together.",
  ];
  return {
    title: `${bp.title} — An Audio Adventure`,
    narration_lines: narration,
    sound_cues: [
      { at_line: 0, description: "soft ambient pad fades in" },
      { at_line: 2, description: "gentle chime on the key idea" },
      { at_line: narration.length - 1, description: "warm resolving chord, fade out" },
    ],
  };
}

export function mockGameSpec(bp: LearningBlueprint): GameSpecData {
  return {
    game_title: `Concept Quest: ${bp.subject}`,
    intro_text: `A mysterious fog of confusion has covered the land of ${bp.subject}. Clear it by mastering each concept!`,
    levels: bp.key_concepts.slice(0, 3).map((kc, i) => ({
      title: `Level ${i + 1}: The Trial of ${kc.name}`,
      concept_name: kc.name,
      concept_explanation: `${kc.definition} For example: ${kc.example}`,
      quiz_gates: [
        {
          question: `What best describes ${kc.name}?`,
          options: [kc.definition.slice(0, 80), "The opposite of what the document says", kc.common_misconception.slice(0, 80), "None of these"],
          correct_index: 0,
          explanation: kc.definition,
        },
        {
          question: `Which is an example of ${kc.name}?`,
          options: ["A completely unrelated thing", kc.example.slice(0, 80), "The misconception in disguise", "A trick answer"],
          correct_index: 1,
          explanation: kc.example,
        },
        {
          question: `Spot the misconception about ${kc.name}:`,
          options: ["The correct definition", "A true example", kc.common_misconception.slice(0, 80), "All of these are true"],
          correct_index: 2,
          explanation: `That one is the classic misconception. Reality: ${kc.definition}`,
        },
      ],
      matching_pairs: [
        { term: kc.name, match: "the concept itself" },
        { term: "Definition", match: kc.definition.slice(0, 40) },
        { term: "Example", match: kc.example.slice(0, 40) },
        { term: "Watch out!", match: kc.common_misconception.slice(0, 40) },
      ],
      boss_question: {
        question: `BOSS: Explain how ${kc.name} connects to the big picture of ${bp.title}. Which statement is strongest?`,
        options: [
          `It's unrelated to ${bp.subject}`,
          `${kc.name} matters because ${kc.definition.slice(0, 70)}`,
          "It only matters on tests",
          kc.common_misconception.slice(0, 70),
        ],
        correct_index: 1,
        explanation: `Exactly — ${kc.name} is a pillar of this topic.`,
      },
      background_prompt: `${bp.visual_style}, fantasy game level backdrop themed around ${kc.name.toLowerCase()}, no text`,
    })),
  };
}

export function mockVideoStoryboard(bp: LearningBlueprint): VideoStoryboardData {
  return {
    video_title: `${bp.title} in 90 Seconds`,
    scenes: [
      {
        title: "Hook",
        narration: `What if you could understand ${bp.title} in a minute and a half? Let's go.`,
        image_prompt: `${bp.visual_style}, dramatic opening shot about ${bp.subject.toLowerCase()}, no text`,
        video_prompt: "slow push-in with particles floating",
        duration: 6,
        camera_motion: "push-in",
      },
      ...bp.key_concepts.slice(0, 5).map((kc, i) => ({
        title: `Scene ${i + 2}: ${kc.name}`,
        narration: `${kc.definition} Think of it like this: ${kc.example}`,
        image_prompt: `${bp.visual_style}, visual metaphor for ${kc.name.toLowerCase()}, no text`,
        video_prompt: "gentle camera drift, elements animate subtly",
        duration: 9,
        camera_motion: i % 2 === 0 ? "pan-right" : "pan-left",
      })),
      {
        title: "Recap",
        narration: "Now you know the essentials. Rewatch anytime — or jump into the game to test yourself!",
        image_prompt: `${bp.visual_style}, all key elements together in a triumphant final shot, no text`,
        video_prompt: "slow pull-out revealing the whole scene",
        duration: 7,
        camera_motion: "pull-out",
      },
    ],
  };
}

export function mockSongSpec(bp: LearningBlueprint): SongSpecData {
  const c1 = bp.key_concepts[0];
  const c2 = bp.key_concepts[1] || c1;
  return {
    song_title: `${bp.title} Anthem`,
    genre: "upbeat pop with a hint of hip-hop",
    tempo: "100 BPM, energetic",
    learning_hook: `${c1.name} — ${c1.definition.split(".")[0]}!`,
    music_prompt: `Upbeat educational pop song, 100 BPM, bright synths, claps, catchy melodic hook, positive energy, clean mix`,
    lyrics: `(Verse 1)\nOpened up my book today, had so much to know\n${c1.name} on the page, watch my knowledge grow\n${c1.example.split(".")[0]}\nNow I see it everywhere I go\n\n(Chorus)\n${c1.name}! ${c1.definition.split(".")[0]}\nSay it loud, now you know\n${c1.name}! That's the way it goes\n\n(Verse 2)\n${c2.name} up next, listen really close\n${c2.definition.split(".")[0]}\nDon't get tricked — ${c2.common_misconception.split(".")[0]}\nNow you know more than most\n\n(Chorus)\n${c1.name}! ${c1.definition.split(".")[0]}\nSay it loud, now you know\n${c1.name}! That's the way it goes`,
  };
}
