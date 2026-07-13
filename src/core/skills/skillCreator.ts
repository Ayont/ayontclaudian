import type { Vault } from 'obsidian';

/**
 * Skill Creator: the model authors a complete Agent Skill by emitting a
 * ```claudian-skill fenced block whose body is a valid SKILL.md (YAML
 * frontmatter with `name` + `description`, then a Markdown body). The plugin
 * renders it as a polished skill card and can persist it to `.claude/skills/`,
 * where every CLI provider discovers skills.
 *
 * The format follows Anthropic's public Agent Skills spec — no proprietary or
 * leaked source is used or required.
 */

export interface SkillDefinition {
  /** kebab-case identifier, also the folder name. */
  name: string;
  /** The `description` frontmatter — the trigger text agents match against. */
  description: string;
  /** Canonical SKILL.md content (normalized frontmatter + body) for disk. */
  fileContent: string;
  /** Markdown body after the frontmatter, for the card preview. */
  bodyPreview: string;
  /** Optional short license/allowed-tools hints surfaced on the card. */
  allowedTools?: string;
}

export interface SkillBlock {
  content: string;
  closed: boolean;
  skill: SkillDefinition | null;
}

const SKILLS_FOLDER = '.claude/skills';
/** Anthropic caps: name ≤ 64 chars, description ≤ 1024 chars. */
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
}

/** Converts a free-form name into a safe kebab-case skill/folder id. */
export function slugifySkillName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME)
    .replace(/-+$/g, '') || 'unnamed-skill';
}

interface ParsedFrontmatter {
  fields: Record<string, string>;
  body: string;
  hadFrontmatter: boolean;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized.startsWith('---\n')) {
    return { fields: {}, body: normalized, hadFrontmatter: false };
  }
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) {
    return { fields: {}, body: normalized, hadFrontmatter: false };
  }

  const fields: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) fields[key] = value;
  }
  return { fields, body: normalized.slice(end + 4).trim(), hadFrontmatter: true };
}

/** Builds a canonical SKILL.md string with a clean, ordered frontmatter. */
function buildFileContent(
  name: string,
  description: string,
  extraFields: Record<string, string>,
  body: string,
): string {
  const lines = ['---', `name: ${name}`, `description: ${description}`];
  for (const [key, value] of Object.entries(extraFields)) {
    if (key === 'name' || key === 'description' || !value) continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('---', '', body.trim(), '');
  return lines.join('\n');
}

export function parseSkillDefinition(content: string): SkillDefinition | null {
  const { fields, body } = parseFrontmatter(content);

  // The description carries the auto-trigger; a body without it is unusable.
  const rawName = fields.name?.trim();
  const description = (fields.description ?? '').trim().slice(0, MAX_DESCRIPTION);
  if (!description || !body.trim()) return null;

  // Derive a name from the first heading when the frontmatter omitted it.
  const headingName = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const name = slugifySkillName(rawName || headingName || '');
  if (!name || name === 'unnamed-skill') {
    if (!rawName && !headingName) return null;
  }

  const extraFields: Record<string, string> = {};
  for (const key of ['license', 'allowed-tools', 'metadata', 'version']) {
    if (fields[key]) extraFields[key] = fields[key];
  }

  return {
    name,
    description,
    fileContent: buildFileContent(name, description, extraFields, body),
    bodyPreview: body.trim(),
    allowedTools: fields['allowed-tools'],
  };
}

/** Parses every claudian-skill fence, including an unfinished streaming block. */
export function parseSkillBlocks(markdown: string): SkillBlock[] {
  const blocks: SkillBlock[] = [];
  const opening = /(`{3,})claudian-skill\s*\n/gi;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(markdown)) !== null) {
    const fence = match[1];
    const start = opening.lastIndex;
    const end = markdown.indexOf(fence, start);
    const closed = end >= 0;
    const content = markdown.slice(start, closed ? end : markdown.length).trim();
    blocks.push({ content, closed, skill: parseSkillDefinition(content) });
    if (!closed) break;
    opening.lastIndex = end + fence.length;
  }
  return blocks;
}

/**
 * Writes a skill to `.claude/skills/<name>/SKILL.md`. Uses the low-level
 * adapter because `.claude` is a hidden dot-folder the vault index never
 * surfaces. Returns the vault-relative path of the written SKILL.md.
 */
export async function persistSkill(vault: Vault, skill: SkillDefinition): Promise<string> {
  const folder = normalizePath(`${SKILLS_FOLDER}/${skill.name}`);
  await vault.adapter.mkdir(folder).catch(() => {
    // Folder may already exist.
  });
  const path = normalizePath(`${folder}/SKILL.md`);
  await vault.adapter.write(path, skill.fileContent);
  return path;
}
