// Client-side cognition helpers: turns the per-device prefs into the small
// "operating profile" that gets threaded into the model's system prompt
// (context window, reasoning effort, language, custom instructions,
// few-shot examples). Structural match for the server-side type in
// convex/chatCore.ts.

export type CognitionProfile = {
  contextWindow?: string;
  reasoningEffort?: string;
  primaryLanguage?: string;
  systemPrompt?: string;
  fewShotExamples?: string;
};

export const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "auto", label: "Auto (match the user)" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "tl", label: "Filipino / Tagalog" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "it", label: "Italian" },
];

export const CONTEXT_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "32k", label: "32k", hint: "Fast & light" },
  { value: "128k", label: "128k", hint: "Long chats" },
  { value: "200k", label: "200k", hint: "Big Pickle native" },
  { value: "max", label: "Max", hint: "No budget limit" },
];

export const REASONING_LEVELS: Array<{ value: string; label: string; hint: string }> = [
  { value: "minimal", label: "Minimal", hint: "Fast, terse" },
  { value: "balanced", label: "Balanced", hint: "Think, then answer" },
  { value: "deep", label: "Deep (CoT)", hint: "Show the chain" },
];

/** Build the profile object the chat request carries to the backend. */
export function buildProfile(prefs: {
  contextWindow: string;
  reasoningEffort: string;
  primaryLanguage: string;
  systemPrompt: string;
  fewShotExamples: string;
}): CognitionProfile {
  const profile: CognitionProfile = {
    contextWindow: prefs.contextWindow,
    reasoningEffort: prefs.reasoningEffort,
    primaryLanguage: prefs.primaryLanguage,
  };
  const custom = prefs.systemPrompt.trim();
  if (custom) profile.systemPrompt = custom;
  const shots = prefs.fewShotExamples.trim();
  if (shots) profile.fewShotExamples = shots;
  return profile;
}

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}
