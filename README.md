<div align="center">

# ayontclaudian

[![GitHub stars](https://img.shields.io/github/stars/Ayont/ayontclaudian?style=social)](https://github.com/Ayont/ayontclaudian/stargazers)
[![GitHub release](https://img.shields.io/github/v/release/Ayont/ayontclaudian)](https://github.com/Ayont/ayontclaudian/releases)
[![Tests](https://img.shields.io/badge/tests-7400%2B%20passing-brightgreen)](https://github.com/Ayont/ayontclaudian/actions)
[![License](https://img.shields.io/github/license/Ayont/ayontclaudian)](LICENSE)

**Twelve AI coding agents. One Obsidian sidebar. Your vault is the workspace.**

![ayontclaudian hero banner](assets/ayontclaudian-hero.png)

*Claude Code · OpenAI Codex · Antigravity · Kimi · Mistral Vibe · Grok · Opencode · Hermes · Cline · Freebuff · Pi · DSH*
</div>

---

## Why

Every coding agent ships its own terminal UI, its own session store, its own idea of project context. ayontclaudian embeds the real CLIs as chat runtimes **inside Obsidian** — so the agent reads and edits your notes, searches your vault, runs shell commands and git workflows where your work actually lives. Switch providers or models mid-conversation without losing a single message.

- 🔌 **Provider-native, not simulated** — each adaptor drives the official CLI or SDK (Claude Agent SDK, `codex app-server` JSON-RPC, ACP for Opencode/Hermes, HTTP+SSE for Freebuff). Real streaming, real tool calls, real session resumes.
- 🧭 **Mid-chat provider switching** — fork a conversation to Codex when Claude gets stuck; history stays visible, state stays per-provider.
- 📊 **Usage and cost center** — token spend per provider/model with subscription-aware pricing that never invents a rate.
- ⏳ **Rate-limit chips in the status bar** — live windows like `5h: 34% · Reset 1h 30m`, read straight from the provider's own reporting (Codex) plus local rolling-window tracking for everyone else.
- 🤖 **Multi-agent missions** — a master prompter writes one tailored prompt per specialist, then routes subtasks to whichever provider still has capacity headroom.
- 🎯 **Goal loops** — `/goal` runs verify-and-retry rounds with an adversarial verifier until the objective actually holds.
- ↩️ **Undo everything** — vault snapshots back every turn; rewind and fork supported natively (Claude) or via transcript replay (Codex).
- ✏️ **Inline edit** — select text anywhere in a note, hotkey, word-level diff preview, accept or reject.
- 🧩 **MCP, skills, slash commands, mentions** — vault-scoped skills, managed MCP servers, reusable prompt templates, file and subagent mentions.
- 🛡️ **Plan mode** — let the agent explore first and present a plan for approval before it touches anything.

## Providers

| Provider | Transport | Highlights |
|---|---|---|
| **Claude Code** | Official Agent SDK | Full feature set: rewind/fork, native history, vault MCP, plan mode |
| **OpenAI Codex** | `app-server` JSON-RPC | Fork, JSONL history reload, subagents, images, native rate-limit windows |
| **Antigravity** | `agy --print` | Single-shot with transcript-tailed state recovery |
| **Kimi** | NDJSON + ACP | Moonshot coding agent |
| **Vibe** | NDJSON | Mistral coding agent |
| **Grok** | Delta JSON | xAI, resumable sessions |
| **Opencode** | ACP | Shared Agent-Client-Protocol transport |
| **Hermes** | ACP | Model catalog plus modes from session/new, SQLite state history |
| **Cline** | `--print` | Home of the `/goal` verification loop |
| **Freebuff** | HTTP + SSE | Local desktop orchestrator, launch-id auth, live SSE bus |
| **Pi** | `--print` | Minimal, fast |
| **DSH** | `--print` | Reads model selection from DeepSeek Harness config |

> Adding provider #13 is mechanical — see the provider docs in this repo.

## Install

### BRAT (recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Choose `Add beta plugin` and enter `Ayont/ayontclaudian`
3. Enable **ayontclaudian** in community plugins

### Manual

Grab `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Ayont/ayontclaudian/releases/latest) into `.obsidian/plugins/realclaudian/`.

### Requirements

Obsidian desktop plus at least one provider CLI installed and logged in. Missing CLIs can be installed directly from the plugin settings — including standalone updaters for opencode, grok and claude.

## Quick start

1. Open the Claudian sidebar (ribbon icon)
2. Pick a provider and model in the unified picker
3. Ask something about your vault — try "summarize everything I wrote about project X last week"
4. Watch the status bar: context usage on one side, rate-limit windows on the other

## Status bar at a glance

```text
● Claude   bereit   42%  [####......]   5h: 34% - Reset 1h 30m   7T: 8% - Reset 4d 2h
  provider  state   context meter    rate-limit windows (native Codex data / local tracker)
```

## Development

```bash
npm install
npm run dev        # watch build
npm test           # 7400+ unit and integration tests
npm run build      # production bundle
```

Architecture notes live in `CLAUDE.md` and per-directory guides (`src/core/CLAUDE.md`, `src/features/chat/CLAUDE.md`, and more). Every behavior change lands test-first; provider claims must be verified against the real binary, never guessed.

## How this fork differs

Forked from [YishenTu/claudian](https://github.com/YishenTu/claudian) and since rebuilt around a provider-neutral core: twelve adaptors behind one runtime contract, a budget and capacity engine for multi-agent routing, a cost center with honest pricing, CLI auto-update management, and a test suite that pins every trap we have ever hit. Not on the Obsidian community registry — updates ship via BRAT and GitHub releases.

## Acknowledgments

- [YishenTu/claudian](https://github.com/YishenTu/claudian) — the original plugin
- Anthropic, OpenAI, Moonshot, Mistral, xAI — the agents this embeds
- The Obsidian team for a canvas worth automating

<div align="center">

**If ayontclaudian saves you a tab-switch today, a star helps other vault people find it.**

</div>