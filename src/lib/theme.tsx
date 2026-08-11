import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Color palettes — applied via `data-palette` on <html>; the overrides live
 *  in index.css so every shadcn token reflows. */
export type Palette = "mono" | "paper" | "terminal" | "ocean";

/** Live wallpapers — animated background layers rendered behind app content. */
export type Wallpaper = "none" | "aurora" | "particles";

/** Context-window budget advertised to the model for a conversation. */
export type ContextWindow = "32k" | "128k" | "200k" | "max";

/** Reasoning effort — how much chain-of-thought the model should spend. */
export type ReasoningEffort = "minimal" | "balanced" | "deep";

/** Voice pick for text-to-speech. */
export type TtsVoice = "default" | "female" | "male";

/** Every per-device preference the app remembers, including the full
 *  cognition/capabilities configuration. All of it lives in one
 *  localStorage blob (`zenbox.prefs`) so the studio, the Control app, and
 *  the sandbox all agree. */
export type Prefs = {
  palette: Palette;
  wallpaper: Wallpaper;
  bootSound: boolean;
  sendSound: boolean;
  showThinking: boolean;

  // 1. Core cognition
  contextWindow: ContextWindow;
  reasoningEffort: ReasoningEffort;
  knowledgeAutoUpdate: boolean;
  primaryLanguage: string; // "auto" | language code

  // 2. Agentic & tools
  codeInterpreter: boolean;
  webBrowsing: boolean;
  fileSystem: boolean;

  // 3. Multimodal perception
  vision: boolean;
  ocr: boolean;
  audioTranscription: boolean;
  tts: boolean;
  ttsVoice: TtsVoice;

  // 4. Performance
  streaming: boolean;
  responseCaching: boolean;
  parallelTasks: boolean;
  bestAnswer: boolean;
  memory: boolean; // scan past chats for similar answers before replying

  // 5. UX / display
  richMarkdown: boolean;
  editableOutputs: boolean;
  multiSession: boolean;
  /** Subtle vibration on send, replies, and errors (Android). */
  haptics: boolean;

  // 6. Adaptability
  systemPrompt: string;
  fewShotExamples: string; // up to 5 "User:/Assistant:" blocks

  // 7. Debugging & transparency
  showConfidence: boolean;
  showTokenUsage: boolean;
};

export const PALETTES: Array<{ id: Palette; label: string; hint: string; swatch: [string, string] }> = [
  { id: "mono", label: "Monochrome", hint: "Pure black & white", swatch: ["#fafafa", "#0a0a0a"] },
  { id: "paper", label: "Paper", hint: "Warm cream & ink", swatch: ["#f6f1e7", "#2b2418"] },
  { id: "terminal", label: "Terminal", hint: "Phosphor green", swatch: ["#e8f7ee", "#0b3d1f"] },
  { id: "ocean", label: "Ocean", hint: "Cool blue", swatch: ["#eef3fb", "#0e2a4a"] },
];

export const WALLPAPERS: Array<{ id: Wallpaper; label: string; hint: string }> = [
  { id: "none", label: "None", hint: "Flat, calm" },
  { id: "aurora", label: "Aurora", hint: "Slow drifting light" },
  { id: "particles", label: "Particles", hint: "Floating dust" },
];

const LS_KEY = "zenbox.theme";
const PREFS_KEY = "zenbox.prefs";

const DEFAULT_PREFS: Prefs = {
  palette: "mono",
  wallpaper: "none",
  bootSound: true,
  sendSound: false,
  showThinking: true,

  contextWindow: "200k",
  reasoningEffort: "balanced",
  knowledgeAutoUpdate: true,
  primaryLanguage: "auto",

  codeInterpreter: true,
  webBrowsing: true,
  fileSystem: true,

  vision: true,
  ocr: true,
  audioTranscription: true,
  tts: false,
  ttsVoice: "default",

  streaming: true,
  responseCaching: false,
  parallelTasks: false,
  bestAnswer: true,
  memory: true,

  richMarkdown: true,
  editableOutputs: true,
  multiSession: true,
  haptics: true,

  systemPrompt: "",
  fewShotExamples: "",

  showConfidence: false,
  showTokenUsage: true,
};

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

function readStored(): Theme {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

function applyTheme(theme: Theme) {
  const resolved = resolve(theme);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

function applyPrefs(prefs: Prefs) {
  const root = document.documentElement;
  root.dataset.palette = prefs.palette;
  root.dataset.wallpaper = prefs.wallpaper;
}

const ThemeContext = createContext<{
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(LS_KEY, theme);
    } catch {
      /* ignore */
    }
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyTheme("system");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
  }, [theme]);

  useEffect(() => {
    applyPrefs(prefs);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (resolve(prev) === "dark" ? "light" : "dark")),
    [],
  );
  const setPrefs = useCallback((patch: Partial<Prefs>) => setPrefsState((prev) => ({ ...prev, ...patch })), []);

  return (
    <ThemeContext.Provider value={{ theme, resolved: resolve(theme), setTheme, toggleTheme, prefs, setPrefs }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
