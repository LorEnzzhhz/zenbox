// ---------------------------------------------------------------------------
// Zenbox codebase map — the actual shape of this app, used by the Control
// app's Verify phase. The verify action hands this to the model so it can
// check every proposed change against REAL files, components, and backend
// functions instead of guessing. Keep this file in sync when the app changes.
// ---------------------------------------------------------------------------

export const CODEBASE_MAP = `ZENBOX — a minimal AI studio (React 19 + Vite + TypeScript + Tailwind v4 + Convex + Convex Auth).

ROUTES (src/pages/):
- Landing.tsx — public marketing page, links to /auth.
- Auth.tsx — sign-in/sign-up (email+password, email OTP, guest/anonymous).
- Dashboard.tsx — the studio workspace: sidebar (chats, projects, plugins), chat area,
  live activity panel, settings, sandbox, image generation, file handling.
- Updater.tsx — the Control app (developer console): plan → revise → review → verify → ship pipeline,
  live monitor roster with IPs, broadcasts, update history.
- Admin.tsx — admin panel (guests, access codes, overview).
- NotFound.tsx — 404.

STUDIO COMPONENTS (src/components/):
- workspace/Composer.tsx — chat input, attachments, image-request detection.
- workspace/MessageList.tsx — thread rendering: markdown, code blocks with Run/Save/Email/Download
  actions, images, sources, reasoning, token usage, saved-file chips.
- workspace/ActivityPanel.tsx — live feed of what the AI is doing (stage, thinking, plan, tools, files, errors).
- workspace/Sandbox.tsx — tabs: Preview / HTML / CSS / JS / Linux / Files; runs generated code.
- workspace/RealLinux.tsx — REAL Linux via v86 (kernel + Alpine rootfs.cpio in /public/linux),
  serial terminal, Pull/Push file bridge, snapshot save/restore (instant boot).
- workspace/LinuxTerminal.tsx — virtual Linux shell over the shared sandbox filesystem.
- workspace/ModelPicker.tsx — free-model catalog picker (OpenRouter + OpenCode Zen groups).
- workspace/modes.tsx — mode metadata (chat/code/write/image/deep).
- workspace/CodeBlock.tsx, markdown.tsx — code rendering + markdown.
- SettingsDialog.tsx — keys (OpenRouter, OpenCode Zen), appearance, cognition, bots, developer claim.
- CognitionPanel.tsx — per-device cognition config: context window, reasoning effort, language,
  agentic toggles (code interpreter, web browsing, file system), multimodal, performance,
  UX, personas (professional/code/writer/literature), system prompt, few-shot examples, debugging toggles.
- AppearancePrefs.tsx — palettes (mono/paper/terminal/ocean), live wallpapers (aurora/particles), sounds.
- LiveWallpaper.tsx — animated background layers.
- PluginsDialog.tsx — install/enable plugins & skills.
- UpdateNotice.tsx — release-notice banner + What's-New dialog.
- AnnouncementBanner.tsx — developer broadcasts.
- ClaimDeveloper.tsx, RequireAdmin.tsx, RequireAuth.tsx — roles/guards.
- BootScreen.tsx — app loading screen with sounds.

CONVEX BACKEND (src/convex/):
- ai.ts — model routing: resolveApiModel (Auto → Big Pickle for code/files, DeepSeek V4 Flash for
  chat/images, GPT-OSS fallback), RETRY_MODEL, completeWithRetry (Hy3-style retry chain),
  listModels, chat (single pass), makePlan (numbered plan), qualityChat (two-model draft + self-review).
- chatCore.ts — buildChatMessages: system prompt assembly (mode, plugins, research, plan, memory, profile).
- conversations.ts — threads, messages, editMessage, recallMemory (past-chat memory scan).
- http.ts — /chatStream SSE endpoint (token streaming, reasoning deltas, usage), Telegram bot webhook.
- updates.ts — Control pipeline: planUpdate, reviseUpdate, reviewUpdate, shipUpdate, history, latestShipped.
- admin.ts — users/overview/activity queries, access codes, request/approve/deny guest access.
- announcements.ts — broadcast to all users.
- search.ts — deepSearch: Wikipedia + DuckDuckGo + YouTube + TikTok/X/Instagram/Facebook + r.jina.ai reader.
- email.ts — send code to an inbox (Resend gateway).
- files.ts — attachment storage + URLs.
- plugins.ts — plugin/skill registry (install from GitHub or any site, enable/disable).
- projects.ts — project folders for conversations.
- bots.ts — Telegram bot token/webhook + Discord webhook config.
- settings.ts — per-user API keys (encrypted), getKeyForUser.
- schema.ts — tables: users, conversations, messages, updates, projects, plugins, announcements,
  accessRequests, userKeys. Update record: version, title, command, plan, revised, review, verdict,
  changes[{title, detail}], status (reviewed|shipped), releaseNotes, shippedAt.

LIB (src/lib/):
- zenbox.ts — AUTO_MODEL, model catalog, pollinations image URLs, titleFromPrompt.
- stream.ts — SSE stream reader (content + reasoning + usage).
- sandboxfs.ts — virtual filesystem (writeFile/readFile/listTree/download, FS_CHANGED_EVENT, TERMINAL_CMD_EVENT).
- cognition.ts — cognition profile builder (context window, reasoning effort, language, prompts).
- theme.tsx — ThemeProvider: theme (light/dark/system), palettes, wallpapers, ALL prefs defaults.
- sounds.ts — boot/send/error/ready sounds.
- tts.ts — text-to-speech.
- device.ts, utils.ts, keys.ts, vly-integrations.ts, zenbox helpers.

APK: main studio (android/) + Control app (android-control/, built from control.html → control-main.tsx
via vite.control.config.ts into dist-control/).

KEY USER FLOWS:
- One-mode auto routing: image prompts → Pollinations; build/write prompts → plan first (Activity panel);
  factual prompts → web search; then best-answer (two models + self-review) or token streaming.
- Files: any reply's code blocks are auto-saved into the sandbox filesystem (with download buttons).
- Updates: developer commands a change in Control → AI plans, revises, reviews, verifies, then the
  developer ships → every user gets a release notice.
- Guests: invite-only; can request access; developer approves with a code (monitor shows IP/device).`;
