import { LearningBlueprint, OutputType } from "./types";

// Rich, hand-authored blueprints so the demo looks real even without an API key.
// (The mock generators derive mind maps / flashcards / stories / games from these
// concepts, so real concepts => real-looking outputs everywhere.)

export interface SeedLesson {
  source_name: string;
  document_text: string;
  blueprint: LearningBlueprint;
}

export const SEED_LESSONS: SeedLesson[] = [
  {
    source_name: "photosynthesis-chapter.pdf",
    document_text:
      "Photosynthesis is the process by which green plants, algae, and some bacteria convert light energy into chemical energy stored in glucose...",
    blueprint: {
      title: "Photosynthesis: How Plants Make Food",
      student_level: "High school",
      subject: "Biology",
      summary:
        "Photosynthesis is how plants turn sunlight, water, and carbon dioxide into glucose and oxygen. It happens in the chloroplasts and has two stages: the light-dependent reactions and the Calvin cycle. This single process powers nearly all life on Earth by producing food and oxygen.",
      learning_objectives: [
        "Explain the overall equation of photosynthesis",
        "Describe the role of chlorophyll and chloroplasts",
        "Distinguish the light-dependent reactions from the Calvin cycle",
        "Explain why photosynthesis matters for life on Earth",
      ],
      key_concepts: [
        {
          name: "Chlorophyll",
          definition: "The green pigment in chloroplasts that absorbs light energy, mostly red and blue wavelengths.",
          example: "Leaves look green because chlorophyll reflects green light while absorbing the rest.",
          common_misconception: "That chlorophyll absorbs green light — it actually reflects it.",
        },
        {
          name: "Light-dependent reactions",
          definition: "Reactions in the thylakoid membranes that use light to split water and produce ATP and NADPH.",
          example: "Sunlight hits the thylakoid and water molecules are split, releasing oxygen.",
          common_misconception: "That glucose is made in this stage — it isn't; that happens in the Calvin cycle.",
        },
        {
          name: "Calvin cycle",
          definition: "Light-independent reactions in the stroma that use ATP and NADPH to fix CO2 into glucose.",
          example: "Carbon dioxide from the air is assembled into sugar using the energy carriers from stage one.",
          common_misconception: "That the Calvin cycle doesn't need light — it needs the ATP/NADPH that light produced.",
        },
        {
          name: "Stomata",
          definition: "Tiny pores on the underside of leaves that let carbon dioxide in and oxygen/water vapor out.",
          example: "On a hot day stomata close to save water, which also slows photosynthesis.",
          common_misconception: "That plants breathe through their roots — gas exchange happens mainly at the stomata.",
        },
        {
          name: "Glucose & Oxygen",
          definition: "The products of photosynthesis: glucose stores energy for the plant; oxygen is released as a byproduct.",
          example: "The oxygen you breathe was released by plants and algae during photosynthesis.",
          common_misconception: "That oxygen is the plant's food — glucose is the food; oxygen is a byproduct.",
        },
      ],
      chapters: [
        { title: "Capturing Light", summary: "How pigments and leaf structure capture sunlight.", concepts: ["Chlorophyll", "Stomata"] },
        { title: "The Two Stages", summary: "Turning light into stored chemical energy.", concepts: ["Light-dependent reactions", "Calvin cycle"] },
        { title: "Why It Matters", summary: "The products that sustain life.", concepts: ["Glucose & Oxygen"] },
      ],
      visual_style: "bright botanical illustration, warm sunlight, clean and friendly, no text",
      tone: "curious and encouraging",
      quiz_difficulty: "medium",
    },
  },
  {
    source_name: "french-revolution-notes.docx",
    document_text:
      "The French Revolution (1789-1799) was a period of radical political and social change in France...",
    blueprint: {
      title: "The French Revolution",
      student_level: "High school",
      subject: "History",
      summary:
        "Between 1789 and 1799, France overturned its monarchy and reshaped Europe. Driven by inequality, debt, and Enlightenment ideas, ordinary people demanded liberty and equality. The revolution moved from hopeful reform to violent Terror before Napoleon rose to power.",
      learning_objectives: [
        "Identify the main causes of the French Revolution",
        "Explain the significance of the storming of the Bastille",
        "Describe the ideals of liberty, equality, and fraternity",
        "Trace how the revolution led to the rise of Napoleon",
      ],
      key_concepts: [
        {
          name: "The Three Estates",
          definition: "French society was split into clergy (First), nobility (Second), and everyone else (Third Estate).",
          example: "The Third Estate was ~97% of people but paid most taxes and had little power.",
          common_misconception: "That all three estates were treated equally — the first two were largely tax-exempt.",
        },
        {
          name: "Storming of the Bastille",
          definition: "On July 14, 1789, Parisians seized the Bastille fortress-prison, a symbol of royal tyranny.",
          example: "The date is still celebrated as France's national holiday, Bastille Day.",
          common_misconception: "That the Bastille held hundreds of prisoners — only seven were inside.",
        },
        {
          name: "Liberty, Equality, Fraternity",
          definition: "The rallying ideals of the revolution, later France's national motto.",
          example: "The Declaration of the Rights of Man proclaimed men are born free and equal in rights.",
          common_misconception: "That these rights immediately applied to everyone — women and enslaved people were excluded at first.",
        },
        {
          name: "The Reign of Terror",
          definition: "A radical phase (1793-94) when thousands were executed by guillotine as 'enemies of the revolution'.",
          example: "Even revolutionary leaders like Robespierre were eventually guillotined.",
          common_misconception: "That the Terror targeted only nobles — many ordinary citizens were executed too.",
        },
        {
          name: "Rise of Napoleon",
          definition: "The instability let Napoleon Bonaparte seize power in 1799, ending the revolution and crowning himself emperor.",
          example: "Napoleon spread revolutionary reforms across Europe even as he ruled as an emperor.",
          common_misconception: "That Napoleon restored the old monarchy — he kept many revolutionary changes.",
        },
      ],
      chapters: [
        { title: "A Society Divided", summary: "Inequality that set the stage.", concepts: ["The Three Estates"] },
        { title: "Revolution Erupts", summary: "The people rise up around new ideals.", concepts: ["Storming of the Bastille", "Liberty, Equality, Fraternity"] },
        { title: "Radical Turn & Aftermath", summary: "From Terror to empire.", concepts: ["The Reign of Terror", "Rise of Napoleon"] },
      ],
      visual_style: "dramatic 18th-century painterly style, rich colors, historical, no text",
      tone: "vivid and story-driven",
      quiz_difficulty: "medium",
    },
  },
  {
    source_name: "newtons-laws.txt",
    document_text:
      "Sir Isaac Newton's three laws of motion describe the relationship between a body and the forces acting upon it...",
    blueprint: {
      title: "Newton's Three Laws of Motion",
      student_level: "High school",
      subject: "Physics",
      summary:
        "Newton's three laws explain how objects move and why. The first law is about inertia, the second links force, mass, and acceleration (F = ma), and the third says every action has an equal and opposite reaction. Together they describe almost all everyday motion.",
      learning_objectives: [
        "State Newton's three laws of motion",
        "Apply F = ma to solve simple problems",
        "Identify action-reaction pairs",
        "Connect the laws to real-world examples",
      ],
      key_concepts: [
        {
          name: "First Law (Inertia)",
          definition: "An object stays at rest or in uniform motion unless acted on by a net external force.",
          example: "Passengers lurch forward when a car brakes because their bodies keep moving.",
          common_misconception: "That moving objects naturally slow down on their own — friction is the hidden force.",
        },
        {
          name: "Second Law (F = ma)",
          definition: "The acceleration of an object is proportional to the net force and inversely proportional to its mass.",
          example: "Pushing an empty cart is easy; a loaded cart needs far more force for the same acceleration.",
          common_misconception: "That heavier objects always fall faster — without air resistance they fall the same.",
        },
        {
          name: "Third Law (Action-Reaction)",
          definition: "For every action there is an equal and opposite reaction.",
          example: "A rocket pushes gas down, and the gas pushes the rocket up.",
          common_misconception: "That action-reaction forces cancel out — they act on different objects, so they don't.",
        },
        {
          name: "Net Force",
          definition: "The vector sum of all forces acting on an object; it determines whether motion changes.",
          example: "In tug-of-war, the rope only moves toward the side with the greater net force.",
          common_misconception: "That any force causes motion — only an unbalanced (net) force does.",
        },
        {
          name: "Mass vs. Weight",
          definition: "Mass is the amount of matter; weight is the force of gravity on that mass.",
          example: "An astronaut's mass is the same on the Moon, but their weight is much less.",
          common_misconception: "That mass and weight are the same thing — weight changes with gravity, mass doesn't.",
        },
      ],
      chapters: [
        { title: "Objects at Rest and in Motion", summary: "Inertia and net force.", concepts: ["First Law (Inertia)", "Net Force"] },
        { title: "Force and Acceleration", summary: "The math of motion.", concepts: ["Second Law (F = ma)", "Mass vs. Weight"] },
        { title: "Forces in Pairs", summary: "How forces interact.", concepts: ["Third Law (Action-Reaction)"] },
      ],
      visual_style: "clean modern physics illustration, dynamic motion lines, bold and playful, no text",
      tone: "clear and energetic",
      quiz_difficulty: "medium",
    },
  },
];

export interface SeedStudent {
  name: string;
  interests: string[];
}

export const SEED_STUDENTS: SeedStudent[] = [
  { name: "Maya", interests: ["Music", "Anime", "Art"] },
  { name: "Leo", interests: ["Video games", "Sports"] },
  { name: "Sofia", interests: ["Movies", "Fashion", "Art"] },
  { name: "Kai", interests: ["Coding", "Space", "Science"] },
  { name: "Emma", interests: ["Animals", "Nature", "Music"] },
  { name: "Diego", interests: ["Cars", "Video games"] },
];

// Weighted modality popularity to produce a compelling headline insight.
// Song dominates strongly so the demo reliably shows the "students love songs" story.
export const MODALITY_WEIGHTS: { modality: OutputType; weight: number }[] = [
  { modality: "song", weight: 22 },
  { modality: "video", weight: 8 },
  { modality: "game", weight: 7 },
  { modality: "story_slides", weight: 5 },
  { modality: "flashcards", weight: 4 },
  { modality: "podcast", weight: 3 },
  { modality: "mindmap", weight: 2 },
  { modality: "story_audio", weight: 2 },
];

export const SEED_QUESTIONS = [
  "Wait, why does chlorophyll look green if it absorbs light?",
  "Can you explain the Calvin cycle like I'm five?",
  "What actually happened on Bastille Day?",
  "Why did the revolution turn so violent?",
  "If heavier things don't fall faster, why does a feather fall slowly?",
  "How does a rocket push off nothing in space?",
  "What's the difference between mass and weight again?",
  "Can you give me a real example of the first law?",
  "Why do plants close their stomata on hot days?",
  "Was Napoleon a good guy or a bad guy?",
];
