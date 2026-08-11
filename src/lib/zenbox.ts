// Shared helpers for the Zenbox AI workspace.

export type Mode = "chat" | "code" | "image" | "write" | "deep";

export type ModelInfo = { id: string; name: string };

export type ModelCatalog = {
  free: ModelInfo[];
  rest: ModelInfo[];
  zen: ModelInfo[];
  hasKey: boolean;
  hasZenKey: boolean;
};

// The "auto" picker — smart routing exactly like the Hy3 Workbench APK:
// code/files → Big Pickle, images/chat → DeepSeek V4 Flash (Zen gateway);
// without a Zen key it falls back to GPT-OSS 20B on OpenRouter.
export const AUTO_MODEL = "auto";
export const AUTO_MODEL_INFO: ModelInfo = { id: AUTO_MODEL, name: "Auto — best model for the job" };

// Big Pickle — a free 200K-context coding model on the OpenCode Zen gateway.
export const BIG_PICKLE: ModelInfo = { id: "opencode/big-pickle", name: "Big Pickle — 200K context" };

// DeepSeek V4 Flash — the same model class this assistant runs on. Free via
// the OpenCode Zen gateway (opencode/deepseek-v4-flash-free) and on OpenRouter
// when the free variant is live.
export const DEEPSEEK_V4: ModelInfo = { id: "deepseek/deepseek-v4-flash:free", name: "DeepSeek V4 Flash" };

export const IMAGE_SIZES = [
  { id: "square", label: "Square", width: 1024, height: 1024 },
  { id: "landscape", label: "Wide", width: 1024, height: 768 },
  { id: "portrait", label: "Tall", width: 768, height: 1024 },
] as const;

export type ImageSize = (typeof IMAGE_SIZES)[number];

/** Pollinations.ai — free image generation, no API key required. Uses the
 *  FLUX model with prompt enhancement for noticeably better results, plus a
 *  random seed so re-rolls produce fresh images. */
export function pollinationsUrl(prompt: string, size: ImageSize = IMAGE_SIZES[0]) {
  const seed = Math.floor(Math.random() * 1_000_000);
  const params = new URLSearchParams({
    width: String(size.width),
    height: String(size.height),
    seed: String(seed),
    model: "flux",
    enhance: "true",
    nologo: "true",
    safe: "true",
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
}

/** Short display name for a model id, e.g. "deepseek/deepseek-chat-v3-0324:free" → "DeepSeek Chat V3". */
export function modelShortName(id: string) {
  const last = id.split("/").pop() ?? id;
  const clean = last
    .replace(/:free$/, "")
    .replace(/:reasoning$/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return clean.length > 28 ? `${clean.slice(0, 26)}…` : clean;
}

export function titleFromPrompt(prompt: string) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 46)}…` : clean;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
