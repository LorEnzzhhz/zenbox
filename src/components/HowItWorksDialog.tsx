import { motion } from "framer-motion";
import {
  ArrowRight,
  Bell,
  Brain,
  Check,
  Download,
  FileCode2,
  FileText,
  Globe,
  Info,
  ListChecks,
  MessageSquareText,
  Mic,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** One step of the pipeline — numbered, with a small icon. */
function Step({
  n,
  icon,
  title,
  body,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm border border-border/80 font-mono text-[10px] text-muted-foreground">
        {n}
      </span>
      <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

/** A capability chip used inside the "tools" section. */
function Cap({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-sm border border-border/80 bg-neutral-50 px-2 py-1 text-[11px] text-muted-foreground dark:bg-neutral-900/60">
      {icon}
      {label}
    </span>
  );
}

/** Full-screen "How Zenbox works" explainer — the same three pillars as the
 *  docs: how the AI processes data, how it runs tools & commands, and how it
 *  keeps the user updated in real time. Styled to match the minimal theme. */
export function HowItWorksDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 p-0">
        <DialogHeader className="border-b border-border/70 px-6 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex size-7 items-center justify-center rounded-sm bg-foreground text-background">
              <Info className="size-4" />
            </span>
            How Zenbox works
          </DialogTitle>
          <DialogDescription className="text-[12px] leading-5">
            One prompt, routed automatically — here's what happens behind the scenes every time
            you press send.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] overflow-y-auto px-6 py-5">
          {/* Pipeline strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {["Your prompt", "Memory", "Plan", "Web search", "Sandbox", "Model"].map((s, i, arr) => (
              <div key={s} className="flex shrink-0 items-center gap-1.5">
                <span className="flex items-center gap-1 rounded-sm border border-border/80 bg-neutral-50 px-2 py-1 text-[10px] font-medium text-foreground/80 dark:bg-neutral-900/60">
                  {i === 0 && <MessageSquareText className="size-3 text-muted-foreground" />}
                  {i === 1 && <Brain className="size-3 text-muted-foreground" />}
                  {i === 2 && <ListChecks className="size-3 text-muted-foreground" />}
                  {i === 3 && <Globe className="size-3 text-muted-foreground" />}
                  {i === 4 && <FileCode2 className="size-3 text-muted-foreground" />}
                  {i === 5 && <Sparkles className="size-3 text-muted-foreground" />}
                  {s}
                </span>
                {i < arr.length - 1 && <ArrowRight className="size-3 shrink-0 text-muted-foreground/40" />}
              </div>
            ))}
          </div>

          {/* 01 — Processing */}
          <section className="mt-6">
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              01 · How I process your request
            </p>
            <div className="mt-3 flex flex-col gap-4">
              <Step
                n="1"
                icon={<MessageSquareText className="size-3.5" />}
                title="I read everything around your prompt"
                body="Your message, past chats (memory), your sandbox files, and any attachments — assembled into one context before I write a word."
              />
              <Step
                n="2"
                icon={<ListChecks className="size-3.5" />}
                title="Build & write tasks get a plan first"
                body="For “create an app”, “fix this”, or “write a report”, I draft a numbered plan and show it to you live before executing it."
              />
              <Step
                n="3"
                icon={<Globe className="size-3.5" />}
                title="Facts get real web research"
                body="Deep mode and fact-seeking questions search the web first, then I answer from the findings with cited sources."
              />
              <Step
                n="4"
                icon={<FileCode2 className="size-3.5" />}
                title="I see your sandbox, not a blank slate"
                body="A live snapshot of your workspace is included on every turn — so I can read, edit, and build on the files you already have."
              />
            </div>
          </section>

          {/* 02 — Tools & commands */}
          <section className="mt-7 border-t border-border/70 pt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              02 · How I run tools & commands
            </p>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
              I don't type into a hidden shell — I ask, and the app executes for me. Every action is
              visible in the Activity panel:
            </p>
            <div className="mt-3 flex flex-col gap-4">
              <Step
                n="1"
                icon={<FileCode2 className="size-3.5" />}
                title="Creating files"
                body="I emit each file as a code block tagged with its path. The sandbox saves it instantly — it appears in Files and in the terminal, ready to edit, run, or download."
              />
              <Step
                n="2"
                icon={<Terminal className="size-3.5" />}
                title="Running commands"
                body="Bash blocks get a “Run in terminal” button. Inside the sandbox you get a real root shell — ls, cat, chmod, scripts, even installing tools."
              />
              <Step
                n="3"
                icon={<Wrench className="size-3.5" />}
                title="Real Linux, not a toy"
                body="The sandbox boots a genuine Linux kernel (Alpine or Debian) in your browser — real /proc, real processes, full root access, files that persist between sessions."
              />
              <Step
                n="4"
                icon={<Download className="size-3.5" />}
                title="Results come back to you"
                body="Built a website? I render it and post a screenshot into the chat. Made files? Download buttons appear under the reply."
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Cap icon={<FileText className="size-3" />} label="Any file type" />
              <Cap icon={<Terminal className="size-3" />} label="Run in terminal" />
              <Cap icon={<Search className="size-3" />} label="Web search" />
              <Cap icon={<Wrench className="size-3" />} label="Install tools" />
              <Cap icon={<Mic className="size-3" />} label="Voice input" />
              <Cap icon={<Download className="size-3" />} label="Download files" />
            </div>
          </section>

          {/* 03 — Updates */}
          <section className="mt-7 border-t border-border/70 pt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              03 · How I keep you updated
            </p>
            <div className="mt-3 flex flex-col gap-4">
              <Step
                n="1"
                icon={<MessageSquareText className="size-3.5" />}
                title="Replies stream live"
                body="Tokens appear as they're generated — with a thinking block showing my chain of thought in real time."
              />
              <Step
                n="2"
                icon={<Brain className="size-3.5" />}
                title="The Activity panel shows what I'm doing"
                body="Planning, searching, writing files, running commands — every step appears live so you always know where I am."
              />
              <Step
                n="3"
                icon={<Bell className="size-3.5" />}
                title="I work even when you leave"
                body="On Android the app keeps running in the background and sends a notification when your reply is ready."
              />
              <Step
                n="4"
                icon={<Check className="size-3.5" />}
                title="You're always in control"
                body="Copy, resend, edit-and-rerun, or regenerate any reply — nothing is final until you say it is."
              />
            </div>
          </section>

          {/* 04 — The agentic loop */}
          <section className="mt-7 border-t border-border/70 pt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              04 · The agentic loop — how I decide what to do next
            </p>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
              Every reply is a loop, not a one-shot answer: I reason, act, observe the result, and
              reason again — until the job is verified done.
            </p>
            <div className="mt-3 flex flex-col gap-4">
              <Step
                n="1"
                icon={<RefreshCw className="size-3.5" />}
                title="Reason → act → observe → repeat"
                body="I emit one step at a time — write a file, run a search, note a plan. The app executes it, the result comes back to me, and I pick the next step from what I actually see."
              />
              <Step
                n="2"
                icon={<Target className="size-3.5" />}
                title="Each step is the smallest thing that moves forward"
                body="I constantly ask: what's the smallest next step toward a verified result? Small steps are checkable — a file exists, a command ran, a page rendered."
              />
              <Step
                n="3"
                icon={<Wrench className="size-3.5" />}
                title="The action picks the tool"
                body="Creating a file → a tagged code block the sandbox saves. Running a command → a bash block you can execute. Checking facts → a web search. Progress → the plan panel updates live."
              />
              <Step
                n="4"
                icon={<ListChecks className="size-3.5" />}
                title="Plans steer the loop"
                body="For build, write, or fix tasks I draft a numbered plan first, then walk it step by step — revising it as the work reveals new requirements instead of blindly charging ahead."
              />
              <Step
                n="5"
                icon={<Check className="size-3.5" />}
                title="I stop when it's verified — and never quit early"
                body="A file on disk, a command that succeeded, a screenshot of the finished page: that's done. If a step fails, I don't cancel your request — I find another way and tell you what I'm trying."
              />
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-border/70 px-6 py-3">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="size-3" />
            Free models · no credits · no key needed
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-1 rounded-sm border border-border/80 px-2.5 py-1.5 text-[11px] font-medium text-foreground/85 transition-colors hover:border-foreground/40 hover:bg-muted"
          >
            <X className="size-3" />
            Got it
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
