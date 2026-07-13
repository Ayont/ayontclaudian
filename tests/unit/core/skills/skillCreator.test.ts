import type { Vault } from 'obsidian';

import {
  parseSkillBlocks,
  parseSkillDefinition,
  persistSkill,
  slugifySkillName,
} from '../../../../src/core/skills/skillCreator';

function createAdapterVault(): Vault & { __files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    __files: files,
    getAbstractFileByPath: () => null,
    adapter: {
      mkdir: async () => {},
      write: async (path: string, content: string) => {
        files.set(path, content);
      },
      exists: async (path: string) => files.has(path),
      read: async (path: string) => files.get(path) ?? '',
    },
  } as unknown as Vault & { __files: Map<string, string> };
}

const FULL_SKILL = [
  'Hier ist dein Skill:',
  '',
  '```claudian-skill',
  '---',
  'name: PDF Form Filler',
  'description: Fill and flatten PDF forms. Use when the user says "fill this PDF".',
  'allowed-tools: Bash, Read, Write',
  '---',
  '# PDF Form Filler',
  '',
  '## Overview',
  'Fills AcroForm fields.',
  '```',
].join('\n');

describe('slugifySkillName', () => {
  it('produces a kebab-case id', () => {
    expect(slugifySkillName('PDF Form Filler!')).toBe('pdf-form-filler');
    expect(slugifySkillName('  Weird   Name  ')).toBe('weird-name');
  });

  it('falls back for empty input', () => {
    expect(slugifySkillName('!!!')).toBe('unnamed-skill');
  });
});

describe('parseSkillDefinition', () => {
  it('parses name, description, tools, and normalizes the file content', () => {
    const skill = parseSkillDefinition(
      '---\nname: PDF Form Filler\ndescription: Fill PDFs. Use when...\nallowed-tools: Bash\n---\n# PDF Form Filler\n\nBody.',
    );

    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('pdf-form-filler');
    expect(skill!.description).toBe('Fill PDFs. Use when...');
    expect(skill!.allowedTools).toBe('Bash');
    expect(skill!.fileContent).toContain('name: pdf-form-filler');
    expect(skill!.fileContent).toContain('allowed-tools: Bash');
    expect(skill!.bodyPreview.startsWith('# PDF Form Filler')).toBe(true);
  });

  it('derives the name from the first heading when frontmatter omits it', () => {
    const skill = parseSkillDefinition(
      '---\ndescription: Do a thing. Use when needed.\n---\n# Cool Helper\n\nBody.',
    );
    expect(skill!.name).toBe('cool-helper');
  });

  it('returns null without a description (the auto-trigger is mandatory)', () => {
    expect(parseSkillDefinition('---\nname: x\n---\n# X\n\nBody.')).toBeNull();
  });

  it('returns null without a body', () => {
    expect(parseSkillDefinition('---\nname: x\ndescription: Use when...\n---\n')).toBeNull();
  });
});

describe('parseSkillBlocks', () => {
  it('parses a complete claudian-skill fence', () => {
    const blocks = parseSkillBlocks(FULL_SKILL);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].closed).toBe(true);
    expect(blocks[0].skill?.name).toBe('pdf-form-filler');
  });

  it('marks a still-streaming fence as not closed', () => {
    const blocks = parseSkillBlocks('```claudian-skill\n---\nname: x\ndescription: Use when...\n---\n# X\nBody');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].closed).toBe(false);
  });

  it('ignores other fenced languages', () => {
    expect(parseSkillBlocks('```json\n{}\n```')).toEqual([]);
  });
});

describe('persistSkill', () => {
  it('writes SKILL.md into .claude/skills/<name>/', async () => {
    const vault = createAdapterVault();
    const skill = parseSkillDefinition(
      '---\nname: My Skill\ndescription: Use when testing.\n---\n# My Skill\n\nBody.',
    )!;

    const path = await persistSkill(vault, skill);

    expect(path).toBe('.claude/skills/my-skill/SKILL.md');
    expect(vault.__files.get(path)).toContain('name: my-skill');
    expect(vault.__files.get(path)).toContain('description: Use when testing.');
  });
});
