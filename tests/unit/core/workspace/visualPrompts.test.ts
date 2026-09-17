import { detectBuiltInCommand } from '@/core/commands/builtInCommands';
import {
  buildAngebotPrompt,
  buildDiagramPrompt,
  buildMindmapPrompt,
} from '@/core/workspace/visualPrompts';
import { getWorkspaceQuickPrompts } from '@/core/workspace/workspaceMode';

describe('buildAngebotPrompt', () => {
  it('asks for a Word-like quote document with positions and prices', () => {
    const prompt = buildAngebotPrompt('Firewall-Wartung, 8 Stunden');
    expect(prompt).toContain('theme: word');
    expect(prompt).toContain('Leistungsbeschreibung');
    expect(prompt).toContain('Positionen');
    expect(prompt).toContain('Firewall-Wartung');
    expect(prompt).not.toMatch(/HUNARI|Hilden/);
  });
});

describe('buildMindmapPrompt', () => {
  it('asks for a mermaid mindmap, not Draw.io XML', () => {
    const prompt = buildMindmapPrompt('Lernfeld 7 CPS');
    expect(prompt).toContain('```mermaid');
    expect(prompt).toContain('mindmap');
    expect(prompt).toContain('Lernfeld 7 CPS');
    expect(prompt).toMatch(/Kein Draw\.io|Draw\.io/i);
  });
});

describe('visual slash commands and Work starters', () => {
  it('wires /angebot, /mindmap and /diagram plus Work chips', () => {
    expect(detectBuiltInCommand('/angebot Firewall-Wartung')?.command.action).toBe('angebot');
    expect(detectBuiltInCommand('/mindmap Lernfeld 7')?.command.action).toBe('mindmap');
    expect(detectBuiltInCommand('/prozess Onboarding')?.command.action).toBe('diagram');

    const work = getWorkspaceQuickPrompts('work');
    expect(work.some((quick) => quick.label === 'Angebot')).toBe(true);
    expect(work.some((quick) => quick.label === 'Mindmap')).toBe(true);
    expect(buildDiagramPrompt('Onboarding')).toContain('flowchart');
  });
});
