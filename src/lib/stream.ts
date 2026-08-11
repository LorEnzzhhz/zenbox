// Client-side reader for Zenbox's streaming chat endpoint. POSTs to the
// Convex site's /chatStream route (auth cookie included) and parses the SSE
// stream token-by-token, invoking onDelta for every content chunk. Also
// captures reasoning deltas (reasoning_content / reasoning) and the final
// usage chunk when the gateway reports it.

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;

export type StreamResult = {
  content: string;
  reasoning: string;
  usage: { prompt: number; completion: number } | null;
  error: string | null;
};

/** Per-device operating profile carried to the /chatStream route; structural
 *  match for the server type in convex/chatCore.ts. */
export type StreamProfile = {
  contextWindow?: string;
  reasoningEffort?: string;
  primaryLanguage?: string;
  systemPrompt?: string;
  fewShotExamples?: string;
};

export type StreamMemory = { q: string; a: string; title: string };

export async function streamChat(args: {
  conversationId: string;
  content: string;
  model: string;
  mode: string;
  research?: string;
  memory?: StreamMemory[];
  profile?: StreamProfile;
  workspace?: string;
  token?: string | null;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}): Promise<StreamResult> {
  const { onDelta, onReasoning, signal } = args;
  let full = "";
  let reasoningFull = "";
  let usage: { prompt: number; completion: number } | null = null;
  let aborted = false;
  if (signal) {
    if (signal.aborted) aborted = true;
    else signal.addEventListener("abort", () => (aborted = true), { once: true });
  }

  try {
    const res = await fetch(`${CONVEX_URL}/chatStream`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        // The Convex runtime authenticates HTTP actions from this header.
        ...(args.token ? { Authorization: `Bearer ${args.token}` } : {}),
      },
      body: JSON.stringify({
        conversationId: args.conversationId,
        content: args.content,
        model: args.model,
        mode: args.mode,
        research: args.research,
        memory: args.memory,
        profile: args.profile,
        workspace: args.workspace,
      }),
      signal,
    });

    if (!res.ok) {
      let detail = `Stream error ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        /* ignore */
      }
      return { content: "", reasoning: "", usage: null, error: detail };
    }
    if (!res.body) {
      return { content: "", reasoning: "", usage: null, error: "Empty response from stream" };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamError: string | null = null;

    const onLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string; reasoning?: string };
          }>;
          error?: { message?: string };
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        if (parsed.error?.message) {
          streamError = parsed.error.message;
          return;
        }
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          full += delta.content;
          onDelta(delta.content);
        }
        const reason = delta?.reasoning_content ?? delta?.reasoning;
        if (reason) {
          reasoningFull += reason;
          onReasoning?.(reason);
        }
        if (parsed.usage) {
          const prompt = parsed.usage.prompt_tokens ?? 0;
          const completion = parsed.usage.completion_tokens ?? 0;
          if (prompt > 0 || completion > 0) {
            usage = { prompt, completion };
          }
        }
      } catch {
        /* ignore malformed SSE line */
      }
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    }
    if (buffer.trim()) onLine(buffer);

    if (streamError) return { content: full, reasoning: reasoningFull, usage, error: streamError };
    return { content: full, reasoning: reasoningFull, usage, error: null };
  } catch (err) {
    if (aborted) return { content: full, reasoning: reasoningFull, usage, error: "aborted" };
    return { content: full, reasoning: reasoningFull, usage, error: err instanceof Error ? err.message : "Request failed" };
  }
}
