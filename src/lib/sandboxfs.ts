// Shared virtual Linux filesystem backing both the sandbox terminal and the
// "save file" actions on generated code. Persisted in localStorage under the
// same key the terminal uses, so files the AI creates show up in `ls`/`cat`.
// Every write dispatches a window event so open terminals and file browsers
// refresh live.
//
// Full-root access: every node carries optional POSIX metadata — an octal
// `mode` (perms), an `owner` (default root), and an optional `link` target
// for symlinks — so `ls -l`, `chmod`, `chown`, and `ln -s` behave like the
// real thing.

export type FsNode = {
  type: "dir" | "file";
  content: string;
  /** Octal permissions, e.g. "755" for dirs, "644" for files. */
  mode?: string;
  /** Owning user name (defaults to root). */
  owner?: string;
  /** For symlinks: the target path the link points to. */
  link?: string;
};
export type FsTree = Record<string, FsNode>;

export const FS_KEY = "zenbox.linuxfs";
export const FS_CHANGED_EVENT = "zenbox:fs:changed";
export const TERMINAL_CMD_EVENT = "zenbox:terminal:cmd";

function freshFs(): FsTree {
  const files: Array<[string, string]> = [
    ["/etc/hostname", "zenbox\n"],
    ["/etc/os-release", 'NAME="Zenbox OS"\nVERSION="1.0"\n'],
    ["/etc/passwd", "root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000::/home/user:/bin/bash\n"],
    ["/root/.bashrc", 'export PS1="\\u@\\h:\\w# "\nalias ll="ls -l"\n'],
    ["/root/README.txt", "Welcome to the Zenbox Linux sandbox!\n\nYou are root. Explore with ls, cd, cat, mkdir, echo.\nType `help` for the full command list.\n"],
    ["/home/user/.bashrc", "export PS1='\\u@\\h:\\w$ '\n"],
  ];
  const fs: FsTree = { "/": { type: "dir", content: "", mode: "755" } };
  for (const dir of ["/bin", "/boot", "/dev", "/etc", "/home", "/home/user", "/lib", "/mnt", "/opt", "/proc", "/root", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/usr/bin", "/usr/local", "/var", "/var/log"]) {
    fs[dir] = { type: "dir", content: "", mode: "755" };
  }
  for (const [p, c] of files) {
    const dir = p.slice(0, p.lastIndexOf("/")) || "/";
    fs[dir] = { type: "dir", content: "", mode: "755" };
    fs[p] = { type: "file", content: c, mode: p.endsWith(".sh") ? "755" : "644", owner: "root" };
  }
  return fs;
}

export function loadFs(): FsTree {
  try {
    const raw = localStorage.getItem(FS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FsTree;
      if (parsed["/"]?.type === "dir") return parsed;
    }
  } catch {
    /* ignore */
  }
  return freshFs();
}

export function saveFs(fs: FsTree) {
  try {
    localStorage.setItem(FS_KEY, JSON.stringify(fs));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(FS_CHANGED_EVENT));
}

/** Default octal mode for a node that has none stored. */
export function defaultMode(node: FsNode): string {
  return node.type === "dir" ? "755" : "644";
}

/** Render an octal mode as a POSIX `-rwxr-xr-x` style string. */
export function modeString(node: FsNode): string {
  const oct = (node.mode ?? defaultMode(node)).padStart(3, "0");
  const bits = [4, 2, 1];
  let out = node.type === "dir" ? "d" : node.link ? "l" : "-";
  for (let i = 0; i < 3; i++) {
    const b = Number(oct[i] ?? "0");
    out += b & 4 ? "r" : "-";
    out += b & 2 ? "w" : "-";
    out += b & 1 ? "x" : "-";
  }
  return out;
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join("/")}`;
}

function parentOf(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx) || "/";
}

function baseOf(p: string): string {
  const idx = p.lastIndexOf("/");
  return p.slice(idx + 1);
}

/** Write (or overwrite) a file, creating parent dirs on the way. Returns the
 *  normalized path. */
export function writeFile(path: string, content: string): string {
  const fs = loadFs();
  const p = normalize(path);
  if (p === "/") return p;
  const parent = parentOf(p);
  const ensureDir = (dir: string) => {
    if (dir === "/" || fs[dir]?.type === "dir") return;
    ensureDir(parentOf(dir));
    fs[dir] = { type: "dir", content: "", mode: "755" };
  };
  ensureDir(parent);
  fs[p] = { type: "file", content, mode: "644", owner: fs[p]?.owner ?? "root" };
  saveFs(fs);
  return p;
}

export function readFile(path: string): string | null {
  const fs = loadFs();
  const node = fs[normalize(path)];
  return node?.type === "file" ? node.content : null;
}

export function removeFile(path: string) {
  const fs = loadFs();
  delete fs[normalize(path)];
  saveFs(fs);
}

/** Recursive listing for the sandbox's Files tab. */
export function listTree(): Array<{ path: string; type: "dir" | "file"; size: number }> {
  const fs = loadFs();
  const out: Array<{ path: string; type: "dir" | "file"; size: number }> = [];
  const walk = (dir: string) => {
    const prefix = dir === "/" ? "/" : `${dir}/`;
    for (const key of Object.keys(fs)) {
      if (key === dir) continue;
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest && !rest.includes("/")) {
        const node = fs[key];
        out.push({ path: key, type: node.type, size: node.type === "file" ? (node.content?.length ?? 0) : 0 });
        if (node.type === "dir") walk(key);
      }
    }
  };
  walk("/");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Default filename for a language tag. */
export function defaultNameFor(language: string, hint?: string): string {
  const slug = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  if (hint && slug(hint)) return slug(hint);
  const map: Record<string, string> = {
    html: "index.html",
    htm: "index.html",
    css: "style.css",
    scss: "style.scss",
    less: "style.less",
    js: "app.js",
    javascript: "app.js",
    mjs: "app.mjs",
    ts: "app.ts",
    typescript: "app.ts",
    jsx: "app.jsx",
    tsx: "app.tsx",
    vue: "App.vue",
    svelte: "App.svelte",
    python: "app.py",
    py: "app.py",
    go: "main.go",
    golang: "main.go",
    rust: "main.rs",
    rs: "main.rs",
    java: "Main.java",
    kotlin: "Main.kt",
    kt: "Main.kt",
    c: "main.c",
    h: "main.h",
    cpp: "main.cpp",
    cxx: "main.cpp",
    cc: "main.cc",
    csharp: "Program.cs",
    cs: "Program.cs",
    swift: "main.swift",
    dart: "main.dart",
    ruby: "main.rb",
    rb: "main.rb",
    php: "index.php",
    perl: "script.pl",
    lua: "script.lua",
    r: "script.R",
    scala: "Main.scala",
    groovy: "script.groovy",
    elixir: "script.exs",
    haskell: "main.hs",
    erlang: "script.erl",
    objectivec: "main.m",
    bash: "script.sh",
    sh: "script.sh",
    zsh: "script.zsh",
    powershell: "script.ps1",
    ps1: "script.ps1",
    dockerfile: "Dockerfile",
    makefile: "Makefile",
    cmake: "CMakeLists.txt",
    json: "data.json",
    yaml: "config.yaml",
    yml: "config.yml",
    toml: "config.toml",
    ini: "config.ini",
    conf: "config.conf",
    xml: "config.xml",
    svg: "image.svg",
    csv: "data.csv",
    tsv: "data.tsv",
    sql: "query.sql",
    md: "notes.md",
    markdown: "notes.md",
    txt: "notes.txt",
    text: "notes.txt",
    env: ".env",
    gitignore: ".gitignore",
    gradle: "build.gradle",
    kts: "build.gradle.kts",
    tf: "main.tf",
    proto: "service.proto",
    graphql: "schema.graphql",
    gql: "schema.graphql",
  };
  const lang = language.toLowerCase();
  return map[lang] ?? (lang ? `file-${lang.replace(/[^a-z0-9]/g, "") || "txt"}.${lang.replace(/[^a-z0-9]/g, "") || "txt"}` : "file.txt");
}

/** Pick a unique file name inside a directory (appends -2, -3… if taken). */
export function uniquePath(dir: string, name: string): string {
  const fs = loadFs();
  const base = dir === "/" ? "" : dir;
  let candidate = `${base}/${name}`;
  let n = 2;
  while (fs[candidate]?.type === "file") {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    candidate = `${base}/${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

/** Extract a `file:` name hint from the first comment line of generated code. */
export function fileNameHint(code: string): string | null {
  const first = code.split("\n").find((l) => l.trim().length > 0);
  if (!first) return null;
  const m = first.match(/file\s*[:=]\s*["']?([\w./-]+)["']?/i);
  return m ? m[1] : null;
}

/** Download a file from the virtual filesystem to the device. Returns the
 *  path on success, null if the file doesn't exist. */
export function downloadFsFile(path: string): string | null {
  const content = readFile(path);
  if (content === null) return null;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = baseOf(path) || "file.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  return path;
}

/** Build a compact, readable snapshot of the sandbox for the AI model: the
 *  file tree plus the contents of small text files (capped). This is what
 *  gives the model full read access to the workspace on every turn — it can
 *  see the real files, then edit/create/delete them via `// file:` and
 *  `// delete:` blocks. */
export function buildWorkspaceContext(maxBytes = 44_000): string {
  const files = listTree().filter((f) => f.path !== "/");
  if (files.length === 0) return "";
  const out: string[] = [];
  let used = 0;
  const tree = files
    .slice(0, 250)
    .map((f) => `${f.type === "dir" ? "📁" : "📄"} ${f.path}${f.type === "file" ? ` (${f.size} B)` : ""}`)
    .join("\n");
  used += tree.length;
  out.push(`File tree:\n${tree || "(empty)"}`);
  const contents: string[] = [];
  for (const f of files.filter((x) => x.type === "file").slice(0, 80)) {
    if (used >= maxBytes) break;
    const content = readFile(f.path);
    if (content === null || content.length > 10_000) continue;
    contents.push(`--- ${f.path} ---\n${content}`);
    used += content.length + f.path.length + 32;
  }
  if (contents.length > 0) {
    out.push(`File contents (read-only snapshot — modify files by re-emitting them as // file: blocks):\n${contents.join("\n\n")}`);
  }
  return out.join("\n\n");
}

/** Download an arbitrary text blob (e.g. generated code) as a file. */
export function downloadTextFile(name: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
