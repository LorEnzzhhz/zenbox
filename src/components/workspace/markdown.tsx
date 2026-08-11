import { CodeBlock } from "./CodeBlock";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type MarkdownProps = {
  content: string;
  onRunCode?: (language: string, code: string) => void;
  onSaveFile?: (hint: string | null, language: string, code: string) => void;
  onRunTerminal?: (command: string) => void;
  onDownload?: (language: string, code: string, hint: string | null) => void;
  onEmail?: (language: string, code: string, hint: string | null) => void;
  className?: string;
};

/** Monochrome markdown renderer for assistant replies. Fenced blocks render
 *  through <CodeBlock/> (copy, run in sandbox, save as a file, download,
 *  email, run in the Linux terminal); raw HTML from the model is never
 *  injected — react-markdown only renders safe markdown AST nodes. */
export function Markdown({
  content,
  onRunCode,
  onSaveFile,
  onRunTerminal,
  onDownload,
  onEmail,
  className,
}: MarkdownProps) {
  return (
    <div className={cn("space-y-3 text-[15px] leading-7", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <div>{children}</div>,
          code: ({ className: cls, children }) => {
            const match = /language-([\w-]+)/.exec(cls ?? "");
            const language = match ? match[1] : "";
            const raw = String(children ?? "");
            const isBlock = Boolean(match) || raw.includes("\n");
            if (isBlock) {
              return (
                <CodeBlock
                  language={language}
                  code={raw.replace(/\n$/, "")}
                  onRun={onRunCode}
                  onSaveFile={onSaveFile}
                  onRunTerminal={onRunTerminal}
                  onDownload={onDownload}
                  onEmail={onEmail}
                />
              );
            }
            return (
              <code className="rounded-sm border border-border/70 bg-neutral-50 px-1.5 py-0.5 font-mono text-[13px] text-foreground dark:bg-neutral-900">
                {children}
              </code>
            );
          },
          h1: ({ children }) => (
            <h1 className="pt-2 text-xl font-semibold tracking-tight">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="pt-2 text-lg font-semibold tracking-tight">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="pt-1 text-base font-semibold tracking-tight">{children}</h3>
          ),
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground/60">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 marker:text-muted-foreground/60">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground/70">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-foreground/20 pl-4 text-muted-foreground">{children}</blockquote>
          ),
          hr: () => <hr className="border-border" />,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-2 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border/60 px-3 py-2">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
