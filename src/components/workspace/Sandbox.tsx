import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadFsFile, FS_CHANGED_EVENT, listTree, readFile, removeFile, writeFile } from "@/lib/sandboxfs";
import { Cpu, Download, Eraser, ExternalLink, FileText, Folder, Globe, Play, Plus, Save, Terminal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Browser } from "./Browser";
import { LinuxTerminal } from "./LinuxTerminal";
import { RealLinux } from "./RealLinux";

export type RunTarget = { language: string; code: string };

type Tab = "preview" | "html" | "css" | "js" | "linux" | "files" | "browser";
type LinuxSub = "real" | "virtual";

const LS_KEY = "zenbox.sandbox";

function defaultSource() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { html?: string; css?: string; js?: string };
      return {
        html: parsed.html ?? "",
        css: parsed.css ?? "",
        js: parsed.js ?? "",
      };
    }
  } catch {
    /* ignore */
  }
  return { html: "", css: "", js: "" };
}

function wrapSource(html: string, css: string, js: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html, body { margin: 0; height: 100%; font-family: system-ui, -apple-system, sans-serif; }
${css}
</style>
</head>
<body>
${html}
<script>
${js}
<\/script>
</body>
</html>`;
}

/** File browser + editor over the shared virtual Linux filesystem. Files saved
 *  from the chat (or created here) show up in the terminal's `ls`/`cat` too. */
function FilesView() {
  const [tree, setTree] = useState(() => listTree());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    const refresh = () => {
      setTree(listTree());
      setSelected((sel) => (sel && listTree().some((f) => f.path === sel && f.type === "file") ? sel : null));
    };
    window.addEventListener(FS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FS_CHANGED_EVENT, refresh);
  }, []);

  const openFile = (path: string) => {
    setSelected(path);
    setContent(readFile(path) ?? "");
  };

  const save = () => {
    if (!selected) return;
    writeFile(selected, content);
    toast.success(`Saved ${selected}`);
  };

  const remove = () => {
    if (!selected) return;
    removeFile(selected);
    setSelected(null);
    setContent("");
    toast.success(`Deleted ${selected}`);
  };

  const create = () => {
    const name = newName.trim().replace(/^\/+/, "");
    if (!name) return;
    const path = writeFile(`/root/${name}`, "");
    setNewName("");
    setSelected(path);
    setContent("");
    toast.success(`Created ${path}`);
  };

  const files = tree.filter((f) => f.type === "file");
  const dirs = tree.filter((f) => f.type === "dir");

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-1.5 border-b border-border/70 px-3 py-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
          placeholder="new-file.txt"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-sm border border-border/80 bg-transparent px-2 font-mono text-[11px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground/40"
        />
        <Button type="button" size="sm" className="h-7 gap-1 text-[11px]" onClick={create}>
          <Plus className="size-3" />
          New
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Tree */}
        <div className="w-44 shrink-0 overflow-y-auto border-r border-border/70 p-1.5">
          <p className="px-1.5 pb-1 text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
            /root &amp; friends
          </p>
          {dirs.map((d) => (
            <p key={d.path} className="flex items-center gap-1.5 px-1.5 py-1 text-[11px] text-muted-foreground/70">
              <Folder className="size-3 shrink-0" />
              <span className="truncate">{d.path}</span>
            </p>
          ))}
          {files.map((f) => (
            <div
              key={f.path}
              className={cn(
                "group flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] transition-colors",
                selected === f.path ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => openFile(f.path)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <FileText className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.path.replace(/^.*\//, "")}</span>
                <span className="shrink-0 text-[9px] opacity-60">{f.size}</span>
              </button>
              <button
                type="button"
                title="Download"
                onClick={() => {
                  if (downloadFsFile(f.path)) toast.success(`Downloaded ${f.path.replace(/^.*\//, "")}`);
                }}
                className="flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
              >
                <Download className="size-3" />
              </button>
            </div>
          ))}
          {files.length === 0 && (
            <p className="px-1.5 py-2 text-[10px] leading-4 text-muted-foreground/60">
              No files yet — save one from a reply.
            </p>
          )}
        </div>
        {/* Editor */}
        {selected ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border/70 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{selected}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 gap-1 text-[10px] text-muted-foreground"
                title="Download to device"
                onClick={() => {
                  if (downloadFsFile(selected)) toast.success(`Downloaded ${selected.replace(/^.*\//, "")}`);
                }}
              >
                <Download className="size-3" />
              </Button>
              <Button type="button" size="sm" className="h-6 gap-1 text-[10px]" onClick={save}>
                <Save className="size-3" />
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 gap-1 text-[10px] text-muted-foreground hover:text-destructive"
                onClick={remove}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-neutral-950 p-4 font-mono text-[13px] leading-6 text-neutral-100 outline-none placeholder:text-neutral-600"
              placeholder="File contents…"
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-center text-[12px] text-muted-foreground">
            Select a file to edit it
          </div>
        )}
      </div>
    </div>
  );
}

export function Sandbox({
  onClose,
  runTarget,
  targetKey,
}: {
  onClose: () => void;
  runTarget: RunTarget | null;
  targetKey: number;
}) {
  const initial = useMemo(defaultSource, []);
  const [html, setHtml] = useState(initial.html);
  const [css, setCss] = useState(initial.css);
  const [js, setJs] = useState(initial.js);
  const [tab, setTab] = useState<Tab>("preview");
  const [linuxSub, setLinuxSub] = useState<LinuxSub>("real");
  const [linuxDistro, setLinuxDistro] = useState<"alpine" | "debian">(() => {
    try {
      return localStorage.getItem("zenbox.sandbox.distro") === "debian" ? "debian" : "alpine";
    } catch {
      return "alpine";
    }
  });
  const [doc, setDoc] = useState(() => wrapSource(initial.html, initial.css, initial.js));
  const [nonce, setNonce] = useState(0);

  // Inject code coming from a generated message and run it.
  useEffect(() => {
    if (!runTarget) return;
    const lang = runTarget.language.toLowerCase();
    const isJs = ["js", "javascript", "ts", "typescript", "jsx", "tsx"].includes(lang);
    const isCss = lang === "css";
    const isHtml = !isJs && !isCss;

    if (isHtml) {
      setHtml(runTarget.code);
      setTab("html");
    } else if (isJs) {
      setJs(runTarget.code);
      setTab("js");
    } else {
      setCss(runTarget.code);
      setTab("css");
    }
    // Falling through to preview after the state settles.
    setTimeout(() => setTab("preview"), 50);
    setDoc(wrapSource(
      isHtml ? runTarget.code : html,
      isCss ? runTarget.code : css,
      isJs ? runTarget.code : js,
    ));
    setNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runTarget, targetKey]);

  // Persist source between sessions.
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ html, css, js }));
    } catch {
      /* ignore */
    }
  }, [html, css, js]);

  const openExternal = () => {
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const clear = () => {
    setHtml("");
    setCss("");
    setJs("");
    setDoc(wrapSource("", "", ""));
    setNonce((n) => n + 1);
  };

  const tabDefs: Array<{ id: Tab; label: string }> = [
    { id: "preview", label: "Preview" },
    { id: "html", label: "HTML" },
    { id: "css", label: "CSS" },
    { id: "js", label: "JS" },
    { id: "linux", label: "Linux" },
    { id: "browser", label: "Browser" },
    { id: "files", label: "Files" },
  ];

  const run = () => {
    if (tab === "linux" || tab === "browser" || tab === "files") return;
    setDoc(wrapSource(html, css, js));
    setNonce((n) => n + 1);
    setTab("preview");
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-11 items-center justify-between border-b border-border/70 px-3">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Sandbox
        </span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="size-7" title="Open in new tab" onClick={openExternal}>
            <ExternalLink className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-7" title="Clear" onClick={clear}>
            <Eraser className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-7" title="Close" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-border/70 px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          {tabDefs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button type="button" size="sm" className="h-7 gap-1.5 text-xs" onClick={run}>
          <Play className="size-3" />
          Run
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "linux" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b border-border/70 bg-muted/30 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setLinuxSub("real")}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                  linuxSub === "real"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                title="Boots a genuine Linux kernel + Alpine rootfs (v86) — real /proc, /dev, processes, full root"
              >
                <Cpu className="size-3" />
                Real Linux
              </button>
              <button
                type="button"
                onClick={() => setLinuxSub("virtual")}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                  linuxSub === "virtual"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                title="Instant full-root shell over the shared file system — no boot, works everywhere"
              >
                <Terminal className="size-3" />
                Virtual shell
              </button>
              {linuxSub === "real" && (
                <>
                  <span className="mx-0.5 h-4 w-px bg-border/70" />
                  {(["alpine", "debian"] as const).map((os) => (
                    <button
                      key={os}
                      type="button"
                      onClick={() => {
                        setLinuxDistro(os);
                        try {
                          localStorage.setItem("zenbox.sandbox.distro", os);
                        } catch {
                          /* ignore */
                        }
                      }}
                      className={cn(
                        "flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10px] font-medium transition-colors",
                        linuxDistro === os
                          ? "bg-foreground/10 text-foreground"
                          : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
                      )}
                      title={
                        os === "alpine"
                          ? "Alpine Linux — fast boot (~17 MB)"
                          : "Debian 12 — full OS: dpkg, apt, python3, vim, curl (~55 MB, slower boot)"
                      }
                    >
                      {os === "alpine" ? "Alpine" : "Debian 12"}
                    </button>
                  ))}
                </>
              )}
              <span className="ml-auto hidden text-[10px] text-muted-foreground/60 sm:block">
                {linuxSub === "real"
                  ? `genuine kernel + ${linuxDistro === "alpine" ? "Alpine" : "Debian 12"} rootfs · full root · ${linuxDistro === "alpine" ? "boots in ~15s" : "boots in ~30-60s"}`
                  : "instant · full root shell · real permissions · shares files with the chat"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              {linuxSub === "real" ? <RealLinux key={linuxDistro} distro={linuxDistro} /> : <LinuxTerminal />}
            </div>
          </div>
        ) : tab === "files" ? (
          <FilesView />
        ) : tab === "preview" ? (
          <iframe
            key={nonce}
            title="Sandbox preview"
            className="h-full w-full bg-white"
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            srcDoc={doc}
          />
        ) : tab === "browser" ? (
          <Browser onClose={() => setTab("preview")} />
        ) : (
          <textarea
            value={tab === "html" ? html : tab === "css" ? css : js}
            onChange={(e) => {
              if (tab === "html") setHtml(e.target.value);
              else if (tab === "css") setCss(e.target.value);
              else setJs(e.target.value);
            }}
            spellCheck={false}
            className="h-full w-full resize-none bg-neutral-950 p-4 font-mono text-[13px] leading-6 text-neutral-100 outline-none placeholder:text-neutral-600"
            placeholder={tab === "html" ? "<div>Hello</div>" : tab === "css" ? "body { }" : "console.log('hi')"}
          />
        )}
      </div>
    </div>
  );
}
