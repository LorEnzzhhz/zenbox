import { Button } from "@/components/ui/button";
import { fileNameHint } from "@/lib/sandboxfs";
import { Check, Copy, Download, Mail, Play, Save, TerminalSquare } from "lucide-react";
import { useState } from "react";

const RUNNABLE = new Set(["html", "js", "javascript", "ts", "typescript", "css", "jsx", "tsx"]);
const SHELL = new Set(["bash", "sh", "shell", "zsh", "console"]);

export function CodeBlock({
  language,
  code,
  onRun,
  onSaveFile,
  onRunTerminal,
  onDownload,
  onEmail,
}: {
  language: string;
  code: string;
  onRun?: (language: string, code: string) => void;
  onSaveFile?: (hint: string | null, language: string, code: string) => void;
  onRunTerminal?: (command: string) => void;
  onDownload?: (language: string, code: string, hint: string | null) => void;
  onEmail?: (language: string, code: string, hint: string | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const lang = language.toLowerCase();
  const canRun = onRun !== undefined && RUNNABLE.has(lang);
  const isShell = SHELL.has(lang);
  const canRunTerminal = onRunTerminal !== undefined && isShell;
  const hint = fileNameHint(code);

  const save = () => {
    onSaveFile?.(hint, language, code);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="my-4 overflow-hidden rounded-md border border-border/80 bg-neutral-50 dark:bg-neutral-950/60">
      <div className="flex h-9 items-center justify-between border-b border-border/70 bg-white/60 px-3 dark:bg-neutral-950">
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {isShell && <TerminalSquare className="size-3" />}
          {language || "code"}
          {hint && <span className="normal-case tracking-normal opacity-70">· {hint}</span>}
        </span>
        <div className="flex items-center gap-1">
          {canRun && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-[11px] font-medium text-foreground"
              onClick={() => onRun!(language, code)}
            >
              <Play className="size-3" />
              Run
            </Button>
          )}
          {canRunTerminal && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-[11px] font-medium text-foreground"
              onClick={() => onRunTerminal!(code)}
            >
              <TerminalSquare className="size-3" />
              Run in terminal
            </Button>
          )}
          {onSaveFile && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground"
              onClick={save}
            >
              {saved ? <Check className="size-3" /> : <Save className="size-3" />}
              {saved ? "Saved" : "Save file"}
            </Button>
          )}
          {onDownload && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground"
              onClick={() => onDownload(language, code, hint)}
              title="Download as a file"
            >
              <Download className="size-3" />
              Download
            </Button>
          )}
          {onEmail && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground"
              onClick={() => onEmail(language, code, hint)}
              title="Email this code to yourself"
            >
              <Mail className="size-3" />
              Email
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground"
            onClick={copy}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6">
        <code className="font-mono text-foreground/90">{code}</code>
      </pre>
    </div>
  );
}
