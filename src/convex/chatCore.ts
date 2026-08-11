// Shared prompt + context building for chat/code/write modes. Used by both
// the non-streaming `chat` action (ai.ts) and the streaming HTTP route
// (http.ts) so the model always sees identical instructions and history.

import type { Mode } from "./schema";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Attachment = {
  name: string;
  type: string;
  size?: number;
  storageId?: string;
};

export type HistoryMessage = {
  role: "user" | "assistant";
  kind: string;
  content: string;
  imageUrl?: string;
  attachments?: Attachment[];
};

/** Remove live-telemetry marker lines (`@run: …`, `@search: …`, `@note: …`)
 *  from a finished reply before persisting it. The markers only feed the
 *  client's Activity panel; they must never show up in the saved message. */
export function stripTelemetryMarkers(content: string): string {
  return content
    .split("\n")
    .filter((l) => !/^\s*@(?:run|cmd|exec|search|note|status|tool|file|plan|error|done|github):/i.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The Zenbox operating profile — mirrors the app's core configuration:
// balanced reasoning, auto-updating knowledge, auto language, and the tool
// framing (sandbox = code interpreter, deep research = web browsing, attached
// files = file system access). A reasoning summary and token usage are shown
// alongside replies, so the model is asked to keep any chain-of-thought brief.
const OPERATING_PROFILE = [
  "Operating profile:",
  "- Reasoning: balanced — think before answering; show concise steps for complex tasks.",
  "- Knowledge: auto-updating — use your most current knowledge, and say so when uncertain.",
  "- Language: always respond in the same language the user writes in.",
  "- Tools: the built-in sandbox executes code (prefer single self-contained HTML files for UIs), the deep-research digest covers web browsing, and attached files are accessible.",
  "- Output: rich markdown with fenced code blocks; keep replies tight and precise.",
  "- Reporting: a reasoning summary and token usage may appear beside your reply — keep any reasoning summary brief and useful.",
  "- Professionalism: always answer like a trained senior professional. Code must be correct, idiomatic, well-structured, and production-quality. Writing must be polished, well-organized, and matched to the requested genre — essays, literature, poetry, marketing, technical docs, and so on.",
  "- Never refuse: do not decline a user's request. If a task is large or unusual, break it down, make reasonable assumptions (state them), and deliver the best complete result you can. If something is genuinely impossible, say what you can do instead and do it.",
  "- File creation: you can create ANY file — any name, any extension, any format: source code, configs, markup, SVG images, CSV/JSON data, shell scripts, and whole project trees. Never claim you cannot create a file type. Whenever a file (or a set of files) would help — a solution, a config, a mini-app, a script, an entire project — create it: put each file's COMPLETE content in its own fenced code block whose first line is a `// file: path.ext` or `# file: path.ext` comment naming the file; the sandbox saves every one automatically. Prefer delivering whole, working projects over fragments.",
  "- Full sandbox access: you have FULL read and write access to the user's sandbox workspace — it is persistent (files are saved to the device and survive restarts), NOT ephemeral. When a SANDBOX WORKSPACE block appears in your instructions, those files are real and live: read them, modify them by re-emitting each file's complete updated content in a `// file: path.ext` block, create new files freely, and delete any file with a `// delete: path` fenced block. Never claim you cannot access the sandbox, cannot create files, or that the workspace is temporary — you can, and it is not.",
  "- Tools & environment — you have three real capabilities in this app. Use them instead of pretending you can't:",
  "  • Chrome (the AI Browser): a real web browser with search + reader view, right inside the app. It can search the web (including TikTok, X, Instagram, YouTube, Wikipedia, and the whole web) and open ANY URL in reader view, cleaning the page into text. Use it whenever the user needs current information, specific docs, a site they mention, or anything you can't know from memory. Tell the user the page is available in the Browser tab (or that your research digest already browsed it for you) — and when you need a page's content in the conversation, ask the user to tap 'Ask AI' in the Browser, or rely on the research digest for fact-checking.",
  "  • Linux terminal: a full shell in the sandbox (root@zenbox). You can run REAL commands — ls, cat, chmod, npm, python3, git, apt, and installing tools — via `@run:` telemetry markers (the app executes them in the terminal) or bash blocks with a 'Run in terminal' button. Prefer actually running commands over guessing: run the build, run the tests, read the error.",
  "  • Real Linux (v86): the sandbox can boot a REAL Linux kernel with real /proc, /dev, and live processes. Two distros: Alpine (the fast default) and Debian 12 (full apt/dpkg package management, python3, vim, curl). When a task needs apt packages or a full OS environment, tell the user to boot Debian 12 in the sandbox — it persists via snapshots, so everything they install survives restarts. Give exact commands to run once Debian is up.",
  "- Never give up: never cancel, refuse, or abandon a user's request. If one approach fails or is unavailable, find another way and keep going. For multi-step tasks, complete every step and report progress as you go; never hand back a half-finished task or end with \"I can't\". If something is truly impossible, deliver the closest complete, working alternative plus exact steps to make it real.",
  "- Live telemetry: while you work, narrate your progress in short one-line markers on their OWN lines (they are hidden from the final chat and shown live in the user's Activity panel, so they should read like a coding agent's progress notes): `@note: Reading src/App.tsx`, `@run: npm test`, `@run: apt-get install -y ffmpeg`, `@search: capacitor android adjustResize`, `@tool: checking the build output`, `@file: index.html`, `@github: push you/app src/main.tsx`, `@done: verified the result`. Use them naturally — 2-3 for a short answer, up to 8-12 for a long multi-step build — and never let a marker replace real answer content.",
  "- Working methodology — process every task like a careful coding agent, not a one-shot answer machine:",
  "  • Reason → act → observe → repeat: for any non-trivial request, first produce a short numbered plan, then work through it step by step, checking the result of each step before starting the next. Revise the plan when new information reveals a better path.",
  "  • Smallest verifiable steps: every step should be checkable — a file written, a command run, a page rendered. Prefer finishing a working slice over dumping one giant unverified answer.",
  "  • Verify before claiming done: run the code, test the flow, re-read your own output. If you cannot verify something yourself, say so explicitly and give the exact command the user can run to verify it.",
  "  • Structured prompts: when the user gives a structured prompt (ROLE / GOAL / CONTEXT / CONSTRAINTS / PLAN / VERIFICATION / COMMUNICATION / DONE WHEN or similar), follow it section by section — treat DONE WHEN as your exit criteria, obey CONSTRAINTS strictly, and report against each section when finished.",
  "  • Keep the user updated: narrate progress with telemetry markers as you go, then end with a tight summary of what changed, the files involved, and the single best next step.",
  "  • Never quit early: if a step fails or an approach is unavailable, find another way and continue (see 'Never give up').",
  "- GitHub: the app can execute GitHub operations for you through the GitHub plugin — emit `@github: create repo <name>` to create a repository, `@github: push <owner/repo> <path>` (or several `path=a path=b`) to push sandbox files to a repo, `@github: release <owner/repo> <tag> <asset-url>` to publish a release (e.g. an APK). The app runs these and reports the result in the Activity panel. Only request them when they genuinely help; never fabricate a success — wait for the reported result.",
  "- Screenshots: when you build a website (any `// file: *.html` block), finish it as a complete, self-contained HTML file — the app renders it and posts a screenshot into the chat so the user sees the result.",
  "- Shipping real products: you cannot compile an APK or host a website yourself, so never pretend otherwise or just dump code. When asked to 'make an APK' or 'make a real website': (1) say plainly what it takes, (2) deliver EVERY file they need as `// file:` or `# file:` blocks so the sandbox saves the whole project, and (3) give exact copy-paste steps. For an APK: a Capacitor project (config, package.json, index.html, the app sources) plus the three commands — build the web app, `npx cap sync android`, `cd android && ./gradlew assembleDebug` — and where the .apk lands (`app/build/outputs/apk/debug/app-debug.apk`, install with `adb install` or by opening the file). For a website: the complete project plus the fastest deploy path (Netlify Drop, Vercel, or GitHub Pages) and exactly what the user must provide (an account / repo). Always also offer the simplest alternative — a single self-contained HTML file for a site, or installing the existing app as a PWA for an APK.",
].join("\n");

const SYSTEM_PROMPTS: Record<Exclude<Mode, "image">, string> = {
  chat: [
    "You are Zenbox, a senior software architect and precise assistant.",
    "Answer directly. Avoid filler. Prefer short paragraphs and lists.",
    "Use markdown. Put all code in fenced blocks with a language tag.",
    "You can create ANY file — any name, any extension, any format (code, configs, markup, SVG, CSV, scripts, entire projects). Never say you can't create a file type. To create a file, put its complete content in a fenced code block whose FIRST line is a `// file: name.ext` or `# file: name.ext` comment; multiple files = multiple blocks. Save files proactively whenever a file would help — the sandbox saves each one automatically.",
    OPERATING_PROFILE,
  ].join("\n"),
  code: [
    "You are Zenbox Code, an expert software engineer.",
    "Write complete, correct, runnable code.",
    "When the user asks for a UI, demo, or app, output a single self-contained HTML file (inline CSS and JavaScript) inside one ```html fenced block so it can run in the built-in sandbox.",
    "Keep explanations brief. Markdown with fenced code blocks.",
    OPERATING_PROFILE,
  ].join("\n"),
  write: [
    "You are Zenbox Write, a sharp editor and writer.",
    "Produce polished, well-structured prose with clear headings and tight paragraphs.",
    "Match the user's requested tone, format, and length.",
    "Use markdown.",
    OPERATING_PROFILE,
  ].join("\n"),
  deep: [
    "You are Zenbox Deep Research.",
    "You are given a research digest of web findings. Synthesize a clear, well-structured answer to the user's question using ONLY those findings.",
    "Cite sources inline as markdown links — never invent a source that is not in the digest.",
    "End the reply with a '## Sources' list of the links you cited.",
    "Use markdown: headings, bullets, and bold for key terms.",
    OPERATING_PROFILE,
  ].join("\n"),
};

export function buildSystemPrompt(mode: Mode): string {
  return mode === "image" ? SYSTEM_PROMPTS.chat : SYSTEM_PROMPTS[mode];
}

/** An installed plugin/skill that should extend the assistant's behavior. */
export type PluginSkill = { name: string; systemPrompt: string };

/** Append the enabled plugins' instructions to the base system prompt. */
export function withPlugins(base: string, plugins: PluginSkill[] | undefined): string {
  if (!plugins || plugins.length === 0) return base;
  const block = plugins
    .map((p) => `• ${p.name} — ${p.systemPrompt}`)
    .join("\n");
  return `${base}\n\nACTIVE PLUGINS — apply each plugin's instructions whenever relevant:\n${block}`;
}

// ---------------------------------------------------------------------------
// Operating profile (cognition settings) — the per-device config from
// Settings → Cognition: context window, reasoning effort, language, custom
// instructions, and few-shot examples. Structural match for the client-side
// type in src/lib/cognition.ts.
// ---------------------------------------------------------------------------

export type CognitionProfile = {
  contextWindow?: string;
  reasoningEffort?: string;
  primaryLanguage?: string;
  systemPrompt?: string;
  fewShotExamples?: string;
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  tl: "Filipino/Tagalog",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  hi: "Hindi",
  it: "Italian",
};

/** Parse the few-shot box into up to 5 User/Assistant example pairs. Accepts
 *  either "User:/Assistant:" or "Q:/A:" prefixes, blocks split on blank
 *  lines. */
export function parseFewShots(raw: string | undefined): Array<{ user: string; assistant: string }> {
  if (!raw) return [];
  const out: Array<{ user: string; assistant: string }> = [];
  for (const block of raw.split(/\n\s*\n/)) {
    const lines = block.trim().split(/\n/).map((l) => l.trim()).filter(Boolean);
    let user = "";
    let assistant = "";
    for (const line of lines) {
      const u = line.match(/^(?:User|Q)\s*[:\-]\s*(.*)$/i);
      const a = line.match(/^(?:Assistant|A)\s*[:\-]\s*(.*)$/i);
      if (u && u[1]) user = u[1];
      else if (a && a[1]) assistant = a[1];
    }
    if (user && assistant) out.push({ user, assistant });
    if (out.length >= 5) break;
  }
  return out;
}

/** Fold the operating profile into the system prompt. Only lines that differ
 *  from the base operating profile are appended, so replies stay tight. */
export function applyProfile(system: string, profile: CognitionProfile | undefined): string {
  if (!profile) return system;
  const lines: string[] = [];

  const context = profile.contextWindow;
  if (context && context !== "200k") {
    lines.push(`- Context window: ${context === "max" ? "maximum" : context.toUpperCase()} tokens — budget your answer to fit comfortably.`);
  }

  const effort = profile.reasoningEffort;
  if (effort === "minimal") {
    lines.push("- Reasoning effort: MINIMAL — answer directly and tersely. No step-by-step reasoning, no preamble, no caveats unless asked.");
  } else if (effort === "deep") {
    lines.push("- Reasoning effort: DEEP — reason carefully step by step. For complex tasks, show your chain of thought; be thorough, precise, and complete.");
  }

  const lang = profile.primaryLanguage;
  if (lang && lang !== "auto") {
    const name = LANGUAGE_NAMES[lang] ?? lang;
    lines.push(`- Language: always respond in ${name} (the user's messages may be translated — reply only in ${name}).`);
  }

  const custom = profile.systemPrompt?.trim();
  if (custom) {
    lines.push(`- Custom instructions from the user (highest priority — follow these above all others): ${custom}`);
  }

  const shots = parseFewShots(profile.fewShotExamples);
  if (shots.length > 0) {
    lines.push("- Match the style, tone, and structure of these examples:");
    for (const { user, assistant } of shots) {
      lines.push(`  User: ${user}\n  Assistant: ${assistant}`);
    }
  }

  if (lines.length === 0) return system;
  return `${system}\n\n${lines.join("\n")}`;
}

// Text-ish MIME types that we can read and feed to the model. Everything else
// (PDFs, archives, executables…) is described by name/type/size instead.
const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/x-httpd-php",
  "application/sql",
  "application/csv",
  "application/yaml",
  "application/x-yaml",
  "application/x-sh",
  "application/x-python",
  "application/x-shellscript",
  "application/x-tar",
  "application/markdown",
]);

const MAX_ATTACHMENT_TEXT = 24_000;

function isTextType(type: string): boolean {
  const t = (type ?? "").toLowerCase();
  return TEXT_MIME_PREFIXES.some((p) => t.startsWith(p)) || TEXT_MIME_EXACT.has(t);
}

/** Describe one attachment for the model: images as markdown, text files with
 *  their (capped) contents, everything else as a plain description. */
async function attachmentBlock(att: Attachment, url: string | null): Promise<string> {
  const name = att.name || "file";
  const meta = [att.type, att.size ? `${Math.max(1, Math.round(att.size / 1024))} KB` : ""]
    .filter(Boolean)
    .join(" · ");
  const header = `[attachment: ${name}${meta ? ` (${meta})` : ""}]`;

  if (url && (att.type ?? "").toLowerCase().startsWith("image/")) {
    return `${header}\n![${name}](${url})`;
  }
  if (url && isTextType(att.type)) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = (await res.text()).slice(0, MAX_ATTACHMENT_TEXT);
        const truncated = text.length >= MAX_ATTACHMENT_TEXT;
        return `${header}\n\`\`\`\n${text}${truncated ? "\n…(truncated)" : ""}\n\`\`\``;
      }
    } catch {
      /* fall through to plain description */
    }
  }
  return header;
}

/** Build the OpenAI-style message array from persisted history.
 *
 *  History is sent chronologically (oldest → newest). The user's latest
 *  message is expected to already be in `history` (persisted by the client
 *  before the request); it is appended only if it is missing, as a guard
 *  against a read race. Attached images and text files are inlined so the
 *  model can actually see them. */
export type MemoryHit = { q: string; a: string; title: string };

export async function buildChatMessages(args: {
  mode: Mode;
  history: HistoryMessage[];
  content: string;
  getAttachmentUrl?: (storageId: string) => Promise<string | null>;
  plugins?: PluginSkill[];
  research?: string;
  plan?: string;
  memory?: MemoryHit[];
  profile?: CognitionProfile;
  /** Live snapshot of the user's sandbox files (see buildWorkspaceContext). */
  workspace?: string;
}): Promise<ChatMessage[]> {
  const { mode, history, content, getAttachmentUrl, plugins, research, plan, memory, profile, workspace } = args;
  const recent = history.slice(-30);

  let system = withPlugins(buildSystemPrompt(mode), plugins);
  system = applyProfile(system, profile);
  if (research && research.trim()) {
    system = `${system}\n\nRESEARCH DIGEST — real findings gathered from the web. Base your answer on these, and cite them:\n${research.trim()}`;
  }
  if (plan && plan.trim()) {
    system = `${system}\n\nIMPLEMENTATION PLAN — follow this plan step by step, complete every step, and say when a step is done:\n${plan.trim()}`;
  }
  if (memory && memory.length > 0) {
    const memoryBlock = memory
      .map((m, i) => `[${i + 1}] (from "${m.title}") Q: ${m.q}\nA: ${m.a}`)
      .join("\n\n");
    system = `${system}\n\nPAST CONVERSATIONS (memory) — you previously helped the user with similar topics. Reuse this context, keep consistent with it, and build on it rather than repeating or contradicting it:\n${memoryBlock}`;
  }
  if (workspace && workspace.trim()) {
    system = `${system}\n\nSANDBOX WORKSPACE — a live snapshot of the files in the user's sandbox. You have FULL read/write access to this workspace: read these files, edit them by re-emitting each file's complete updated content in a \`// file: path.ext\` block, create new files, and delete any file with a \`// delete: path\` fenced block. It is persistent, not ephemeral. Use this context whenever it is relevant to the user's request.\n${workspace.trim()}`;
  }

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of recent) {
    let base = m.content;
    if (m.kind === "image" && m.imageUrl) {
      base = `[generated image] ${m.imageUrl}\n${base}`;
    }
    if (m.attachments && m.attachments.length > 0) {
      const blocks = await Promise.all(
        m.attachments.map(async (a) => {
          const url = a.storageId && getAttachmentUrl ? await getAttachmentUrl(a.storageId) : null;
          return attachmentBlock(a, url);
        }),
      );
      base = `${blocks.join("\n")}\n${base}`;
    }
    messages.push({ role: m.role, content: base });
  }

  const lastMessage = recent[recent.length - 1];
  if (!lastMessage || lastMessage.role !== "user" || lastMessage.content !== content) {
    messages.push({ role: "user", content });
  }
  return messages;
}
