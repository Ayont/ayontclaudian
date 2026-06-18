export const WORKFLOW_FOLDER = '.claudian/workflows';

export interface PromptWorkflow {
  id: string;
  name: string;
  path: string;
  description?: string;
  body: string;
}

export function slugifyWorkflowName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'workflow';
}

export function workflowPathForName(name: string): string {
  return `${WORKFLOW_FOLDER}/${slugifyWorkflowName(name)}.md`;
}

export function parseWorkflowFile(path: string, content: string): PromptWorkflow {
  const lines = content.split(/\r?\n/);
  let name = path.split('/').pop()?.replace(/\.md$/i, '') ?? 'workflow';
  let description: string | undefined;
  let bodyStart = 0;

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (!match) continue;
        const key = match[1].trim();
        const value = match[2].trim().replace(/^['"]|['"]$/g, '');
        if (key === 'name' && value) name = value;
        if (key === 'description' && value) description = value;
      }
      bodyStart = end + 1;
    }
  }

  return {
    id: slugifyWorkflowName(name),
    name,
    path,
    description,
    body: lines.slice(bodyStart).join('\n').trim(),
  };
}

export function serializeWorkflow(options: {
  name: string;
  description?: string;
  body: string;
}): string {
  const escapedName = options.name.replace(/"/g, '\\"');
  const escapedDescription = (options.description ?? '').replace(/"/g, '\\"');
  return [
    '---',
    `name: "${escapedName}"`,
    ...(escapedDescription ? [`description: "${escapedDescription}"`] : []),
    '---',
    '',
    options.body.trim(),
    '',
  ].join('\n');
}

export function expandWorkflow(workflow: PromptWorkflow, input: string, args = ''): string {
  const source = workflow.body || input;
  let expanded = source
    .replace(/\{\{\s*input\s*\}\}/gi, input)
    .replace(/\{\{\s*args\s*\}\}/gi, args);

  if (!/\{\{\s*input\s*\}\}/i.test(source) && input.trim()) {
    expanded = `${expanded.trim()}\n\n## Current input\n${input.trim()}`;
  }
  return expanded.trim();
}
