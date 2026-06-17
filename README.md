# ayontclaudian

<div align="center">

![GitHub stars](https://img.shields.io/github/stars/Ayont/ayontclaudian?style=social)
![GitHub release](https://img.shields.io/github/v/release/Ayont/ayontclaudian)
![License](https://img.shields.io/github/license/Ayont/ayontclaudian)

![ayontclaudian hero banner](assets/ayontclaudian-hero.png)

**AI coding agents inside your Obsidian vault.**  
Claude Code, Codex, Antigravity, Kimi, Vibe (Mistral), Grok (xAI), Opencode, Pi — unified behind one model picker, one chat sidebar, and one workflow.

</div>

ayontclaudian embeds popular coding-agent CLIs as first-class collaborators in your vault. Your vault becomes the agent's working directory: file read/write, search, bash, git operations, and multi-step agentic workflows work out of the box. Switch models and providers mid-chat without losing context.

---

## What it gives you

- **Multi-provider chat** — Claude, Codex, Antigravity, Kimi, Vibe, Grok, Opencode, Pi in a single sidebar.
- **Unified model picker** — One dropdown for every enabled provider; pick any model at any point in the conversation.
- **Mid-chat provider switching** — Change the active provider or model in-place; prior messages stay visible and the next turn uses the new agent.
- **One-click CLI installs** — Detect missing CLIs and install them directly from the plugin settings.
- **Vault-native workspace** — The agent sees your vault as its working directory, so file edits, searches, shell commands, and git workflows apply to your notes immediately.
- **Inline edit** — Select text (or place the cursor) and trigger a hotkey to edit notes with word-level diff preview.
- **Slash commands & skills** — Type `/` or `$` for reusable prompt templates and skills from user- and vault-level scopes.
- **`@mention`** — Mention vault files, subagents, MCP servers, or external directories.
- **Plan mode** — `Shift+Tab` lets the agent explore and design before implementing, then present a plan for approval.
- **Instruction mode (`#`)** — Append refined custom instructions from the chat input.
- **MCP servers** — Connect external tools via Model Context Protocol (stdio, SSE, HTTP).
- **Multi-tab conversations** — Several chat tabs, conversation history, fork, resume, and compact.
- **Live status panel** — See what the agent is doing (thinking, bash, tool calls) and expand details on demand.
- **10 locales** — Internationalized UI.

---

## Supported providers

| Provider | CLI | Notes |
|----------|-----|-------|
| **Claude** | `claude` | Full feature set; managed vault MCP, native history, rewind/fork. |
| **Codex** | `codex` | OpenAI Codex CLI via app-server adaptor. |
| **Antigravity** | `antigravity` | General-purpose coding agent CLI. |
| **Kimi** | `kimi` | Moonshot Kimi coding agent. |
| **Vibe** | `vibe` | Mistral coding agent. |
| **Grok** | `grok` | xAI Grok coding agent. |
| **Opencode** | `opencode` | Agent Client Protocol (ACP) based. |
| **Pi** | `pi` | JSON-RPC transport with JSONL history. |

---

## Requirements

- Obsidian **v1.7.2+**
- **Desktop only** (macOS, Linux, Windows)
- At least one supported CLI installed, or use the in-app installer to set one up

---

## Installation

### From Obsidian Community Plugins (recommended)

1. Open Obsidian → **Settings → Community plugins → Browse**
2. Search for **"ayontclaudian"** and click **Install**
3. Enable the plugin

Or install directly from the [community plugin page](https://community.obsidian.md/plugins/realclaudian).

### From GitHub Release

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Ayont/ayontclaudian/releases/latest)
2. Create the plugin folder in your vault:
   ```
   /path/to/vault/.obsidian/plugins/realclaudian/
   ```
3. Copy the three downloaded files into that folder
4. Enable **ayontclaudian** in Obsidian under **Settings → Community plugins**

### Via BRAT (beta plugin installer)

1. Install and enable the [**BRAT**](https://github.com/TfTHacker/obsidian42-brat) plugin from Community Plugins
2. Open **BRAT → Add Beta plugin**
3. Enter `Ayont/ayontclaudian` and click **Add Plugin**
4. Enable **ayontclaudian** in **Settings → Community plugins**

BRAT checks the latest GitHub release automatically. Turn on **Auto-update all plugins** in BRAT's settings to get ayontclaudian updates right after each release.

### From source (development)

```bash
cd /path/to/vault/.obsidian/plugins
git clone https://github.com/Ayont/ayontclaudian.git realclaudian
cd realclaudian
npm install
npm run build
```

Then enable the plugin in Obsidian.

---

## Quick start

1. Open the **ayontclaudian** sidebar from the ribbon icon or command palette.
2. Pick a model from the bottom toolbar.
3. Type a request — the agent can read, write, edit, search, and run shell commands in your vault.
4. Switch models or providers anytime via the model picker.

---

## Development

```bash
# Install dependencies
npm install

# Production build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Lint
npm run lint

# Type check
npm run typecheck
```

---

## Privacy & data use

- **Sent to providers**: Your input, attached files, images, and tool call outputs go to the provider you selected (Anthropic, OpenAI, xAI, Mistral, Moonshot, or the configured endpoint).
- **Local storage**: Plugin settings and session metadata live in your vault; provider CLIs store their own session data under their default paths (e.g. `~/.claude/projects/`, `~/.codex/sessions/`).
- **Environment variables**: Provider subprocesses inherit the Obsidian process environment plus any custom variables you configure in ayontclaudian. This is required for CLI authentication, proxies, certificates, and PATH resolution.
- **No telemetry**: ayontclaudian does not run analytics beacons. UI polling reads only local Obsidian/editor state; network activity is limited to explicit provider runtime work, configured MCP endpoints, and provider SDK/CLI calls.

---

## Troubleshooting

### CLI not found

If you see `spawn <cli> ENOENT`, the plugin cannot find the CLI binary.

1. Leave the CLI path setting empty first so ayontclaudian tries auto-detection.
2. If that fails, locate the binary and paste the absolute path into **Settings → Providers → `<provider>` → CLI path**.

Common paths:

| Platform | Command | Example |
|----------|---------|---------|
| macOS/Linux | `which claude` | `/Users/you/.local/bin/claude` |
| Windows (native) | `where.exe claude` | `C:\Users\you\AppData\Local\Claude\claude.exe` |

### Node.js / npm CLIs not visible to Obsidian

GUI apps on macOS often do not see shells like `nvm` or `fnm`. Either:

- Install a native binary, or
- Add the Node.js bin directory to **Settings → Environment → Custom variables**: `PATH=/path/to/node/bin`

### Provider-specific issues

Each provider has its own settings tab. Verify the CLI path, API key / environment variables, and model selection there. If a provider fails to start, check the Obsidian Developer Console for the exact error from the CLI.

---

## Architecture

```
src/
├── main.ts                      # Plugin entry point
├── app/                         # Shared defaults and plugin-level storage
├── core/                        # Provider-neutral runtime, registry, types
│   ├── runtime/                 # ChatRuntime interface and approval types
│   ├── providers/               # Provider registry, settings coordinator
│   ├── auxiliary/               # Shared provider auxiliary services
│   ├── bootstrap/               # Plugin bootstrap wiring
│   ├── security/                # Approval utilities
│   ├── commands/                # Provider commands
│   ├── mcp/                     # MCP server management
│   ├── prompt/                  # Prompt utilities
│   ├── storage/                 # Persistence
│   ├── tools/                   # Tool contracts
│   └── types/                   # Core types
├── providers/
│   ├── claude/                  # Claude SDK adaptor, storage, MCP, plugins
│   ├── codex/                   # Codex app-server adaptor, JSONL history
│   ├── antigravity/             # Antigravity provider
│   ├── kimi/                    # Kimi provider
│   ├── vibe/                    # Vibe (Mistral) provider
│   ├── grok/                    # Grok (xAI) provider
│   ├── opencode/                # Opencode / ACP adaptor
│   └── pi/                      # Pi RPC adaptor, model discovery, JSONL history
├── features/
│   ├── chat/                    # Sidebar chat: tabs, controllers, renderers
│   ├── inline-edit/             # Inline edit modal and services
│   └── settings/                # Settings shell with provider tabs
├── shared/                      # Reusable UI components and modals
├── i18n/                        # Internationalization
├── types/                       # Shared ambient types
├── utils/                       # Cross-cutting utilities
└── style/                       # Modular CSS
```

---

## License

Licensed under the [MIT License](LICENSE).

---

## Acknowledgments

- [Obsidian](https://obsidian.md) for the plugin API
- [Anthropic](https://anthropic.com) for Claude and the Claude Agent SDK
- [OpenAI](https://openai.com) for Codex
- [xAI](https://x.ai) for Grok
- [Mistral](https://mistral.ai) for Vibe
- [Moonshot AI](https://moonshot.ai) for Kimi
- [Opencode](https://opencode.ai/)
- [Pi](https://github.com/earendil-works/pi)
- [Antigravity](https://antigrid.ai/)
