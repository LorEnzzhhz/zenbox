// Live telemetry parser for the streaming chat. The model is asked (see the
// operating profile in convex/chatCore.ts) to narrate its work with one-line
// markers — `@run: npm test`, `@search: capacitor keyboard`, `@note: …` —
// which are stripped from the visible chat and surfaced as live events in the
// Activity panel (commands, searches, tool calls, status notes) exactly like a
// coding agent narrating its own progress.

import type { ActivityEvent } from "@/components/workspace/ActivityPanel";

export type ActivityLine = { kind: ActivityEvent["kind"]; text: string };

const MARKERS: Array<[string, ActivityEvent["kind"], (t: string) => string]> = [
  ["@run:", "command", (t) => `$ ${t}`],
  ["@cmd:", "command", (t) => `$ ${t}`],
  ["@exec:", "command", (t) => `$ ${t}`],
  ["@search:", "search", (t) => `Searching the web — ${t}`],
  ["@note:", "status", (t) => t],
  ["@status:", "status", (t) => t],
  ["@tool:", "tool", (t) => t],
  ["@file:", "file", (t) => `Working on ${t}`],
  ["@plan:", "status", (t) => `Planning — ${t}`],
  ["@error:", "error", (t) => t],
  ["@done:", "done", (t) => t],
  // GitHub operations — executed by the app (see the @github handler in
  // Dashboard.tsx) and surfaced live: create repo, push files, release.
  ["@github:", "github", (t) => t],
];

/** Streaming buffer — keeps the current partial line across chunks. */
export function createActivityBuffer() {
  return { line: "" };
}

/** Feed one delta chunk of model output through the parser. Returns the text
 *  that should be appended to the visible reply (markers stripped) plus any
 *  telemetry events emitted by complete lines. */
export function processChunk(
  chunk: string,
  buf: { line: string },
): { text: string; events: ActivityLine[] } {
  buf.line += chunk;
  const lines = buf.line.split("\n");
  buf.line = lines.pop() ?? "";
  const events: ActivityLine[] = [];
  const visible: string[] = [];
  let fenceLang: string | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    let handled = false;

    // 1 — explicit telemetry markers (hidden from the chat, shown live).
    for (const [prefix, kind, fmt] of MARKERS) {
      if (trimmed.startsWith(prefix)) {
        const text = trimmed.slice(prefix.length).trim();
        if (text) events.push({ kind, text: fmt(text) });
        handled = true;
        break;
      }
    }
    if (handled) continue;

    // 2 — pasted terminal sessions: `$ cmd` / `> cmd` lines inside code
    //    blocks. Keep them visible (they are content) AND log them as
    //    commands so the activity feed mirrors the session.
    const shell = trimmed.match(/^[\$>⟫]\s+(.+)$/);
    if (shell && !trimmed.startsWith(">>>")) {
      const cmd = shell[1].trim();
      if (cmd.length > 0 && cmd.length < 140 && !/^[.!?]+$/.test(cmd) && !/\s+\?$/.test(cmd)) {
        events.push({ kind: "command", text: `$ ${cmd}` });
      }
    }

    // 3 — fenced code blocks: narrate writing code while it streams.
    const fence = trimmed.match(/^```(\S*)/);
    if (fence) {
      if (fenceLang === null) {
        fenceLang = fence[1] || "code";
        events.push({ kind: "tool", text: `Writing ${fenceLang} code…` });
      } else {
        fenceLang = null;
        events.push({ kind: "done", text: "Finished writing a code block" });
      }
      continue;
    }

    visible.push(line);
  }

  return { text: visible.join("\n"), events };
}

/** Flush any remaining partial line at the end of the stream. */
export function flushActivityBuffer(buf: { line: string }): { text: string; events: ActivityLine[] } {
  if (!buf.line.trim()) return { text: "", events: [] };
  const res = processChunk("\n", buf);
  return { text: res.text.replace(/^\n/, ""), events: res.events };
}

/** One-shot parse for non-streaming replies (whole content at once). */
export function parseActivityText(raw: string): { clean: string; events: ActivityLine[] } {
  const buf = createActivityBuffer();
  const { text, events } = processChunk(raw, buf);
  const flushed = flushActivityBuffer(buf);
  const clean = (text + flushed.text).replace(/\n{3,}/g, "\n\n").trim();
  return { clean, events: [...events, ...flushed.events] };
}
