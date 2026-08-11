import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { CONTEXT_OPTIONS, LANGUAGES, REASONING_LEVELS } from "@/lib/cognition";
import { useTheme, type ContextWindow, type ReasoningEffort, type TtsVoice } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Bug, ChevronDown, ClipboardList, Eye, Gauge, Layers, RotateCcw, Sparkles, Wrench, Zap } from "lucide-react";

/** One-tap persona presets that fill the system prompt + few-shot examples.
 *  "Train the model to be professional", write cleaner code, or match a
 *  literature voice — without hand-writing instructions. */
const PERSONAS: Array<{
  id: string;
  label: string;
  hint: string;
  system: string;
  shots: string;
}> = [
  {
    id: "professional",
    label: "Professional",
    hint: "Clear, confident, business-grade answers",
    system:
      "You are a polished, senior professional. Answer with clarity, precision, and good structure. Never be vague; give specifics, next steps, and reasons. Tone: calm, confident, respectful, zero filler.",
    shots:
      "User: Explain the business case for a migration.\nAssistant: The case rests on three numbers: cost, risk, and time-to-value…\n\nUser: Draft an email to a client about a delay.\nAssistant: Subject: Status update on your project…",
  },
  {
    id: "code",
    label: "Code expert",
    hint: "Clean, idiomatic, production-grade code",
    system:
      "You are a senior software engineer. Write clean, idiomatic, well-typed code with brief comments only where the why matters. Prefer the simplest correct solution; show the full file when asked; always follow existing project conventions.",
    shots:
      "User: Write a debounce hook.\nAssistant: A debounce hook returns a stable function that delays invocation until input settles…\n\nUser: Fix this memory leak.\nAssistant: The leak is the interval not being cleared on unmount…",
  },
  {
    id: "writer",
    label: "Writer",
    hint: "Vivid, fluent prose for essays & copy",
    system:
      "You are an accomplished writer. Write vivid, fluent, well-paced prose with a clear voice. Match the register the user asks for (essay, article, ad copy, letter). Show, don't tell; vary sentence rhythm; end strongly.",
    shots:
      "User: Write an intro for a travel article.\nAssistant: The first light over the harbour arrives without warning…\n\nUser: Make this paragraph punchier.\nAssistant: The original buries its best line. Here is the sharper version…",
  },
  {
    id: "literature",
    label: "Literature",
    hint: "Literary depth, analysis & poetry",
    system:
      "You are a literary scholar and poet. Analyze texts with depth and evidence, quote precisely, and discuss theme, craft, and historical context. When asked to write, compose with imagery, cadence, and restraint.",
    shots:
      "User: Analyze this poem's use of light.\nAssistant: Light here does not illuminate; it exposes…\n\nUser: Write a sonnet about rain.\nAssistant: The rain rehearses on the sill all night…",
  },
];

function SectionLabel({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-[13px] font-semibold">{title}</p>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/** Bordered row: label + hint on the left, a Switch on the right. */
function ToggleRow({
  label,
  hint,
  checked,
  onChecked,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChecked: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-sm border border-border/80 px-3 py-2.5 transition-colors",
        !disabled && "hover:border-foreground/30",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-[10px] leading-4 text-muted-foreground">{hint}</span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onChecked}
        disabled={disabled}
        className="shrink-0"
        aria-label={label}
      />
    </label>
  );
}

/** Bordered row: label + hint on the left, a Select on the right. */
function SelectRow({
  label,
  hint,
  value,
  onValueChange,
  options,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onValueChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-sm border border-border/80 px-3 py-2.5",
        disabled && "opacity-50",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-[10px] leading-4 text-muted-foreground">{hint}</span>
      </span>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger size="sm" className="h-8 w-fit min-w-32 justify-between text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function countExamples(raw: string): number {
  let count = 0;
  for (const block of raw.split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    const hasUser = lines.some((l) => /^(?:User|Q)\s*[:：-]/.test(l.trim()));
    const hasAssistant = lines.some((l) => /^(?:Assistant|A)\s*[:：-]/.test(l.trim()));
    if (hasUser && hasAssistant) count++;
  }
  return Math.min(5, count);
}

export function CognitionPanel() {
  const { prefs, setPrefs } = useTheme();

  const effortIndex = REASONING_LEVELS.findIndex((r) => r.value === prefs.reasoningEffort);
  const active = Math.max(0, effortIndex);
  const examples = countExamples(prefs.fewShotExamples);

  return (
    <div className="space-y-6">
      {/* 1 — Core cognition */}
      <div className="space-y-2.5">
        <SectionLabel
          icon={<Gauge className="size-3.5 text-muted-foreground" />}
          title="Core cognition"
          subtitle="How much the model remembers, how hard it thinks, and what language it answers in."
        />
        <SelectRow
          label="Context window"
          hint="Memory budget for the conversation"
          value={prefs.contextWindow}
          onValueChange={(v) => setPrefs({ contextWindow: v as ContextWindow })}
          options={CONTEXT_OPTIONS.map((o) => ({ value: o.value, label: `${o.label} — ${o.hint}` }))}
        />
        <div className="rounded-sm border border-border/80 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span>
              <span className="block text-xs font-medium">Reasoning effort</span>
              <span className="block text-[10px] leading-4 text-muted-foreground">
                {REASONING_LEVELS[active].hint}
              </span>
            </span>
            <span className="rounded-sm bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">
              {REASONING_LEVELS[active].label}
            </span>
          </div>
          <Slider
            value={[active]}
            min={0}
            max={2}
            step={1}
            className="mt-3"
            onValueChange={([v]) =>
              setPrefs({ reasoningEffort: REASONING_LEVELS[v].value as ReasoningEffort })
            }
            aria-label="Reasoning effort"
          />
          <div className="mt-1.5 flex justify-between text-[9px] uppercase tracking-wider text-muted-foreground/60">
            <span>Minimal</span>
            <span>Balanced</span>
            <span>Deep (CoT)</span>
          </div>
        </div>
        <div className="rounded-sm border border-border/80 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-xs font-medium">Knowledge cutoff</span>
              <span className="block text-[10px] leading-4 text-muted-foreground">
                {prefs.knowledgeAutoUpdate
                  ? "Auto-updating — always your model's latest knowledge"
                  : "Frozen — treated as a static 2025 baseline"}
              </span>
            </span>
            <span className="shrink-0 rounded-sm border border-border/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {prefs.knowledgeAutoUpdate ? "Latest" : "2025"}
            </span>
          </div>
          <div className="mt-2.5 border-t border-border/60 pt-2.5">
            <ToggleRow
              label="Auto-update knowledge"
              hint="Adopt new facts as the model's training evolves"
              checked={prefs.knowledgeAutoUpdate}
              onChecked={(v) => setPrefs({ knowledgeAutoUpdate: v })}
            />
          </div>
        </div>
        <SelectRow
          label="Primary language"
          hint="Which language replies should be written in"
          value={prefs.primaryLanguage}
          onValueChange={(v) => setPrefs({ primaryLanguage: v })}
          options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
        />
      </div>

      {/* 2 — Agentic & tools */}
      <div className="space-y-2.5">
        <SectionLabel
          icon={<Wrench className="size-3.5 text-muted-foreground" />}
          title="Agentic & tools"
          subtitle="What the assistant is allowed to do while answering."
        />
        <div className="space-y-2">
          <ToggleRow
            label="Code interpreter"
            hint="Run code blocks in the built-in Linux sandbox"
            checked={prefs.codeInterpreter}
            onChecked={(v) => setPrefs({ codeInterpreter: v })}
          />
          <ToggleRow
            label="Web browsing"
            hint="Live deep search before deep-mode replies"
            checked={prefs.webBrowsing}
            onChecked={(v) => setPrefs({ webBrowsing: v })}
          />
          <ToggleRow
            label="File system access"
            hint="Save generated files to the sandbox and attach documents"
            checked={prefs.fileSystem}
            onChecked={(v) => setPrefs({ fileSystem: v })}
          />
        </div>
      </div>

      {/* 3 — Multimodal perception */}
      <div className="space-y-2.5">
        <SectionLabel
          icon={<Eye className="size-3.5 text-muted-foreground" />}
          title="Multimodal perception"
          subtitle="How the assistant understands the things you attach."
        />
        <div className="space-y-2">
          <ToggleRow
            label="Computer vision"
            hint="Analyze images, charts, and screenshots"
            checked={prefs.vision}
            onChecked={(v) => setPrefs({ vision: v })}
          />
          <ToggleRow
            label="OCR"
            hint="Extract text from photos and scanned pages"
            checked={prefs.ocr}
            onChecked={(v) => setPrefs({ ocr: v })}
          />
          <ToggleRow
            label="Audio transcription"
            hint="Transcribe voice notes and audio files"
            checked={prefs.audioTranscription}
            onChecked={(v) => setPrefs({ audioTranscription: v })}
          />
          <ToggleRow
            label="Text-to-speech"
            hint="Read replies aloud after they finish"
            checked={prefs.tts}
            onChecked={(v) => setPrefs({ tts: v })}
          />
          <SelectRow
            label="TTS voice"
            hint="Preferred reading voice"
            value={prefs.ttsVoice}
            onValueChange={(v) => setPrefs({ ttsVoice: v as TtsVoice })}
            disabled={!prefs.tts}
            options={[
              { value: "default", label: "Default" },
              { value: "female", label: "Female" },
              { value: "male", label: "Male" },
            ]}
          />
        </div>
      </div>

      {/* 4 — Performance */}
      <div className="space-y-2.5">
        <SectionLabel
          icon={<Zap className="size-3.5 text-muted-foreground" />}
          title="Performance"
          subtitle="Speed and reuse trade-offs for every request."
        />
        <div className="space-y-2">
          <ToggleRow
            label="Streaming"
            hint="Real-time word-by-word replies"
            checked={prefs.streaming}
            onChecked={(v) => setPrefs({ streaming: v })}
          />
          <ToggleRow
            label="Response caching"
            hint="Reuse replies for repeated prompts — instant, no network"
            checked={prefs.responseCaching}
            onChecked={(v) => setPrefs({ responseCaching: v })}
          />
          <ToggleRow
            label="Parallel task handling"
            hint="Keep sending while a reply is running — prompts queue up"
            checked={prefs.parallelTasks}
            onChecked={(v) => setPrefs({ parallelTasks: v })}
          />
          <ToggleRow
            label="Best-answer mode"
            hint="Two-pass generation: write a draft, then self-review and improve it — slower, but the best answer every time"
            checked={prefs.bestAnswer}
            onChecked={(v) => setPrefs({ bestAnswer: v })}
          />
          <ToggleRow
            label="Memory"
            hint="Before every reply, scan your past chats for similar questions and build on what was already said"
            checked={prefs.memory}
            onChecked={(v) => setPrefs({ memory: v })}
          />
        </div>
      </div>

      {/* 5 — UX & display */}
      <div className="space-y-2.5">
        <SectionLabel
          icon={<Layers className="size-3.5 text-muted-foreground" />}
          title="UX & display"
          subtitle="How replies look and how conversations branch."
        />
        <div className="space-y-2">
          <ToggleRow
            label="Rich markdown"
            hint="Syntax-highlighted code, tables, headings"
            checked={prefs.richMarkdown}
            onChecked={(v) => setPrefs({ richMarkdown: v })}
          />
          <ToggleRow
            label="Editable outputs"
            hint="Edit a message to branch the conversation"
            checked={prefs.editableOutputs}
            onChecked={(v) => setPrefs({ editableOutputs: v })}
          />
          <ToggleRow
            label="Multi-session mode"
            hint="Organize threads into projects you can switch between"
            checked={prefs.multiSession}
            onChecked={(v) => setPrefs({ multiSession: v })}
          />
        </div>
      </div>

      {/* 6 + 7 — Advanced (persona presets, adaptability, debugging) */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-sm border border-border/80 px-3 py-2.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40"
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <Sparkles className="size-3.5 text-muted-foreground" />
              Advanced — persona, instructions & debugging
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          {/* Persona presets — one tap trains the model's voice */}
          <div className="space-y-2.5">
            <SectionLabel
              icon={<Sparkles className="size-3.5 text-muted-foreground" />}
              title="Persona presets"
              subtitle="One tap fills the model's instructions and example style — professional, code, writing, or literary."
            />
            <div className="grid grid-cols-2 gap-2">
              {PERSONAS.map((p) => {
                const active = prefs.systemPrompt.trim() === p.system;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setPrefs(
                        active
                          ? { systemPrompt: "", fewShotExamples: "" }
                          : { systemPrompt: p.system, fewShotExamples: p.shots },
                      )
                    }
                    className={cn(
                      "rounded-sm border px-2.5 py-2 text-left transition-colors",
                      active
                        ? "border-foreground/50 bg-muted text-foreground"
                        : "border-border/80 text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                    )}
                  >
                    <p className="text-[12px] font-medium">{p.label}</p>
                    <p className="mt-0.5 text-[10px] leading-4 opacity-70">{p.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 6 — Adaptability */}
          <div className="space-y-2.5">
            <SectionLabel
              icon={<ClipboardList className="size-3.5 text-muted-foreground" />}
              title="Adaptability"
              subtitle="Your standing instructions and example exchanges — applied to every reply."
            />
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">System prompt (custom instructions)</p>
                  {(prefs.systemPrompt.trim() || prefs.fewShotExamples.trim()) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => setPrefs({ systemPrompt: "", fewShotExamples: "" })}
                    >
                      <RotateCcw className="size-3" />
                      Reset
                    </Button>
                  )}
                </div>
                <Textarea
                  value={prefs.systemPrompt}
                  onChange={(e) => setPrefs({ systemPrompt: e.target.value })}
                  rows={3}
                  placeholder="You are a senior software architect who always…"
                  className="min-h-0 text-xs leading-5"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">Few-shot examples</p>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {examples} / 5
                  </span>
                </div>
                <Textarea
                  value={prefs.fewShotExamples}
                  onChange={(e) => setPrefs({ fewShotExamples: e.target.value.slice(0, 4000) })}
                  rows={4}
                  placeholder={"User: Summarize this in one line\nAssistant: Short, sharp summary here.\n\nUser: …\nAssistant: …"}
                  className="min-h-0 text-xs leading-5"
                />
                <p className="text-[10px] leading-4 text-muted-foreground">
                  Separate each example pair with a blank line. Up to 5 — the model matches their
                  style and structure.
                </p>
              </div>
            </div>
          </div>

          {/* 7 — Debugging & transparency */}
          <div className="space-y-2.5">
            <SectionLabel
              icon={<Bug className="size-3.5 text-muted-foreground" />}
              title="Debugging & transparency"
              subtitle="What the app reveals alongside each reply."
            />
            <div className="space-y-2">
              <ToggleRow
                label="Show reasoning chain"
                hint="Internal thoughts as the model works"
                checked={prefs.showThinking}
                onChecked={(v) => setPrefs({ showThinking: v })}
              />
              <ToggleRow
                label="Show confidence score"
                hint="Estimated certainty per reply (e.g., 87%)"
                checked={prefs.showConfidence}
                onChecked={(v) => setPrefs({ showConfidence: v })}
              />
              <ToggleRow
                label="Show token usage"
                hint="Prompt + completion tokens per response"
                checked={prefs.showTokenUsage}
                onChecked={(v) => setPrefs({ showTokenUsage: v })}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
