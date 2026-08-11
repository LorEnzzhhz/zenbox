import { Braces, Globe, Image as ImageIcon, MessageSquare, PenLine, type LucideIcon } from "lucide-react";
import type { Mode } from "@/lib/zenbox";

export type ModeMeta = {
  id: Mode;
  label: string;
  icon: LucideIcon;
  tagline: string;
  placeholder: string;
  suggestions: string[];
};

export const MODES: ModeMeta[] = [
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    tagline: "Ask anything",
    placeholder: "Ask anything — every reply runs on free models.",
    suggestions: [
      "Explain how a transformer works in three sentences",
      "Give me 5 minimalist dashboard layout ideas",
      "What should I consider before shipping an MVP?",
    ],
  },
  {
    id: "code",
    label: "Code",
    icon: Braces,
    tagline: "Generate & run",
    placeholder: "Describe the code you want — HTML demos are runnable in the sandbox.",
    suggestions: [
      "Build a to-do app in a single HTML file",
      "A sorting algorithm visualizer, plain JS",
      "A stopwatch with laps, styled monochrome",
    ],
  },
  {
    id: "image",
    label: "Image",
    icon: ImageIcon,
    tagline: "Free image generation",
    placeholder: "Describe an image — generated free with Pollinations.",
    suggestions: [
      "A minimalist desk setup in black and white",
      "Abstract concrete architecture, soft shadows",
      "A single white bird on a gray wall, film grain",
    ],
  },
  {
    id: "write",
    label: "Write",
    icon: PenLine,
    tagline: "Drafts & prose",
    placeholder: "Paste a brief, a draft, or an idea — get polished prose back.",
    suggestions: [
      "Write a launch email for a minimal note-taking app",
      "Rewrite this paragraph to be more concise: ...",
      "Draft a blog intro about living with less",
    ],
  },
  {
    id: "deep",
    label: "Deep",
    icon: Globe,
    tagline: "Web research",
    placeholder: "Ask a research question — the AI searches the web and cites its sources.",
    suggestions: [
      "What are the latest developments in open-source AI models?",
      "Compare the economics of solar vs wind energy in 2026",
      "Summarize the history and design of the Voyager spacecraft",
    ],
  },
];

export function getMode(id: Mode): ModeMeta {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}
