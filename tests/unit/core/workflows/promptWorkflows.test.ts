import {
  expandWorkflow,
  parseWorkflowFile,
  serializeWorkflow,
  slugifyWorkflowName,
  workflowPathForName,
} from '@/core/workflows/promptWorkflows';

describe('promptWorkflows', () => {
  it('slugifies names and builds paths', () => {
    expect(slugifyWorkflowName('Release Notes!')).toBe('release-notes');
    expect(workflowPathForName('Release Notes')).toBe('.claudian/workflows/release-notes.md');
  });

  it('parses frontmatter and expands placeholders', () => {
    const file = serializeWorkflow({ name: 'Review', description: 'Code review', body: 'Review: {{input}} / {{args}}' });
    const workflow = parseWorkflowFile('.claudian/workflows/review.md', file);
    expect(workflow.name).toBe('Review');
    expect(workflow.description).toBe('Code review');
    expect(expandWorkflow(workflow, 'hello', 'strict')).toBe('Review: hello / strict');
  });

  it('appends current input when no input placeholder exists', () => {
    const workflow = parseWorkflowFile('x.md', 'Do this');
    expect(expandWorkflow(workflow, 'Current')).toContain('## Current input\nCurrent');
  });
});
