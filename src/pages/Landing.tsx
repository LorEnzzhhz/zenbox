import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Box,
  Braces,
  Globe,
  Image as ImageIcon,
  MessageSquare,
  PenLine,
  Puzzle,
  Terminal,
} from "lucide-react";
import { Link } from "react-router";

const CAPABILITIES = [
  {
    n: "01",
    icon: MessageSquare,
    title: "Chat",
    text: "Conversations with free open models. No credits, no subscriptions, no limits on questions.",
  },
  {
    n: "02",
    icon: Braces,
    title: "Code",
    text: "Describe a feature and get complete, runnable code — then execute it without leaving the app.",
  },
  {
    n: "03",
    icon: ImageIcon,
    title: "Image",
    text: "Type a prompt and receive a generated image in seconds. Truly free, unlimited iterations.",
  },
  {
    n: "04",
    icon: PenLine,
    title: "Write",
    text: "Drafts, launches, edits, and rewrites — polished prose from a focused writer model.",
  },
];

const MODEL_CHIPS = [
  "GPT-OSS 20B",
  "Gemma 4",
  "Nemotron 3 Ultra",
  "Cohere North",
  "Big Pickle · 200K ctx",
  "Poolside Laguna",
  "Ling 3",
  "Tencent Hunyuan 3",
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <span className="text-sm font-semibold tracking-[0.3em]">ZENBOX</span>
          <nav className="hidden items-center gap-8 text-[13px] text-muted-foreground md:flex">
            <a href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</a>
            <a href="#models" className="transition-colors hover:text-foreground">Models</a>
            <a href="#sandbox" className="transition-colors hover:text-foreground">Sandbox</a>
          </nav>
          <Link to="/auth?returnTo=/dashboard">
            <Button size="sm" className="gap-1.5 rounded-sm text-xs">
              Open studio
              <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-center pb-24 pt-20 text-center sm:pt-28">
          <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-muted-foreground">
            Free-model AI studio
          </p>
          <h1 className="mt-8 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            Think. Code.
            <br />
            Create. Write.
          </h1>
          <p className="mt-7 max-w-xl text-[15px] leading-7 text-muted-foreground">
            One minimal workspace for chat, code generation, free image generation, and
            writing — powered by 200+ free open models, with a built-in sandbox to run
            what you build. No credits. No subscriptions.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <Link to="/auth?returnTo=/dashboard">
              <Button size="lg" className="w-56 gap-2 rounded-sm text-sm sm:w-auto sm:px-7">
                Open the studio
                <ArrowRight className="size-4" />
              </Button>
            </Link>
            <a href="#capabilities">
              <Button size="lg" variant="outline" className="w-56 rounded-sm text-sm sm:w-auto sm:px-7">
                See capabilities
              </Button>
            </a>
          </div>

          {/* Session mock */}
          <div className="mt-20 w-full max-w-2xl overflow-hidden rounded-md border border-border/80 text-left">
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
              <span className="size-2 rounded-full bg-neutral-300 dark:bg-neutral-700" />
              <span className="size-2 rounded-full bg-neutral-300 dark:bg-neutral-700" />
              <span className="size-2 rounded-full bg-neutral-300 dark:bg-neutral-700" />
              <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                zenbox — code session
              </span>
            </div>
            <div className="space-y-4 px-5 py-5 font-mono text-[13px] leading-6">
              <p className="text-muted-foreground">
                <span className="text-foreground/70">you</span> · Build a to-do app in a single HTML file
              </p>
              <p>
                <span className="text-muted-foreground">zenbox · deepseek v3</span>
              </p>
              <pre className="overflow-x-auto rounded-sm border border-border/70 bg-neutral-50 p-4 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">{`<div id="app">
  <input placeholder="Add a task…" />
  <ul></ul>
</div>`}</pre>
              <p className="flex items-center gap-2 text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-sm border border-border/80 px-2 py-0.5 text-[11px] text-foreground">
                  <Box className="size-3" /> Run in sandbox
                </span>
                running in an isolated preview
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-muted-foreground">
            Capabilities
          </p>
          <h2 className="mt-5 max-w-md text-3xl font-semibold tracking-tight sm:text-4xl">
            Four modes. One clean surface.
          </h2>
          <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border/80 bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.n}
                  className="group bg-background p-7 transition-colors duration-300 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground">{c.n}</span>
                    <Icon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </div>
                  <h3 className="mt-10 text-lg font-semibold tracking-tight">{c.title}</h3>
                  <p className="mt-2.5 text-[13px] leading-6 text-muted-foreground">{c.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Models */}
      <section id="models" className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-muted-foreground">
                Models
              </p>
              <h2 className="mt-5 max-w-sm text-3xl font-semibold tracking-tight sm:text-4xl">
                200+ free models. One key.
              </h2>
            </div>
            <p className="max-w-xs text-[13px] leading-6 text-muted-foreground">
              Every <span className="font-mono text-[12px] text-foreground">:free</span> model on
              OpenRouter is surfaced automatically — plus Big Pickle, a free 200K-context coding
              model on the OpenCode Zen gateway. Add your key once and pick anything.
            </p>
          </div>
          <div className="mt-14 flex flex-wrap items-center gap-x-0 gap-y-4">
            {MODEL_CHIPS.map((name, i) => (
              <span key={name} className="flex items-center">
                {i > 0 && <span className="mx-5 hidden h-4 w-px bg-border sm:block" />}
                <span className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                  {name}
                </span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Beyond the basics */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-muted-foreground">
            Beyond the basics
          </p>
          <h2 className="mt-5 max-w-lg text-3xl font-semibold tracking-tight sm:text-4xl">
            Research, a root shell, and skills.
          </h2>
          <div className="mt-14 grid grid-cols-1 gap-10 md:grid-cols-3">
            {[
              {
                icon: Globe,
                title: "Deep research",
                text: "Ask in Deep mode and the engine reads the web — Wikipedia, general search, full pages — then streams a cited answer.",
              },
              {
                icon: Terminal,
                title: "Root Linux shell",
                text: "A real POSIX sandbox in the browser. Files, pipes, redirection, history — run as root, no keys, works offline.",
              },
              {
                icon: Puzzle,
                title: "Skills & plugins",
                text: "Install skills from any GitHub repo, or paste a website URL and let the AI analyze it into an installable plugin.",
              },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="border-t border-border/70 pt-5">
                  <Icon className="size-4 text-foreground" />
                  <h3 className="mt-4 text-sm font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{f.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Sandbox */}
      <section id="sandbox" className="border-t border-border/60">
        <div className="mx-auto grid max-w-6xl gap-16 px-6 py-24 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-muted-foreground">
              Sandbox
            </p>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
              Your own sandbox, built in.
            </h2>
            <p className="mt-6 max-w-md text-[15px] leading-7 text-muted-foreground">
              Generated code runs in an isolated iframe — no tabs, no setup. Edit HTML, CSS, and
              JavaScript side by side and watch the preview update instantly.
            </p>
            <ul className="mt-8 space-y-3 text-[13px] leading-6 text-muted-foreground">
              {[
                "One click from any code block — Run in sandbox",
                "HTML, CSS, and JS editors with live preview",
                "Isolated execution: nothing touches your data",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
                  {item}
                </li>
              ))}
            </ul>
            <Link to="/auth?returnTo=/dashboard">
              <Button size="sm" variant="outline" className="mt-9 gap-1.5 rounded-sm text-xs">
                Try it in the studio
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </div>

          <div className="overflow-hidden rounded-md border border-border/80">
            <div className="flex items-center gap-1 border-b border-border/70 px-3 py-2">
              {["Preview", "HTML", "CSS", "JS"].map((t, i) => (
                <span
                  key={t}
                  className={
                    i === 0
                      ? "rounded-sm bg-foreground px-2.5 py-1 text-[11px] font-medium text-background"
                      : "rounded-sm px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                  }
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="flex h-64 flex-col items-center justify-center gap-3 bg-neutral-50 text-center dark:bg-neutral-950">
              <Box className="size-6 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                Live preview — your code, running here.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-6 py-28 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-muted-foreground">
            No credits. No limits.
          </p>
          <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-5xl">
            Ready when you are.
          </h2>
          <Link to="/auth?returnTo=/dashboard" className="mt-10">
            <Button size="lg" className="gap-2 rounded-sm px-8 text-sm">
              Open the studio
              <ArrowRight className="size-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <span className="text-xs font-semibold tracking-[0.3em]">ZENBOX</span>
          <p className="text-[11px] text-muted-foreground">
            Free models · Own sandbox · No credits
          </p>
          <p className="text-[11px] text-muted-foreground/70">© 2026 Zenbox</p>
        </div>
      </footer>
    </div>
  );
}
