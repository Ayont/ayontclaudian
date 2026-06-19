import type { App, TFile } from 'obsidian';

/**
 * A reusable prompt template loaded from a Markdown note in the vault.
 * Templates support variable substitution: {{selection}}, {{note}}, {{date}},
 * {{title}}, {{tags}}.
 */
export interface PromptTemplate {
  name: string;
  description: string;
  /** Raw template text with {{variable}} placeholders. */
  body: string;
  /** Source file path (relative to vault root). */
  filePath: string;
}

export const TEMPLATE_VARIABLE_PATTERNS: Record<string, (ctx: TemplateContext) => string> = {
  selection: (ctx) => ctx.selection ?? '',
  note: (ctx) => ctx.noteContent ?? '',
  date: () => new Date().toISOString().slice(0, 10),
  title: (ctx) => ctx.noteTitle ?? '',
  tags: (ctx) => ctx.noteTags?.join(', ') ?? '',
};

export interface TemplateContext {
  selection?: string;
  noteContent?: string;
  noteTitle?: string;
  noteTags?: string[];
}

/** Default folder where templates live. Users can override via settings. */
export const DEFAULT_TEMPLATE_FOLDER = 'Templates/Prompt Templates';

/** Built-in templates that ship with the plugin (no file needed). */
export const BUILT_IN_TEMPLATES: PromptTemplate[] = [
  {
    name: 'code-review',
    description: 'Review code for bugs, security, and best practices',
    body:
      'Review the following code for bugs, security issues, performance problems, and maintainability.\n' +
      'Suggest concrete fixes and prioritize them by severity.\n\n' +
      '```\n{{selection}}\n```',
    filePath: '',
  },
  {
    name: 'note-summary',
    description: 'Summarize the current note concisely',
    body:
      'Summarize the following note in 3-5 bullet points. Capture the key insights and action items.\n\n' +
      '{{note}}',
    filePath: '',
  },
  {
    name: 'daily-review',
    description: 'Review your daily notes and extract action items',
    body:
      'Review my daily note from {{date}} and extract:\n' +
      '1. Key accomplishments\n2. Open tasks\n3. Decisions made\n4. Items to follow up on tomorrow\n\n' +
      '{{note}}',
    filePath: '',
  },
  {
    name: 'bug-analysis',
    description: 'Analyze a bug report and propose a fix',
    body:
      'Analyze the following bug report and propose a fix:\n' +
      '1. Identify the root cause\n2. Propose the smallest fix that resolves it\n3. List potential side effects\n\n' +
      '{{selection}}',
    filePath: '',
  },
  {
    name: 'refactor',
    description: 'Suggest refactoring improvements',
    body:
      'Suggest refactoring improvements for the following code. Focus on readability, ' +
      'maintainability, and design patterns. Preserve behavior.\n\n' +
      '```\n{{selection}}\n```',
    filePath: '',
  },
];

/**
 * Substitutes {{variable}} placeholders in a template body with values from
 * the provided context. Unknown variables are left as-is. Pure function.
 */
export function substituteTemplateVariables(template: string, ctx: TemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, varName: string) => {
    const resolver = TEMPLATE_VARIABLE_PATTERNS[varName];
    return resolver ? resolver(ctx) : match;
  });
}

/** Loads prompt templates from both built-in definitions and the vault folder. */
export class PromptTemplateService {
  constructor(private readonly app: App, private readonly folder: string = DEFAULT_TEMPLATE_FOLDER) {}

  async listTemplates(): Promise<PromptTemplate[]> {
    const vaultTemplates = await this.loadVaultTemplates();
    return [...BUILT_IN_TEMPLATES, ...vaultTemplates];
  }

  getTemplate(name: string, templates: PromptTemplate[]): PromptTemplate | undefined {
    return templates.find((t) => t.name === name);
  }

  /**
   * Expands a template by name: looks it up, substitutes variables, and returns
   * the final prompt text ready to send to the chat.
   */
  expand(template: PromptTemplate, ctx: TemplateContext): string {
    return substituteTemplateVariables(template.body, ctx);
  }

  private async loadVaultTemplates(): Promise<PromptTemplate[]> {
    const folder = this.app.vault.getAbstractFileByPath(this.folder);
    if (!folder || !('children' in folder)) return [];

    const templates: PromptTemplate[] = [];
    for (const child of folder.children) {
      if ('extension' in child && child.extension === 'md') {
        try {
          const content = await this.app.vault.read(child);
          const { name, description, body } = this.parseTemplateFile(content, child.basename);
          templates.push({ name, description, body, filePath: child.path });
        } catch {
          // Skip unreadable files
        }
      }
    }
    return templates;
  }

  /**
   * Parses a Markdown template file. The first H1 or frontmatter `name` is the
   * template name. A `> description` blockquote or frontmatter `description`
   * provides the description. The rest is the template body.
   */
  private parseTemplateFile(content: string, fallbackName: string): { name: string; description: string; body: string } {
    let name = fallbackName;
    let description = '';
    let body = content;

    // Check for frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (fmMatch) {
      const frontmatter = fmMatch[1];
      body = fmMatch[2];
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim();
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch) description = descMatch[1].trim();
    }

    // Try H1 for name if not in frontmatter
    if (!fmMatch) {
      const h1Match = content.match(/^#\s+(.+)$/m);
      if (h1Match) {
        name = h1Match[1].trim();
        body = content.replace(/^#\s+.+\n?/, '');
      }
    }

    // Try blockquote for description
    if (!description) {
      const bqMatch = body.match(/^>\s*(.+)$/m);
      if (bqMatch) {
        description = bqMatch[1].trim();
        body = body.replace(/^>\s+.+\n?/, '');
      }
    }

    return { name, description: description || `Template: ${name}`, body: body.trim() };
  }
}
