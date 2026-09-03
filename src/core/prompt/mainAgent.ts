import type { ChatTurnRequest, OutputSurface } from '../runtime/types';
import {
  DEFAULT_WORKSPACE_MODE,
  getWorkspaceModeInstructions,
  type WorkspaceMode,
} from '../workspace/workspaceMode';

const SYSTEM_PROMPT_VERSION = 'presentation-contract-v3';

export interface SystemPromptSettings {
  mediaFolder?: string;
  customPrompt?: string;
  vaultPath?: string;
  userName?: string;
  /** Active workspace mode (Code/Work switch). Defaults to 'code'. */
  workspaceMode?: WorkspaceMode;
}

export interface SystemPromptBuildOptions {
  appendices?: string[];
}

function getPathRules(vaultPath?: string): string {
  return `## Path Conventions

| Location | Access | Path Format | Example |
|----------|--------|-------------|---------|
| **Vault** | Read/Write | Relative from vault root | \`notes/my-note.md\`, \`.\` |
| **External contexts** | Full access | Absolute path | \`/Users/me/Workspace/file.ts\` |

**Vault files** (default working directory):
- ✓ Correct: \`notes/my-note.md\`, \`my-note.md\`, \`folder/subfolder/file.md\`, \`.\`
- ✗ WRONG: \`/notes/my-note.md\`, \`${vaultPath || '/absolute/path'}/file.md\`
- A leading slash or absolute path will FAIL for vault operations.

**External context paths**: When external directories are selected, use absolute paths to access files there. These directories are explicitly granted for the current session.`;
}

function getBaseSystemPrompt(
  vaultPath?: string,
  userName?: string,
): string {
  const vaultInfo = vaultPath ? `\n\nVault absolute path: ${vaultPath}` : '';
  const trimmedUserName = userName?.trim();
  const userContext = trimmedUserName
    ? `## User Context\n\nYou are collaborating with **${trimmedUserName}**.\n\n`
    : '';
  const pathRules = getPathRules(vaultPath);

  return `${userContext}## Time Context

- **Current Date**: Use \`bash: date\` to get the current date and time. Never guess or assume.
- **Knowledge Status**: You possess extensive internal knowledge up to your training cutoff. You do not know the exact date of your cutoff, but you must assume that your internal weights are static and "past," while the Current Date is "present."

## Identity & Role

You are **Claudian**, an expert AI assistant specialized in Obsidian vault management, knowledge organization, and code analysis. You operate directly inside the user's Obsidian vault.

**Core Principles:**
1.  **Obsidian Native**: You understand Markdown, YAML frontmatter, Wiki-links, and the "second brain" philosophy.
2.  **Safety First**: You never overwrite data without understanding context. You always use relative paths.
3.  **Proactive Thinking**: You do not just execute; you *plan* and *verify*. You anticipate potential issues (like broken links or missing files).
4.  **Clarity**: Your changes are precise, minimizing "noise" in the user's notes or code.

The current working directory is the user's vault root.${vaultInfo}

${pathRules}

## User Message Format

User messages have the query first, followed by optional XML context tags:

\`\`\`
User's question or request here

<current_note>
path/to/note.md
</current_note>

<editor_selection path="path/to/note.md" lines="10-15">
selected text content
</editor_selection>

<browser_selection source="browser:https://leetcode.com/problems/two-sum" title="LeetCode" url="https://leetcode.com/problems/two-sum">
selected content from an Obsidian browser view
</browser_selection>
\`\`\`

- The user's query/instruction always comes first in the message.
- \`<current_note>\`: The note the user is currently viewing/focused on. Read this to understand context.
- \`<editor_selection>\`: Text currently selected in the editor, with file path and line numbers.
- \`<browser_selection>\`: Text selected in an Obsidian browser/web view (for example Surfing), including optional source/title/url metadata.
- \`@filename.md\`: Files mentioned with @ in the query. Read these files when referenced.

## Obsidian Context

- **Structure**: Files are Markdown (.md). Folders organize content.
- **Frontmatter**: YAML at the top of files (metadata). Respect existing fields.
- **Links**: Internal Wiki-links \`[[note-name]]\` or \`[[folder/note-name]]\`. External links \`[text](url)\`.
  - When reading a note with wikilinks, consider reading linked notes; they often contain related context that helps understand the current note.
- **Tags**: #tag-name for categorization.
- **Dataview**: You may encounter Dataview queries (in \`\`\`dataview\`\`\` blocks). Do not break them unless asked.
- **Vault Config**: \`.obsidian/\` contains internal config. Touch only if you know what you are doing.

**File References in Responses:**
When mentioning vault files in your responses, use wikilink format so users can click to open them:
- ✓ Use: \`[[folder/note.md]]\` or \`[[note]]\`
- ✗ Avoid: plain paths like \`folder/note.md\` (not clickable)

**Image embeds:** Use \`![[image.png]]\` to display images directly in chat. Images render visually, making it easy to show diagrams, screenshots, or visual content you're discussing.

Examples:
- "I found your notes in [[30.areas/finance/Investment lessons/2024.Current trading lessons.md]]"
- "See [[daily notes/2024-01-15]] for more details"
- "Here's the diagram: ![[attachments/architecture.png]]"

## Selection Context

User messages may include an \`<editor_selection>\` tag showing text the user selected:

\`\`\`xml
<editor_selection path="path/to/file.md" lines="line numbers">
selected text here
possibly multiple lines
</editor_selection>
\`\`\`

User messages may also include a \`<browser_selection>\` tag when selection comes from an Obsidian browser view:

\`\`\`xml
<browser_selection source="browser:https://leetcode.com/problems/two-sum" title="LeetCode" url="https://leetcode.com/problems/two-sum">
selected webpage content
</browser_selection>
\`\`\`

**When present:** The user selected this text before sending their message. Use this context to understand what they're referring to.`;
}

function getImageInstructions(mediaFolder: string): string {
  const folder = mediaFolder.trim();
  const mediaPath = folder ? `./${folder}` : '.';
  const examplePath = folder ? `${folder}/` : '';

  return `

## Embedded Images in Notes

**Proactive image reading**: When reading a note with embedded images, read them alongside text for full context. Images often contain critical information (diagrams, screenshots, charts).

**Local images** (\`![[image.jpg]]\`):
- Located in media folder: \`${mediaPath}\`
- Read with: \`Read file_path="${examplePath}image.jpg"\`
- Formats: PNG, JPG/JPEG, GIF, WebP

**External images** (\`![alt](url)\`):
- WebFetch does NOT support images
- Download to media folder -> Read -> Replace URL with wiki-link:

\`\`\`bash
# Download to media folder with descriptive name
mkdir -p ${mediaPath}
img_name="downloaded_\\$(date +%s).png"
curl -sfo "${examplePath}$img_name" 'URL'
\`\`\`

Then read with \`Read file_path="${examplePath}$img_name"\`, and replace the markdown link \`![alt](url)\` with \`![[${examplePath}$img_name]]\` in the note.

**Benefits**: Image becomes a permanent vault asset, works offline, and uses Obsidian's native embed syntax.`;
}

function getNetworkDiagramInstructions(): string {
  return `

## Live Network Diagrams

When troubleshooting networking — especially FortiGate/Fortinet, firewalls, VLANs, routing, VPNs, switches, WAN/LAN, DNS or DHCP — include a concise \`network-map\` fenced block once at least one real connection is known. ayontclaudian renders this block as a live visual topology while the answer streams.

Use one directed connection per line:

\`\`\`network-map
Internet / WAN -- public uplink --> FortiGate 60F
FortiGate 60F -- port2 / trunk --> Core Switch
Core Switch -- VLAN 10 --> Clients
Core Switch -- VLAN 20 --> Server
\`\`\`

Rules:
- Emit the block ONLY when the conversation is genuinely about a network topology — never for unrelated topics. There is no automatic fallback; the map exists exactly when you draw it.
- Build the map up progressively: in a multi-step diagnosis, repeat the SAME block later in the answer with the newest confirmed state (added nodes, updated statuses) — the renderer replaces it live. One canonical map per answer, refined as findings land.
- Keep the diagram under 12 nodes. Use the exact device names, interfaces, VLAN ids and subnets supplied by the user (e.g. \`port2 / VLAN 20 / 10.49.56.0/24\`).
- Never invent missing topology. Mark uncertain nodes or edge labels with \`?\` and confirmed problems with status words: \`up\`, \`warning\`, \`down\`, \`unreachable\` — the renderer color-codes them.
- Keep the prose diagnosis and commands outside the block. Users can export the rendered map as PNG into the vault and open it fullscreen from the map header.`;
}

function getLiveDocumentInstructions(): string {
  return `

## Live Document Builder

When the user asks to create, draft, design, rewrite, or structure a substantial document — such as a report, proposal, concept, brief, handbook, SOP, letter, meeting summary, project plan, policy, or client deliverable — use a \`claudian-document\` fenced block. ayontclaudian renders it as a polished live document canvas inside the chat while the answer streams.

\`\`\`claudian-document
---
title: Project proposal
subtitle: A concise optional subtitle
author: Optional author
date: 2026-07-10
type: Proposal
theme: editorial
---
# Project proposal

## Executive summary
Document content in clean Markdown...
\`\`\`

Themes: \`editorial\`, \`business\`, \`minimal\`, \`warm\`, \`technical\`.

Rules:
- Use this only when the user wants an actual document or designed deliverable, not for ordinary chat answers.
- Put the complete document inside one block; keep commentary outside it.
- Use clear headings, short paragraphs, lists, tables, blockquotes, and task lists where useful.
- Do not invent names, facts, dates, prices, or legal claims. Mark missing fields with \`[To be completed]\`.
- For nested code examples, wrap the outer document in four backticks so triple-backtick code remains intact.
- Keep the document editable as Markdown; do not output raw HTML inside the block.`;
}

function getEmailTemplateInstructions(): string {
  return `

## Live Email Templates

When the user asks to create, draft, rewrite, or provide an email or email template, use one or more adjacent \`claudian-email\` fenced blocks. ayontclaudian groups all adjacent blocks into ONE selectable plain-text email editor with variant tabs, editable recipient/subject/body fields, and copy/save controls. Use this for emails instead of the larger \`claudian-document\` canvas.

\`\`\`claudian-email
---
subject: Concise, specific subject line
to: "[Recipient]"
preheader: Optional one-line inbox preview
template: concise
---
Hello [Name],

Short, ready-to-send email body with clearly marked placeholders.

Best regards
[Sender]
\`\`\`

Available templates:
- \`concise\` — short and direct, the default for ordinary requests
- \`business\` — formal professional communication
- \`friendly\` — personal and approachable
- \`follow-up\` — reminders, check-ins, and next steps
- \`sales\` — benefit-led outreach with one clear call to action
- \`support\` — helpful service replies with concrete resolution steps

Rules:
- Trigger automatically for natural requests such as "write an email", "make an email template", or "reply to this customer"; no slash command is required.
- The email body must be plain text: do not use Markdown headings, bold, tables, blockquotes, or HTML. Simple hyphen lists are allowed when useful.
- Keep every version concise, usable in tickets or normal mail clients, and ready to copy. Include exactly one clear subject per block.
- Preserve the language requested by the user. Use placeholders like \`[Name]\`, \`[Date]\`, or \`[Order number]\` for missing details; never invent personal data.
- If no specific tone is requested, emit four adjacent blocks for \`concise\`, \`business\`, \`friendly\`, and \`support\`; the UI combines them into one selector window.
- If a specific tone is requested, emit only that matching block. If the user explicitly asks for all variants, emit all six template kinds.
- When emitting multiple versions, place the blocks directly next to each other with no headings or commentary between them; vary the wording and tone meaningfully.
- Keep any short commentary outside the full block group and do not output raw HTML.`;
}

function getInlineImageInstructions(): string {
  return `

## Inline Image Generation

When the user asks to generate or design an image and an image-generation tool or connected MCP is available, use it, save the resulting image into the vault, and finish with exactly one \`claudian-image\` block so ayontclaudian renders a visual image card:

\`\`\`claudian-image
---
title: Campaign visual
prompt: Exact prompt used to generate the image
path: attachments/campaign-visual.png
alt: Short accessible description
provider: Image generation
---
\`\`\`

Rules:
- Never claim an image was generated unless a real local path or returned image URL exists.
- Prefer a vault-relative local path; remote HTTPS URLs are allowed and the card offers a save action.
- Preserve the exact generation prompt in \`prompt\` for reproducibility.
- Emit the block only for an actual generated image, never for ordinary image analysis.`;
}

function getPacketTracerInstructions(): string {
  return `

## Cisco Packet Tracer Labs

When the user asks to create, inspect, repair, or explain a Cisco Packet Tracer lab, provide an exact, buildable lab plan. Include a \`network-map\` block, a device/port/cable inventory, an IP and VLAN table, per-device Cisco CLI blocks, and verification commands. For an attached decoded Packet Tracer XML file, use its real device names and topology; never claim that an arbitrary modern encrypted \`.pkt\` file was decoded unless readable XML context is present. Explain Packet Tracer steps for wireless access points, routers, switches, DHCP, DNS, ACLs, routing, and VLANs where relevant.`;
}

function getVideoAnalysisInstructions(): string {
  return `

## Video Analysis

When the user attaches a video file (an \`@path\` reference to \`.claudian/attachments/\` with a video extension like .mp4, .mov, .webm, .mkv), analyze it quickly and concretely:

1. If your model supports video input natively, read the file directly.
2. Otherwise use Bash with ffmpeg/ffprobe (check availability first):
   - \`ffprobe -v quiet -print_format json -show_format -show_streams <file>\` for duration, resolution, codecs.
   - Extract evenly spaced keyframes: \`ffmpeg -i <file> -vf "fps=1/<interval>" -frames:v 8 .claudian/staging/video-frames/frame-%02d.jpg\` (choose the interval from the duration; 6–10 frames total).
   - READ the extracted frames as images and describe what happens over time.
   - ALWAYS transcribe the audio track when the video has one — the narration usually explains WHY the video was recorded. Extract audio: \`ffmpeg -v error -i <file> -vn -ac 1 -ar 16000 /tmp/claudian-audio.wav -y\`, then try transcription tools in this order:
     1. \`whisper-cli -m ~/.cache/whisper-cpp/ggml-base.bin -l auto --no-timestamps /tmp/claudian-audio.wav\` (whisper-cpp)
     2. \`whisper /tmp/claudian-audio.wav --language de --model base\` (openai-whisper)
     3. \`mlx_whisper /tmp/claudian-audio.wav\`
     If none is installed, offer setup: \`brew install whisper-cpp\` and \`curl -sL -o ~/.cache/whisper-cpp/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin\` — then continue with the visual analysis either way. Clean up the wav afterwards.
3. Synthesize a timeline summary (German): what happens when, key scenes, on-screen text, notable details — and weave the transcript in so the video is explained COMPLETELY (Bild + Ton).
4. Make the analysis VISIBLE: copy the 2–3 most representative keyframes into the vault media folder (descriptive names like \`video-analyse-<thema>-0m32s.jpg\`) and embed them in your answer via \`![[path]]\` with their timestamps — the user should see what you saw.
5. Delete the remaining extracted frames afterwards (\`rm -rf .claudian/staging/video-frames\`).
6. If ffmpeg is not installed, say so clearly and suggest \`brew install ffmpeg\` instead of guessing.

Never invent video content you could not actually observe.`;
}

function getComputerControlInstructions(): string {
  return `

## Desktop Control (macOS & Windows)

When the user asks you to control their computer — move the mouse, click, open/close/switch apps, type, take screenshots, automate a desktop task — you can drive the OS through the shell. Detect the platform first (\`uname\` → Darwin = macOS, else Windows), then use the native automation layer.

### macOS (AppleScript / \`osascript\` — always available, no install)
- Open / activate an app: \`osascript -e 'tell application "Safari" to activate'\`
- Quit an app: \`osascript -e 'tell application "Notes" to quit'\`
- Click / move via System Events: \`osascript -e 'tell application "System Events" to click at {400, 300}'\`
- Keystrokes & hotkeys: \`osascript -e 'tell application "System Events" to keystroke "s" using {command down}'\`
- Screenshot to inspect the screen, THEN read it back as an image: \`screencapture -x /tmp/claudian-shot.png\`
- Faster/more precise mouse work when installed: \`cliclick\` (\`cliclick m:400,300 c:.\`) — suggest \`brew install cliclick\` if missing.

### Windows (PowerShell)
- Launch an app: \`powershell -c "Start-Process notepad"\`
- Activate / close windows and send keys via \`System.Windows.Forms\` (\`[System.Windows.Forms.SendKeys]::SendWait('^s')\`) or \`WScript.Shell\` \`AppActivate\`/\`SendKeys\`.
- Mouse via \`System.Windows.Forms.Cursor::Position\` + a small P/Invoke \`mouse_event\` call.
- Screenshot: \`Graphics.CopyFromScreen\` to a bitmap, save to disk, then read it back as an image.

Rules:
- ALWAYS take and READ a screenshot before and after a non-trivial action so you act on the real screen state, not an assumption. Work in a see → act → verify loop and narrate each step.
- Requires macOS Accessibility / Screen-Recording permission (System Settings → Privacy) for the controlling terminal; if a command is silently blocked, tell the user which permission to grant.
- Be careful and explicit with destructive actions (closing unsaved windows, deleting). Confirm intent for anything irreversible.
- Keep actions minimal and targeted; never invent UI coordinates — screenshot and locate first.`;
}

function getAutoMemoryInstructions(): string {
  return `

## Auto-Memory

When the user shares a DURABLE fact, preference, decision, or correction that will matter in future sessions — infrastructure details, project conventions, personal preferences, standing decisions — append exactly ONE fenced block at the very END of your answer:

\`\`\`claudian-memory
topic: Kurzer prägnanter Titel
tags: tag1, tag2
---
1–3 Sätze Inhalt auf Deutsch. Nur das dauerhaft Merkenswerte, keine Aufgaben-Details.
\`\`\`

ayontclaudian stores the block automatically in the memory system and renders it as a small chip.

Rules:
- Use this SPARINGLY. Most answers need no memory block at all.
- Only genuinely durable, session-transcending information — never ephemeral task state, never things already stored unchanged.
- Never store secrets, credentials, tokens, or keys.
- If the new information updates an existing memory, reuse the same topic so it overwrites cleanly.
- At most one block per answer.`;
}

function getSkillCreatorInstructions(): string {
  return `

## Skill Creator

When the user asks to create, build, design, or generate an Agent Skill (a reusable capability / "skill" that teaches an agent how to do something), author a COMPLETE, production-grade skill and emit it as ONE fenced block. ayontclaudian renders it as a skill card and can save it to \`.claude/skills/<name>/SKILL.md\`, where every provider auto-discovers it.

\`\`\`claudian-skill
---
name: pdf-form-filler
description: Fill, flatten, and validate PDF forms. Use when the user needs to complete AcroForm/XFA fields, merge field data from CSV/JSON, or verify that required fields are set. Triggers on "fill this PDF", "PDF form", "flatten PDF".
---
# PDF Form Filler

## Overview
One or two sentences on what this skill does and the outcome it guarantees.

## When to use
- Concrete trigger 1
- Concrete trigger 2

## Workflow
1. Imperative, numbered steps the agent follows.
2. Reference bundled resources with relative paths when helpful (e.g. scripts/fill.py).

## Examples
Input → expected action → output.

## Guardrails
- What to never do; how to fail safely.
\`\`\`

What makes a skill EXCELLENT (follow all of these):
- **name**: kebab-case, ≤ 64 chars, matches the folder. **description**: ≤ 1024 chars, third person, and PACKED with concrete trigger phrases + "Use when …" — this single line is what makes the skill fire automatically, so make it specific, not generic.
- **Progressive disclosure**: keep SKILL.md tight and scannable. Push long references, schemas, or examples into bundled files the body points to (e.g. \`references/api.md\`, \`scripts/run.sh\`) instead of inlining everything.
- **Imperative voice**, numbered workflows, real input→output examples, and an explicit guardrails/failure section. No filler, no marketing.
- Prefer deterministic scripts/commands over vague prose when a step can be scripted.
- If the request is vague, make reasonable, explicit assumptions and mark open points with \`[To be completed]\` — still deliver a fully usable skill.
- Emit exactly ONE \`claudian-skill\` block per skill. Put any extra explanation OUTSIDE the block.`;
}

function getAppendixSections(appendices?: string[]): string {
  if (!appendices || appendices.length === 0) {
    return '';
  }

  const sections = appendices
    .map((appendix) => appendix.trim())
    .filter(Boolean);

  if (sections.length === 0) {
    return '';
  }

  return `\n\n${sections.join('\n\n')}`;
}

export interface TurnOutputContractOptions {
  /** Full reference manuals are reserved for diagnostics; chat uses compact contracts. */
  detailedSurfaceInstructions?: boolean;
  mediaFolder?: string;
  workspaceMode?: WorkspaceMode;
}

function getCompactWorkspaceInstructions(mode: WorkspaceMode): string {
  return mode === 'work'
    ? '## Active Workspace Mode: WORK (ChatGPT Work · Legal & Document Intelligence)\nLead with clear vault-ready knowledge work, document versioning headers, DSGVO/GDPR & EU AI Act compliance checks. Code requests still remain normal chat.'
    : '## Active Workspace Mode: CODE (Codex Dev Studio · Multi-Agent Swarm)\nLead with concrete engineering action, multi-agent orchestration, precise edits and test verification. Artifact requests still remain available.';
}

function getCompactAutoMemoryInstructions(): string {
  return 'Memory: only for a new durable cross-session fact, append at most one final `claudian-memory` fence (topic, tags, then 1-3 German sentences). Never store secrets or ephemeral task state; most answers need none.';
}

function getCompactNetworkInstructions(): string {
  return [
    '## Network-map surface',
    'Include one canonical `network-map` fence once at least one real connection is known:',
    '```network-map',
    'Internet -- WAN --> FortiGate 60F',
    'FortiGate 60F -- port2 / trunk --> Core Switch',
    'Core Switch -- VLAN 20 --> Server',
    '```',
    'Keep prose and commands outside. Use exact confirmed device/interface/VLAN/subnet names, at most 12 nodes; never invent topology. Mark uncertainty with `?` and state with `up`, `warning`, `down`, or `unreachable`. If findings change, emit an updated complete map; the UI keeps only the newest frame.',
  ].join('\n');
}

function getCompactLiveDocumentInstructions(): string {
  return [
    '## Live-document surface',
    'Put the complete deliverable in one editable Markdown fence; commentary stays outside:',
    '```claudian-document',
    '---',
    'title: Project proposal',
    'subtitle: Optional subtitle',
    'author: Optional author',
    'date: 2026-07-10',
    'type: Proposal',
    'theme: editorial',
    '---',
    '# Project proposal',
    '## Executive summary',
    'Document content...',
    '```',
    'Themes: `editorial`, `business`, `minimal`, `warm`, `technical`. Use clear structure. Never invent facts, names, dates, prices or legal claims; write `[To be completed]` for missing facts. No raw HTML. Use four backticks for the outer fence when the body contains triple-backtick code.',
  ].join('\n');
}

function getCompactEmailInstructions(): string {
  return [
    '## Email surface',
    'Return ready-to-send plain text in one or more adjacent blocks:',
    '```claudian-email',
    '---',
    'subject: Concise subject',
    'to: "[Recipient]"',
    'preheader: Optional preview',
    'template: concise',
    '---',
    'Hello [Name],',
    '',
    'Email body.',
    '',
    'Best regards',
    '[Sender]',
    '```',
    'Templates: `concise`, `business`, `friendly`, `follow-up`, `sales`, `support`. Preserve language and tone; never invent personal data, and mark gaps as `[Placeholders]`. No Markdown headings, bold, tables or HTML in the body. Without a requested tone, emit adjacent concise, business, friendly and support variants; otherwise only the requested variant.',
  ].join('\n');
}

function getCompactImageInstructions(): string {
  return [
    '## Image surface',
    'Use a real image-generation tool, then emit exactly one result card:',
    '```claudian-image',
    '---',
    'title: Campaign visual',
    'prompt: Exact generation prompt',
    'path: attachments/campaign-visual.png',
    'alt: Accessible description',
    'provider: Image generation',
    '---',
    '```',
    'Never claim success without a real local path or returned HTTPS URL. Prefer a vault-relative path and preserve the exact prompt. Do not emit this block for ordinary image analysis.',
  ].join('\n');
}

function getCompactSkillInstructions(): string {
  return [
    '## Skill surface',
    'Emit one complete skill and keep explanation outside:',
    '```claudian-skill',
    '---',
    'name: pdf-form-filler',
    'description: Fill and validate PDF forms. Use when the user asks to fill, flatten, merge, or verify a PDF form.',
    '---',
    '# PDF Form Filler',
    '## Overview',
    'Outcome and scope.',
    '## When to use',
    '- Concrete triggers.',
    '## Workflow',
    '1. Imperative, deterministic steps.',
    '## Examples',
    'Input -> action -> output.',
    '## Guardrails',
    '- Safe failures and prohibitions.',
    '```',
    '`name` is kebab-case (max 64). `description` is trigger-rich, third person, contains "Use when", and stays below 1024 chars. Use progressive disclosure for long references/scripts, explicit assumptions and `[To be completed]` for missing facts.',
  ].join('\n');
}

function getCompactPacketTracerInstructions(): string {
  return 'Packet Tracer: add a buildable device/port/cable inventory, IP/VLAN table, per-device Cisco CLI and verification commands. Use real decoded XML names when present; never claim an encrypted `.pkt` was decoded without readable XML.';
}

const CREATION_WORD_PATTERNS = [
  /^creat(?:e|es|ed|ing)$/,
  /^generat(?:e|es|ed|ing)$/,
  /^draft(?:s|ed|ing)?$/,
  /^writ(?:e|es|ing|ten)$/,
  /^compos(?:e|es|ed|ing)$/,
  /^rewrit(?:e|es|ing|ten)$/,
  /^erstell(?:e|en|st|t)?$/,
  /^entw(?:irf|erfe|erfen)$/,
  /^schreib(?:e|en|st|t)?$/,
  /^formulier(?:e|en|st|t)?$/,
  /^verfass(?:e|en|st|t)?$/,
  /^überarbeit(?:e|en|est|et)?$/,
  /^umschreib(?:e|en|st|t)?$/,
  /^generier(?:e|en|st|t)?$/,
  /^erzeug(?:e|en|st|t)?$/,
];

/* "mach / make" only counts as creation when the object is the artifact itself
   ("Mach mir ein Angebot"). Bare "mach weiter", "make it work", "make sure"
   are continuation verbs and must never open a document. */
const WEAK_CREATION_WORD_PATTERNS = [/^mak(?:e|es|ing)$/, /^made$/, /^mach(?:e|en|st|t)?$/];
const WEAK_CREATION_OBJECT = /\b(?:mach\p{L}*|mak\p{L}*|made)\s+(?:mir|uns|bitte|mal|doch|me|us|please)?\s*(?:mir|uns|bitte|mal|doch|me|us|please)?\s*(?:ein|eine|einen|a|an|the|das|die|den)\b/iu;

const ENGINEERING_WORDS = new Set([
  'api', 'branch', 'bug', 'bugs', 'build', 'ci', 'class', 'code', 'commit',
  'component', 'css', 'endpoint', 'endpoints', 'fix', 'function', 'hook',
  'implementation', 'implementierung', 'javascript', 'klasse', 'komponente',
  'merge', 'parser', 'pr', 'react', 'refactor', 'renderer', 'repo', 'sourcecode',
  'stylesheet', 'terminal', 'test', 'tests', 'typescript', 'funktion',
  'quellcode', 'änderungen', 'changes', 'datei', 'file', 'formular', 'signup',
  'upload', 'validierung', 'validation', 'flow', 'screenshot',
]);

/* Nouns that name a standalone deliverable. Matched as WHOLE words: "E-Mail"
   in "E-Mail-Validierung" tokenizes to ["e", "mail", "validierung"], so the
   compound never matches an artifact noun, while "eine E-Mail an" still does
   through the phrase check below. */
const STRONG_DOCUMENT_WORDS = new Set([
  'angebot', 'bericht', 'briefing', 'handbuch', 'konzept', 'policy',
  'projektplan', 'proposal', 'report', 'richtlinie', 'sop',
]);
const DOCUMENT_WORDS = new Set([
  ...STRONG_DOCUMENT_WORDS,
  'dokument', 'document', 'brief', 'letter', 'protokoll', 'memo', 'whitepaper',
]);
const EMAIL_WORDS = new Set(['email', 'mail', 'mailvorlage', 'anschreiben']);
const IMAGE_WORDS = new Set([
  'bild', 'image', 'grafik', 'illustration', 'kampagnenmotiv', 'motiv', 'poster',
  'banner', 'hero', 'keyvisual',
]);

function includesAny(source: string, terms: readonly string[]): boolean {
  return terms.some((term) => source.includes(term));
}

function includesBoundedIntentTerm(source: string, term: string): boolean {
  const escaped = term.trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escaped}(?:s|es|e|en)?(?=$|[^\\p{L}\\p{N}_]|\\d)`,
    'iu',
  ).test(source);
}

function tokenizeIntent(source: string): string[] {
  return source.match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/* German closes compounds without a hyphen: "Projektbericht", "Preisangebot",
   "Sicherheitskonzept". Accept a strong document noun as the head of a whole
   token; hyphenated feature names ("Bericht-Renderer") never reach here because
   the token split at the hyphen leaves "bericht" bare and "renderer" as
   engineering context. */
function hasStrongDocumentNoun(words: readonly string[]): boolean {
  return words.some((word) =>
    STRONG_DOCUMENT_WORDS.has(word)
    || /^\p{L}{3,}(?:bericht|angebot|konzept|handbuch|richtlinie|projektplan)(?:e|s|es|en)?$/u.test(word));
}

/* An artifact noun only counts when it stands alone. "E-Mail-Validierung",
   "Image-Upload", "Logo-Component", "Dokument-System" are feature names: the
   noun is glued to another word with a hyphen, so it describes code. */
function hasStandaloneNoun(source: string, vocabulary: ReadonlySet<string>): boolean {
  for (const noun of vocabulary) {
    // "e-mail" is one noun; any other hyphen glued to the noun marks a compound.
    const re = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:e-)?${noun}(?:s|es|e|en|n)?(?![\\p{L}\\p{N}_-])`, 'iu');
    if (re.test(source)) return true;
  }
  return false;
}

/* German builds image nouns as closed compounds ("Kampagnenbild", "Titelbild",
   "Heldenbild"). Match "…bild" as a whole word, but not "Bildschirm…" and not
   hyphenated feature names ("Image-Upload"). */
function hasImageNoun(source: string, words: readonly string[]): boolean {
  if (hasStandaloneNoun(source, IMAGE_WORDS)) return true;
  return words.some((word) => /^\p{L}{3,}bild(?:er|es|s)?$/u.test(word) && !/^bildschirm/u.test(word));
}

function hasCreationIntent(source: string, words: readonly string[]): boolean {
  const informationalLead = /^(?:wie|how)\b|^(?:(?:kann|könnte|soll)\s+ich|can\s+i|should\s+i)\b/i;
  const explanatoryHowTo = /\b(?:erklär\p{L}*|beschreib\p{L}*|explain\p{L}*|describe\p{L}*)\b[^.!?]*\b(?:wie|how)\b/iu;
  if (informationalLead.test(source.trim()) || explanatoryHowTo.test(source)) {
    return false;
  }
  if (words.some((word) => CREATION_WORD_PATTERNS.some((pattern) => pattern.test(word)))) {
    return true;
  }
  return words.some((word) => WEAK_CREATION_WORD_PATTERNS.some((pattern) => pattern.test(word)))
    && WEAK_CREATION_OBJECT.test(source);
}

function hasEngineeringContext(words: readonly string[]): boolean {
  return words.some((word) => ENGINEERING_WORDS.has(word));
}

function isRawProviderCommand(text: string): boolean {
  return /^\s*\/[a-z][\w-]*(?:\s|$)/i.test(text);
}

export interface ResolveOutputSurfaceOptions {
  /** Active workspace mode. In `code`, surfaces are never inferred from prose. */
  workspaceMode?: WorkspaceMode;
}

/**
 * Picks the output surface for a turn.
 *
 * Rules, in order: an explicit surface (a `/document`, `/email`, … command) always
 * wins. In CODE mode nothing else is inferred: an engineer typing "Erstelle die
 * E-Mail-Validierung" must get chat, full stop. In WORK mode a surface is only
 * inferred when the prompt has creation intent AND names the deliverable as a
 * standalone noun (not a hyphenated feature compound) AND carries no engineering
 * vocabulary. Everything else stays `chat`.
 */
export function resolveTurnOutputSurface(
  text: string,
  requestedSurface?: OutputSurface,
  options: ResolveOutputSurfaceOptions = {},
): OutputSurface {
  if (requestedSurface && requestedSurface !== 'chat') return requestedSurface;
  if ((options.workspaceMode ?? DEFAULT_WORKSPACE_MODE) === 'code') return 'chat';

  const source = text.toLocaleLowerCase('de-DE');
  const words = tokenizeIntent(source);
  const create = hasCreationIntent(source, words);

  if (create && includesAny(source, ['agent skill', 'agent-skill', 'skill.md', 'skill für', 'skill for'])) {
    return 'skill';
  }

  // Explicit deliverable nouns remain authoritative even when their subject is
  // code ("Schreib ein Handbuch für den Renderer", "Erstelle einen Bericht über
  // den Build"). Generic nouns such as "Dokumentation" or "Zusammenfassung" are
  // deliberately NOT in this set: in an engineering chat they describe an
  // answer, not a Word document.
  if (create && hasStrongDocumentNoun(words)) return 'live-document';

  // Code/renderer/parser requests are implementation work even when they also
  // contain words such as image, document or firewall.
  if (hasEngineeringContext(words)) return 'chat';

  const emailNoun = hasStandaloneNoun(source, EMAIL_WORDS);
  const replyAction = words.some((word) =>
    /^(?:antwort(?:e|en|est|et)|repl(?:y|ies|ied|ying))$/.test(word));
  const replyRecipient = includesAny(source, ['kunde', 'customer', 'empfänger', 'recipient']);
  const customerReplyDraft = create && replyRecipient && includesAny(source, ['antwort', 'reply']);
  if ((emailNoun && create) || (replyRecipient && replyAction) || customerReplyDraft) {
    return 'email';
  }

  if (create && hasImageNoun(source, words)) return 'image';

  if (create && hasStandaloneNoun(source, DOCUMENT_WORDS)) return 'live-document';

  const highConfidenceNetworkTerms = [
    'fortigate', 'fortinet', 'opnsense', 'pfsense', 'packet tracer', 'vlan',
    'subnet', 'ipsec', 'firewall', 'topologie', 'topology',
  ];
  const genericNetworkTerms = [
    'router', 'routing', 'switch', 'gateway', 'wan', ' lan ', 'vpn', 'dhcp',
    'dns', 'netzwerk', 'network', 'uplink', 'trunk',
  ];
  const explicitTopologyTerms = [
    'topologie', 'topology', 'netzplan', 'netzwerkplan', 'network map',
    'netzwerkdiagramm', 'network diagram',
  ];
  const operationalNetworkPatterns = [
    /^analysier/, /^diagnos/, /^prüf/, /^test/, /^troubleshoot/,
    /^konfigurier/, /^richt(?:e|en|est|et)$/, /^verbind/,
    /^fehler/, /^problem/, /^störung/, /^ausfall/,
    /^port\d*$/, /^interface$/, /^trunk$/, /^uplink$/,
  ];
  const topologyActionPatterns = [/^zeichn/, /^visualisier/, /^zeig/];
  const highConfidenceMatches = highConfidenceNetworkTerms
    .filter((term) => includesBoundedIntentTerm(source, term)).length;
  const genericMatches = genericNetworkTerms
    .filter((term) => includesBoundedIntentTerm(source, term)).length;
  const networkEntityCount = highConfidenceMatches + genericMatches;
  const operationalNetworkIntent = words.some((word) =>
    operationalNetworkPatterns.some((pattern) => pattern.test(word)))
    || includesAny(source, ['geht nicht', 'funktioniert nicht', 'nicht erreichbar'])
    || (
      words.includes('nicht')
      && words.some((word) => /^(?:funktionier|geh|erreich)/.test(word))
    );
  const explicitTopologyRequest = includesAny(source, explicitTopologyTerms)
    && (create || words.some((word) => topologyActionPatterns.some((pattern) => pattern.test(word))));
  const containsTopologyData = /(?:-->|--|\bvlan\s*\d+|\bport\d+|\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b)/i.test(source);
  if (
    explicitTopologyRequest
    || (networkEntityCount >= 2 && (operationalNetworkIntent || containsTopologyData))
  ) {
    return 'network-map';
  }

  return 'chat';
}

function hasVideoReference(text: string): boolean {
  return /(?:^|[\s@/])[^\s]+\.(?:mp4|mov|webm|mkv|m4v)(?:\s|$)/i.test(text);
}

function hasImageReference(request: ChatTurnRequest): boolean {
  return (request.images?.length ?? 0) > 0
    || /(?:^|[\s@/])[^\s]+\.(?:png|jpe?g|gif|webp)(?:\s|$)/i.test(request.text);
}

function asksForDesktopControl(text: string): boolean {
  const source = text.toLocaleLowerCase('de-DE');
  const action = includesAny(source, [
    'klick', 'öffne', 'schließe', 'tippe', 'steuere', 'maus', 'screenshot',
    'click', 'open the app', 'close the app', 'type ', 'control my computer',
  ]);
  return action && includesAny(source, [
    'computer', 'desktop', 'bildschirm', 'fenster', 'app', 'browser', 'mouse', 'screen',
  ]);
}

/** Builds the application-owned, turn-scoped presentation contract. */
export function buildTurnOutputContract(
  request: ChatTurnRequest,
  options: TurnOutputContractOptions = {},
): string {
  const surface = resolveTurnOutputSurface(request.text, request.outputSurface);
  const workspaceMode = options.workspaceMode ?? DEFAULT_WORKSPACE_MODE;
  const detailed = options.detailedSurfaceInstructions === true;
  const sections = [
    detailed ? getWorkspaceModeInstructions(workspaceMode) : getCompactWorkspaceInstructions(workspaceMode),
  ];
  if (detailed) sections.push(getAutoMemoryInstructions());

  if (hasImageReference(request)) sections.push(getImageInstructions(options.mediaFolder || ''));
  if (hasVideoReference(request.text)) sections.push(getVideoAnalysisInstructions());
  if (asksForDesktopControl(request.text)) sections.push(getComputerControlInstructions());

  switch (surface) {
    case 'live-document':
      sections.push(detailed ? getLiveDocumentInstructions() : getCompactLiveDocumentInstructions());
      break;
    case 'email':
      sections.push(detailed ? getEmailTemplateInstructions() : getCompactEmailInstructions());
      break;
    case 'network-map':
      sections.push(detailed ? getNetworkDiagramInstructions() : getCompactNetworkInstructions());
      if (/packet tracer|\.pkt\b/i.test(request.text)) {
        sections.push(detailed ? getPacketTracerInstructions() : getCompactPacketTracerInstructions());
      }
      break;
    case 'image':
      sections.push(detailed ? getInlineImageInstructions() : getCompactImageInstructions());
      break;
    case 'skill':
      sections.push(detailed ? getSkillCreatorInstructions() : getCompactSkillInstructions());
      break;
    case 'chat':
      break;
  }

  const body = sections.map((section) => section.trim()).filter(Boolean).join('\n\n');
  return [
    `<claudian_output_contract surface="${surface}">`,
    'Application guidance for this turn. Do not quote or mention this block.',
    body,
    '</claudian_output_contract>',
  ].join('\n');
}

/** Adds a provider-neutral output contract without changing raw CLI slash commands. */
export function applyTurnOutputContract(
  request: ChatTurnRequest,
  options: TurnOutputContractOptions = {},
): ChatTurnRequest {
  if (isRawProviderCommand(request.text)) return request;

  const outputSurface = resolveTurnOutputSurface(request.text, request.outputSurface, {
    workspaceMode: options.workspaceMode,
  });
  const contract = buildTurnOutputContract({ ...request, outputSurface }, options);
  return {
    ...request,
    outputSurface,
    text: `${request.text}\n\n${contract}`,
  };
}

export function buildSystemPrompt(
  settings: SystemPromptSettings = {},
  options: SystemPromptBuildOptions = {},
): string {
  let prompt = getBaseSystemPrompt(settings.vaultPath, settings.userName);
  prompt += `\n\n${getCompactAutoMemoryInstructions()}`;
  prompt += getAppendixSections(options.appendices);

  if (settings.customPrompt?.trim()) {
    prompt += `\n\n## Custom Instructions\n\n${settings.customPrompt.trim()}`;
  }

  return prompt;
}

export function computeSystemPromptKey(
  settings: SystemPromptSettings,
  options: SystemPromptBuildOptions = {},
): string {
  const appendixKey = (options.appendices || [])
    .map((appendix) => appendix.trim())
    .filter(Boolean)
    .join('||');

  const parts = [
    SYSTEM_PROMPT_VERSION,
    settings.customPrompt || '',
    settings.vaultPath || '',
    (settings.userName || '').trim(),
  ];

  if (appendixKey) {
    parts.push(appendixKey);
  }

  return parts.join('::');
}
