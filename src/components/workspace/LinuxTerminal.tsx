import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FS_CHANGED_EVENT,
  TERMINAL_CMD_EVENT,
  loadFs,
  modeString,
  saveFs,
  type FsNode,
  type FsTree,
} from "@/lib/sandboxfs";

// ---------------------------------------------------------------------------
// A virtual root Linux shell that runs entirely in the browser — no keys, no
// network, works in the web app and inside the APK. It models a real POSIX
// filesystem with persistent storage (shared with the sandbox's file actions),
// supports pipes (`|`) and redirections (`>`, `>>`), and ships with the
// classic command set. `whoami` answers root. Every file carries real
// permission bits and an owner, so `ls -l`, `chmod`, `chown`, and `ln -s`
// behave like the genuine thing. 🐚
// ---------------------------------------------------------------------------

const CWD_KEY = "zenbox.linuxcwd";

/** Session start used by `uptime` / `ps` for a believable system clock. */
const BOOT_TIME = Date.now();

// ---- path helpers ----------------------------------------------------------

function normalize(path: string, cwd: string): string {
  const joined = path.startsWith("/") ? path : `${cwd}/${path}`;
  const parts: string[] = [];
  for (const seg of joined.split("/")) {
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

function listDir(fs: FsTree, dir: string): string[] {
  const prefix = dir === "/" ? "/" : `${dir}/`;
  const names = new Set<string>();
  for (const key of Object.keys(fs)) {
    if (key === dir) continue;
    if (key.startsWith(prefix)) {
      const rest = key.slice(prefix.length);
      if (rest && !rest.includes("/")) names.add(rest);
    }
  }
  return [...names].sort();
}

// ---- the shell -------------------------------------------------------------

type Line = { kind: "cmd" | "out" | "err" | "sys"; text: string };

const HELP = `Built-in commands (you are root — full access):
  ls [-l] [path]        list files (with permissions, owners)
  cd <path>             change directory
  pwd                   print working directory
  cat <file...>         print one or more files
  echo <text> [>|>> f]  print / redirect text
  sudo <cmd>            run a command as root (no password needed)
  su [-]                switch user (already root)
  chmod <mode> <file>   change permissions (e.g. 755, +x, -w)
  chown <user> <file>   change owner
  chgrp <group> <file>  change group
  ln [-s] <t> <name>    hard or symbolic link
  mkdir <path>          create directory
  touch <file>          create empty file
  rm [-r] <path>        remove file/dir
  cp <src> <dst>        copy
  mv <src> <dst>        move / rename
  grep <pat> [file]     search (pipe friendly)
  find [path]           list tree
  tree [path]           pretty directory tree
  stat <file>           detailed file info
  wc [file]             count lines/words/bytes
  head|tail [file]      first/last lines (pipe friendly)
  sort [file]           sort lines (pipe friendly)
  ps                    list processes
  kill <pid>            terminate a process
  who / groups / uptime / mount
  whoami / id           you are root
  date / uname / hostname
  env                   show environment
  history               command history
  clear                 clear screen
  help                  this help`;

const ENV: Record<string, string> = {
  USER: "root",
  HOME: "/root",
  SHELL: "/bin/bash",
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOSTNAME: "zenbox",
};

const PROCS: Array<{ pid: number; tty: string; time: string; cmd: string }> = [
  { pid: 1, tty: "?", time: "00:00:02", cmd: "init [1]" },
  { pid: 42, tty: "tty1", time: "00:00:00", cmd: "agetty tty1" },
  { pid: 217, tty: "pts/0", time: "00:00:00", cmd: "bash" },
  { pid: 231, tty: "pts/0", time: "00:00:00", cmd: "bash" },
];

/** Tools the sandbox can "download on demand" — type a missing command (e.g.
 *  `git` or `node`) and the terminal offers to install it with an animated
 *  download, writing a real executable into /usr/bin. */
const INSTALL_MARKER = "[[ZENBOX_INSTALL:";
const TOOLS: Record<string, { desc: string; size: string; script: string }> = {
  git: {
    desc: "distributed version control",
    size: "24.6 MB",
    script: `#!/bin/bash\n# git (simulated) — sandbox tool download\ncase "$1" in\n  --version) echo "git version 2.43.0 (zenbox-sandbox)";;\n  status) echo "On branch main — nothing to commit";;\n  *) echo "git: simulated tool. Try: git --version | git status";;\nesac\n`,
  },
  node: {
    desc: "JavaScript runtime",
    size: "38.2 MB",
    script: `#!/bin/bash\n# node (simulated) — sandbox tool download\nif [ "$1" = "--version" ]; then echo "v20.11.0 (zenbox-sandbox)"; exit 0; fi\nif [ -f "$1" ]; then echo "(simulated node) executed $1"; exit 0; fi\necho "node: simulated tool. Try: node --version";\n`,
  },
  python: {
    desc: "Python interpreter",
    size: "42.8 MB",
    script: `#!/bin/bash\n# python (simulated) — sandbox tool download\nif [ "$1" = "--version" ]; then echo "Python 3.12.2 (zenbox-sandbox)"; exit 0; fi\nif [ -f "$1" ]; then echo "(simulated python) ran $1"; exit 0; fi\necho "python: simulated tool. Try: python --version";\n`,
  },
  pip: {
    desc: "Python package installer",
    size: "8.4 MB",
    script: `#!/bin/bash\n# pip (simulated) — sandbox tool download\necho "pip: simulated tool. Try: pip --version";\n`,
  },
  npm: {
    desc: "Node package manager",
    size: "12.1 MB",
    script: `#!/bin/bash\n# npm (simulated) — sandbox tool download\nif [ "$1" = "--version" ]; then echo "10.4.0 (zenbox-sandbox)"; exit 0; fi\necho "npm: simulated tool. Try: npm --version";\n`,
  },
  curl: {
    desc: "HTTP transfer tool",
    size: "6.9 MB",
    script: `#!/bin/bash\n# curl (simulated) — sandbox tool download\nif [ "$1" = "--version" ]; then echo "curl 8.5.0 (zenbox-sandbox)"; exit 0; fi\nif [ -n "$1" ]; then echo "(simulated curl) fetched $1"; exit 0; fi\necho "curl: simulated tool. Try: curl --version";\n`,
  },
  wget: {
    desc: "network downloader",
    size: "5.1 MB",
    script: `#!/bin/bash\n# wget (simulated) — sandbox tool download\nif [ -n "$1" ]; then echo "(simulated wget) downloaded $1"; exit 0; fi\necho "wget: simulated tool. Try: wget <url>";\n`,
  },
};

function formatUptime(): string {
  const secs = Math.max(0, Math.floor((Date.now() - BOOT_TIME) / 1000));
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d} days, ${h}:${String(m).padStart(2, "0")}`;
  return `${h} hours, ${m} minutes`;
}

/** Parse an octal or symbolic chmod operand against a starting mode string. */
function applyChmod(current: string, operand: string): string {
  const digits = current.padStart(3, "0").split("").map(Number);
  const setBits = (op: "add" | "remove", mask: number) => {
    for (let i = 0; i < 3; i++) {
      digits[i] = op === "add" ? digits[i] | mask : digits[i] & ~mask;
      digits[i] = Math.max(0, Math.min(7, digits[i]));
    }
  };
  if (/^[0-7]{3}$/.test(operand)) return operand;
  const m = operand.match(/^([ugoa]*)([+-])([rwx]*)$/);
  if (!m) return current;
  const [, , op, perms] = m;
  let mask = 0;
  if (perms.includes("r")) mask |= 4;
  if (perms.includes("w")) mask |= 2;
  if (perms.includes("x")) mask |= 1;
  setBits(op === "+" ? "add" : "remove", mask);
  return digits.join("");
}

export function LinuxTerminal() {
  const [fs, setFs] = useState<FsTree>(loadFs);
  const [cwd, setCwd] = useState(() => localStorage.getItem(CWD_KEY) ?? "/root");
  const [lines, setLines] = useState<Line[]>([
    {
      kind: "sys",
      text: "Zenbox Linux 1.0 — full root shell (uid=0). Permissions, owners, pipes & redirection work like Linux. Type `help` to begin.",
    },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live mirrors so externally dispatched events always read current state.
  const fsRef = useRef(fs);
  const cwdRef = useRef(cwd);
  useEffect(() => {
    fsRef.current = fs;
  }, [fs]);
  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  useEffect(() => {
    try {
      localStorage.setItem(CWD_KEY, cwd);
    } catch {
      /* ignore */
    }
  }, [cwd]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Files created from the chat (Save file) land here immediately.
  useEffect(() => {
    const onFsChange = () => setFs(loadFs());
    window.addEventListener(FS_CHANGED_EVENT, onFsChange);
    return () => window.removeEventListener(FS_CHANGED_EVENT, onFsChange);
  }, []);

  // Persist the current tree and tell the rest of the app (Files tab, chat)
  // that it changed. Root-owned mutations always save.
  const persist = () => {
    saveFs(fsRef.current);
  };

  // ---- command execution ----------------------------------------------------

  const run = (raw: string): { out: string[]; err: string[] } => {
    const out: string[] = [];
    const err: string[] = [];

    // Redirection: split off > / >> at the top level.
    let redirect: { file: string; append: boolean } | null = null;
    let cmdText = raw.trim();
    const m = cmdText.match(/(.*?)\s*(>>|>)\s*([^\s|]+)\s*$/);
    if (m) {
      redirect = { file: normalize(m[3].trim(), cwdRef.current), append: m[2] === ">>" };
      cmdText = m[1].trim();
    }

    const writeOut = (line: string) => {
      if (redirect) {
        if (!fsRef.current[redirect.file]) {
          const parent = parentOf(redirect.file);
          if (fsRef.current[parent]?.type !== "dir") {
            err.push(`bash: ${baseOf(redirect.file)}: No such file or directory`);
            return;
          }
          fsRef.current[redirect.file] = { type: "file", content: "", mode: "644", owner: "root" };
        }
        const cur = fsRef.current[redirect.file]?.type === "file" ? fsRef.current[redirect.file].content : "";
        fsRef.current[redirect.file] = { type: "file", content: redirect.append ? cur + line + "\n" : line + "\n", mode: "644", owner: "root" };
        setFs({ ...fsRef.current });
        persist();
        return;
      }
      out.push(line);
    };

    // Pipes: split the pipeline, feed stdout of one into stdin of the next.
    const segments = cmdText.split("|").map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) return { out, err };
    let pipeInput: string[] | null = null;

    for (let i = 0; i < segments.length; i++) {
      const [cmd, ...args] = segments[i].split(/\s+/);
      const stdin = pipeInput;
      const result = exec(cmd, args, stdin);
      if (i === segments.length - 1) {
        for (const l of result.out) writeOut(l);
      }
      pipeInput = result.out;
    }
    return { out, err };
  };

  const exec = (
    cmd: string,
    args: string[],
    stdin: string[] | null,
  ): { out: string[]; err: string[] } => {
    const out: string[] = [];
    const err: string[] = [];
    const F = () => fsRef.current;
    const readFile = (path: string): string | null => {
      const p = normalize(path, cwdRef.current);
      const node = F()[p];
      return node?.type === "file" ? node.content : null;
    };

    switch (cmd) {
      case "help":
        out.push(HELP);
        break;
      case "clear":
        setLines([]);
        break;
      case "pwd":
        out.push(cwdRef.current);
        break;
      case "whoami":
        out.push("root");
        break;
      case "id":
        out.push("uid=0(root) gid=0(root) groups=0(root)");
        break;
      case "who":
        out.push("root     tty1        2026-08-10 09:12 (:0)");
        out.push("root     pts/0       2026-08-10 09:14 (zenbox)");
        break;
      case "groups":
        out.push("root : root");
        break;
      case "uptime":
        out.push(` 09:16:31 up ${formatUptime()},  2 users,  load average: 0.08, 0.04, 0.02`);
        break;
      case "mount":
        out.push("proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)");
        out.push("sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)");
        out.push("devtmpfs on /dev type devtmpfs (rw,nosuid,relatime,size=4096k)");
        out.push("zenroot on / type ext4 (rw,relatime)");
        out.push("tmpfs on /tmp type tmpfs (rw,nosuid,nodev)");
        break;
      case "ps":
        out.push("  PID TTY          TIME CMD");
        for (const p of PROCS) out.push(`${String(p.pid).padStart(5)} ${p.tty.padEnd(8)} ${p.time} ${p.cmd}`);
        out.push(`${String(999).padStart(5)} pts/0     00:00:00 ps`);
        break;
      case "kill": {
        const pid = Number(args[0]);
        if (!pid) {
          err.push("kill: usage: kill <pid>");
          break;
        }
        if (PROCS.some((p) => p.pid === pid)) out.push(`Process ${pid} terminated`);
        else err.push(`bash: kill: (${pid}) - No such process`);
        break;
      }
      case "date":
        out.push(new Date().toString());
        break;
      case "uname":
        out.push("Linux zenbox 6.1.0-zenbox #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux");
        break;
      case "hostname":
        out.push("zenbox");
        break;
      case "env":
        for (const [k, v] of Object.entries(ENV)) out.push(`${k}=${v}`);
        break;
      case "history":
        history.forEach((h, i) => out.push(`  ${i + 1}  ${h}`));
        break;
      case "sudo": {
        if (args.length === 0) {
          out.push("usage: sudo <command>");
          out.push("You are already root — sudo is a no-op here, just run the command directly.");
          break;
        }
        const sub = exec(args[0], args.slice(1), stdin);
        out.push(...sub.out);
        err.push(...sub.err);
        break;
      }
      case "su":
        if (args.length > 0 && args[0] !== "-" && args[0] !== "root") {
          err.push(`su: user ${args[0]} does not exist`);
        } else {
          out.push("Already root — you don't need a password. Everything is writable.");
        }
        break;
      case "ls": {
        const target = args.find((a) => !a.startsWith("-")) ?? ".";
        const long = args.includes("-l") || args.includes("-la") || args.includes("-al");
        const p = normalize(target, cwdRef.current);
        if (F()[p]?.type === "file") {
          if (long) {
            const node = F()[p];
            out.push(`${modeString(node)} root root ${String(node.content?.length ?? 0).padStart(8)} ${baseOf(p)}${node.link ? ` -> ${node.link}` : ""}`);
          } else {
            out.push(baseOf(p));
          }
          break;
        }
        if (F()[p]?.type !== "dir") {
          err.push(`ls: cannot access '${target}': No such file or directory`);
          break;
        }
        const entries = listDir(F(), p);
        if (long) {
          for (const e of entries) {
            const ep = p === "/" ? `/${e}` : `${p}/${e}`;
            const node = F()[ep];
            const perms = modeString(node);
            const owner = node.owner ?? "root";
            const size = node?.type === "file" ? (node.content?.length ?? 0) : 4096;
            out.push(`${perms} ${owner.padEnd(4)} root ${String(size).padStart(8)} ${e}${node?.type === "dir" ? "/" : ""}${node?.link ? ` -> ${node.link}` : ""}`);
          }
        } else {
          out.push(entries.length ? entries.join("   ") : "");
        }
        break;
      }
      case "cd": {
        const target = args[0] ?? "/root";
        const p = normalize(target, cwdRef.current);
        if (F()[p]?.type === "dir") setCwd(p);
        else err.push(`cd: ${target}: No such file or directory`);
        break;
      }
      case "cat": {
        if (!args[0]) {
          err.push("cat: missing operand");
          break;
        }
        for (const f of args) {
          const content = readFile(f);
          if (content === null) err.push(`cat: ${f}: No such file or directory`);
          else out.push(content.replace(/\n$/, ""));
        }
        break;
      }
      case "echo": {
        const text = args.join(" ");
        const unquoted = text.replace(/^["']|["']$/g, "");
        out.push(unquoted || "");
        break;
      }
      case "chmod": {
        const [operand, file] = args;
        if (!operand || !file) {
          err.push("chmod: usage: chmod <mode> <file>  (e.g. chmod 755 script.sh, chmod +x tool)");
          break;
        }
        const p = normalize(file, cwdRef.current);
        const node = F()[p];
        if (!node) {
          err.push(`chmod: cannot access '${file}': No such file or directory`);
          break;
        }
        node.mode = applyChmod(node.mode ?? (node.type === "dir" ? "755" : "644"), operand);
        setFs({ ...F() });
        persist();
        out.push(`mode of '${file}' changed to ${node.mode} (${modeString(node)})`);
        break;
      }
      case "chown": {
        const [ownerArg, file] = args;
        if (!ownerArg || !file) {
          err.push("chown: usage: chown <user> <file>");
          break;
        }
        const p = normalize(file, cwdRef.current);
        const node = F()[p];
        if (!node) {
          err.push(`chown: cannot access '${file}': No such file or directory`);
          break;
        }
        const owner = ownerArg.split(":")[0];
        node.owner = owner;
        setFs({ ...F() });
        persist();
        out.push(`changed owner of '${file}' to ${owner}`);
        break;
      }
      case "chgrp": {
        const [group, file] = args;
        if (!group || !file) {
          err.push("chgrp: usage: chgrp <group> <file>");
          break;
        }
        const p = normalize(file, cwdRef.current);
        const node = F()[p];
        if (!node) {
          err.push(`chgrp: cannot access '${file}': No such file or directory`);
          break;
        }
        setFs({ ...F() });
        persist();
        out.push(`changed group of '${file}' to ${group}`);
        break;
      }
      case "ln": {
        const sym = args.includes("-s");
        const rest = args.filter((a) => !a.startsWith("-"));
        const [src, dst] = rest;
        if (!src || !dst) {
          err.push(`ln: missing operand (usage: ln [-s] <target> <link>)`);
          break;
        }
        const dp = normalize(dst, cwdRef.current);
        const parent = parentOf(dp);
        if (F()[parent]?.type !== "dir") {
          err.push(`ln: cannot create link '${dst}': No such file or directory`);
          break;
        }
        const sp = normalize(src, cwdRef.current);
        const targetNode = F()[sp];
        if (sym) {
          F()[dp] = { type: "file", content: "", mode: "777", owner: "root", link: sp };
          out.push(`created symbolic link '${dst}' -> ${sp}`);
        } else {
          if (!targetNode || targetNode.type !== "file") {
            err.push(`ln: failed to create hard link '${dst}': ${src} is not a regular file`);
            break;
          }
          F()[dp] = { type: "file", content: targetNode.content, mode: targetNode.mode, owner: targetNode.owner };
          out.push(`created hard link '${dst}'`);
        }
        setFs({ ...F() });
        persist();
        break;
      }
      case "mkdir": {
        if (!args[0]) {
          err.push("mkdir: missing operand");
          break;
        }
        const p = normalize(args[0], cwdRef.current);
        const parent = parentOf(p);
        if (F()[parent]?.type !== "dir") {
          err.push(`mkdir: cannot create '${args[0]}': No such file or directory`);
          break;
        }
        if (F()[p]) {
          err.push(`mkdir: cannot create '${args[0]}': File exists`);
          break;
        }
        F()[p] = { type: "dir", content: "", mode: "755", owner: "root" };
        setFs({ ...F() });
        persist();
        break;
      }
      case "touch": {
        if (!args[0]) {
          err.push("touch: missing operand");
          break;
        }
        const p = normalize(args[0], cwdRef.current);
        const parent = parentOf(p);
        if (F()[parent]?.type !== "dir") {
          err.push(`touch: cannot touch '${args[0]}': No such file or directory`);
          break;
        }
        if (!F()[p]) {
          F()[p] = { type: "file", content: "", mode: "644", owner: "root" };
          setFs({ ...F() });
          persist();
        }
        break;
      }
      case "rm": {
        if (!args[0] && !args[1]) {
          err.push("rm: missing operand");
          break;
        }
        const recursive = args.includes("-r") || args.includes("-rf");
        const target = args.find((a) => !a.startsWith("-"));
        if (!target) break;
        const p = normalize(target, cwdRef.current);
        const node = F()[p];
        if (!node) {
          err.push(`rm: cannot remove '${target}': No such file or directory`);
          break;
        }
        if (node.type === "dir") {
          if (!recursive) {
            err.push(`rm: cannot remove '${target}': Is a directory`);
            break;
          }
          const prefix = p === "/" ? "/" : `${p}/`;
          for (const key of Object.keys(F()).filter((k) => k === p || k.startsWith(prefix))) delete F()[key];
        } else {
          delete F()[p];
        }
        setFs({ ...F() });
        persist();
        break;
      }
      case "cp": {
        const [src, dst] = args;
        if (!src || !dst) {
          err.push("cp: missing operand");
          break;
        }
        const content = readFile(src);
        if (content === null) {
          err.push(`cp: cannot stat '${src}': No such file or directory`);
          break;
        }
        const dp = normalize(dst, cwdRef.current);
        const srcNode = F()[normalize(src, cwdRef.current)];
        F()[dp] = { type: "file", content, mode: srcNode?.mode ?? "644", owner: srcNode?.owner ?? "root" };
        setFs({ ...F() });
        persist();
        break;
      }
      case "mv": {
        const [src, dst] = args;
        if (!src || !dst) {
          err.push("mv: missing operand");
          break;
        }
        const sp = normalize(src, cwdRef.current);
        const node = F()[sp];
        if (!node) {
          err.push(`mv: cannot stat '${src}': No such file or directory`);
          break;
        }
        const dp = normalize(dst, cwdRef.current);
        if (F()[dp]?.type === "dir") {
          const target = `${dp === "/" ? "" : dp}/${baseOf(sp)}`;
          F()[target] = node;
          delete F()[sp];
        } else {
          F()[dp] = node;
          delete F()[sp];
        }
        setFs({ ...F() });
        persist();
        break;
      }
      case "grep": {
        const pattern = args[0];
        if (!pattern) {
          err.push("grep: missing pattern");
          break;
        }
        let re: RegExp;
        try {
          re = new RegExp(pattern);
        } catch {
          re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        }
        const input = args[1] ? (readFile(args[1])?.split("\n") ?? []) : (stdin ?? []);
        for (const l of input) if (re.test(l)) out.push(l);
        break;
      }
      case "find": {
        const target = args[0] ?? ".";
        const p = normalize(target, cwdRef.current);
        const walk = (dir: string) => {
          for (const e of listDir(F(), dir)) {
            const ep = dir === "/" ? `/${e}` : `${dir}/${e}`;
            out.push(ep);
            if (F()[ep]?.type === "dir") walk(ep);
          }
        };
        walk(p);
        break;
      }
      case "tree": {
        const target = args[0] ?? ".";
        const p = normalize(target, cwdRef.current);
        const node = F()[p];
        if (!node) {
          err.push(`tree: ${target}: No such file or directory`);
          break;
        }
        if (node.type === "file") {
          out.push(baseOf(p));
          break;
        }
        out.push(p === "/" ? "/" : baseOf(p));
        const walk = (dir: string, prefix: string, depth: number) => {
          if (depth > 4) {
            out.push(`${prefix}└── …`);
            return;
          }
          const entries = listDir(F(), dir);
          entries.forEach((e, i) => {
            const last = i === entries.length - 1;
            const ep = dir === "/" ? `/${e}` : `${dir}/${e}`;
            const n = F()[ep];
            const isDir = n?.type === "dir";
            out.push(`${prefix}${last ? "└── " : "├── "}${e}${isDir ? "/" : ""}${n?.link ? ` -> ${n.link}` : ""}`);
            if (isDir) walk(ep, `${prefix}${last ? "    " : "│   "}`, depth + 1);
          });
        };
        walk(p, "", 0);
        break;
      }
      case "stat": {
        const file = args[0];
        if (!file) {
          err.push("stat: missing operand");
          break;
        }
        const p = normalize(file, cwdRef.current);
        const n = F()[p];
        if (!n) {
          err.push(`stat: cannot stat '${file}': No such file or directory`);
          break;
        }
        const owner = n.owner ?? "root";
        out.push(`  File: ${p}`);
        out.push(`  Size: ${n.type === "file" ? (n.content?.length ?? 0) : 4096}      Type: ${n.type === "dir" ? "directory" : n.link ? "symbolic link" : "regular file"}`);
        out.push(`  Mode: ${modeString(n)} (${n.mode ?? (n.type === "dir" ? "755" : "644")})`);
        out.push(`  Owner: ${owner}          Group: root`);
        out.push(`  Link: ${n.link ? `-> ${n.link}` : "no"}`);
        break;
      }
      case "wc": {
        const input = args[0] ? (readFile(args[0])?.split("\n") ?? []) : (stdin ?? []);
        const text = input.join("\n");
        out.push(`${input.length}  ${text.split(/\s+/).filter(Boolean).length}  ${text.length}`);
        break;
      }
      case "head": {
        const input = args[0] ? (readFile(args[0])?.split("\n") ?? []) : (stdin ?? []);
        const n = args.includes("-n") ? Number(args[args.indexOf("-n") + 1] ?? 10) : 10;
        out.push(...input.slice(0, Number.isFinite(n) ? n : 10));
        break;
      }
      case "tail": {
        const input = args[0] ? (readFile(args[0])?.split("\n") ?? []) : (stdin ?? []);
        const n = args.includes("-n") ? Number(args[args.indexOf("-n") + 1] ?? 10) : 10;
        out.push(...input.slice(Number.isFinite(n) ? -n : -10));
        break;
      }
      case "sort": {
        const input = args[0] ? (readFile(args[0])?.split("\n") ?? []) : (stdin ?? []);
        out.push(...[...input].sort());
        break;
      }
      case "install": {
        const tool = args[0];
        if (!tool || !TOOLS[tool]) {
          out.push(`Installable tools: ${Object.keys(TOOLS).join(", ")}`);
          break;
        }
        if (readFile(`/usr/bin/${tool}`)) {
          out.push(`${tool} is already installed.`);
          break;
        }
        const meta = TOOLS[tool];
        const steps = [
          `Downloading ${tool} ${meta.size} …`, // marker handled below
          `Fetching https://sandbox.zenbox.app/${tool}-latest.tar.gz`, // marker handled below
          `Extracting to /usr/bin/${tool} …`, // marker handled below
        ];
        for (const s of steps) out.push(s);
        out.push(`${INSTALL_MARKER}${tool}]]`);
        break;
      }
      case "df":
        out.push("Filesystem     1K-blocks    Used Available Use% Mounted on");
        out.push("/dev/sda1       30000000 1200000  28800000   4% /");
        break;
      case "free":
        out.push("               total        used        free      shared  buff/cache   available");
        out.push("Mem:          3770000    412000     3358000     82000          0     3358000");
        break;
      default: {
        const tool = TOOLS[cmd];
        if (tool && !readFile(`/usr/bin/${cmd}`)) {
          err.push(`bash: ${cmd}: command not found — but it's installable`);
          out.push(`${INSTALL_MARKER}${cmd}]] (${tool.size} · ${tool.desc}) — run 'install ${cmd}' to download it`);
        } else {
          err.push(`bash: ${cmd}: command not found (try 'help')`);
        }
        break;
      }
    }
    return { out, err };
  };

  /** Push a line into the scrollback (used for the animated tool download). */
  const pushLine = (kind: Line["kind"], text: string) => {
    setLines((prev) => [...prev, { kind, text }]);
  };

  /** Animated "download" for a missing tool — streams progress lines, then
   *  writes the executable into /usr/bin and reports done. */
  const downloadTool = (tool: string) => {
    const meta = TOOLS[tool];
    if (!meta) return;
    const steps = [
      `→ Downloading ${tool} ${meta.size} …`,
      `→ ${Math.round(Math.random() * 30 + 40)}% … ${Math.round(Math.random() * 30 + 70)}% … 100%`,
      `→ Installing to /usr/bin/${tool} …`,
      `✓ ${tool} installed (${meta.size} · ${meta.desc})`,
    ];
    steps.forEach((s, i) => {
      window.setTimeout(() => pushLine(i === steps.length - 1 ? "out" : "sys", s), 260 * (i + 1));
    });
    window.setTimeout(() => {
      const fs = fsRef.current;
      fs["/usr/bin"] = { type: "dir", content: "", mode: "755", owner: "root" };
      fs[`/usr/bin/${tool}`] = {
        type: "file",
        content: meta.script,
        mode: "755",
        owner: "root",
      };
      setFs({ ...fs });
      persist();
      pushLine("out", `Try it: ${tool} --version`);
    }, 260 * steps.length + 120);
  };

  /** Append a command line + its output to the scrollback. Shared by the form
   *  and the external "Run in terminal" event. */
  const execute = (text: string) => {
    const cmdLine = `root@zenbox:${cwdRef.current}# ${text}`;
    setLines((l) => [...l, { kind: "cmd", text: cmdLine }]);
    const { out, err } = run(text);
    for (const l of out) {
      // A tool-download marker triggers the animated install flow.
      const m = l.match(/^\[\[ZENBOX_INSTALL:([a-z]+)\]\]/);
      if (m) {
        downloadTool(m[1]);
        continue;
      }
      setLines((prev) => [...prev, { kind: "out", text: l }]);
    }
    for (const l of err) setLines((prev) => [...prev, { kind: "err", text: l }]);
  };

  // Commands dispatched from the chat ("Run in terminal") execute here even if
  // the sandbox opened after the click.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (!text?.trim()) return;
      execute(text);
    };
    window.addEventListener(TERMINAL_CMD_EVENT, onCmd);
    return () => window.removeEventListener(TERMINAL_CMD_EVENT, onCmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setHistory((h) => [...h, text]);
    setHistIdx(-1);
    setInput("");
    execute(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      if (history[idx]) {
        setHistIdx(idx);
        setInput(history[idx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(-1);
        setInput("");
      } else {
        setHistIdx(idx);
        setInput(history[idx]);
      }
    }
  };

  // Quick-command toolbar — one tap pipes a pipeline-tool command into the shell.
  const quickCommands = [
    { label: "ls", cmd: "ls -la", title: "List files with permissions" },
    { label: "tree", cmd: "tree /root", title: "Pretty directory tree" },
    { label: "ps", cmd: "ps", title: "List processes" },
    { label: "mkdir", cmd: "mkdir project", title: "Make a directory" },
    { label: "touch", cmd: "touch file.txt", title: "Create an empty file" },
    { label: "echo", cmd: "echo hello > file.txt", title: "Write text to a file" },
    { label: "chmod", cmd: "chmod +x file.txt", title: "Make a file executable" },
    { label: "cat", cmd: "cat file.txt", title: "Print a file" },
    { label: "find", cmd: "find / -name '*.js'", title: "Find files by name" },
    { label: "install", cmd: "install", title: "List & download sandbox tools" },
    { label: "clear", cmd: "clear", title: "Clear the screen" },
    { label: "help", cmd: "help", title: "List commands" },
  ];

  const runQuick = (cmd: string) => {
    setHistory((h) => [...h, cmd]);
    setInput("");
    execute(cmd);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      {/* Quick-command toolbar */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-800 px-2 py-1.5">
        <span className="shrink-0 pr-1 text-[9px] font-medium uppercase tracking-widest text-neutral-500">
          Tools
        </span>
        {quickCommands.map((q) => (
          <button
            key={q.label}
            type="button"
            title={q.title}
            onClick={() => runQuick(q.cmd)}
            className="shrink-0 rounded-sm border border-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400 transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            {q.label}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-5">
        {lines.map((l, i) => (
          <pre
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words",
              l.kind === "cmd" && "text-neutral-100",
              l.kind === "cmd" && l.text.startsWith("root@zenbox") && "text-emerald-400",
              l.kind === "out" && "text-neutral-300",
              l.kind === "err" && "text-red-400",
              l.kind === "sys" && "text-neutral-500",
            )}
          >
            {l.text || " "}
          </pre>
        ))}
        <form onSubmit={submit} className="mt-0.5 flex items-center gap-0">
          <span className="shrink-0 select-none text-emerald-400">root@zenbox:{cwd}# </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-neutral-100 caret-emerald-400 outline-none placeholder:text-neutral-600"
            placeholder="type a command, e.g. ls /"
            aria-label="Linux terminal input"
          />
        </form>
      </div>
    </div>
  );
}
