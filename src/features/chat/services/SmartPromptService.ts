import { TFile } from 'obsidian';

import type { WorkspaceMode } from '../../../core/workspace/workspaceMode';
import type ClaudianPlugin from '../../../main';

export interface SmartPromptItem {
  id: string;
  kind: 'history' | 'memory' | 'context';
  tag: string;
  label: string;
  prompt: string;
  icon: string;
}

const GENERIC_TITLES = new Set([
  'hi',
  'hello',
  'hallo',
  'new conversation',
  'start new conversation',
  'chat',
  'neuer chat',
  'test',
]);

function cleanTitle(title: string): string {
  return title
    .replace(/^["'„“”«»]+|["'„“”«»]+$/g, '')
    .replace(/^weiter\s+an:?\s*/i, '')
    .trim();
}

function truncate(str: string, maxLen = 32): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1).trim() + '…';
}

function formatTopic(topic: string): string {
  // Convert kebab-case or filenames like "vub-firewall-setup" to "VUB Firewall Setup"
  return topic
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (_, char: string) => char.toUpperCase())
    .trim();
}

/**
 * Generates dynamic, personalized suggestions based on recent conversation history,
 * agentic memories, and open workspace notes instead of static boilerplate buttons.
 */
export async function getSmartPromptSuggestions(
  plugin: ClaudianPlugin,
  mode: WorkspaceMode = 'code',
  limit = 4,
): Promise<SmartPromptItem[]> {
  const items: SmartPromptItem[] = [];
  const seenLabels = new Set<string>();

  // 1. History: Recent active conversations
  try {
    const metas = await plugin.storage?.sessions?.listMetadata?.();
    if (metas && metas.length > 0) {
      // Sort by recent activity
      const sorted = [...metas].sort(
        (a, b) => (b.lastResponseAt ?? b.updatedAt ?? b.createdAt) - (a.lastResponseAt ?? a.updatedAt ?? a.createdAt),
      );

      for (const meta of sorted) {
        if (!meta.title) continue;
        const cleaned = cleanTitle(meta.title);
        const lower = cleaned.toLowerCase();
        if (cleaned.length < 3 || GENERIC_TITLES.has(lower)) continue;

        const label = `Weiter an: ${truncate(cleaned, 34)}`;
        if (seenLabels.has(label.toLowerCase())) continue;
        seenLabels.add(label.toLowerCase());

        items.push({
          id: `hist:${meta.id}`,
          kind: 'history',
          tag: 'Verlauf',
          label,
          prompt: `Lass uns an "${cleaned}" weiterarbeiten: `,
          icon: 'history',
        });

        if (items.length >= 2) break;
      }
    }
  } catch {
    // Non-fatal if session store is unavailable
  }

  // 2. Memory: Agentic memories & project facts from .claudian/memory
  try {
    const memoryNotes = await plugin.cachedMemoryStore?.getNotes?.('.claudian/memory');
    if (memoryNotes && memoryNotes.length > 0) {
      // Prioritize recently updated memories or memories with topics like firewall, setup, config, project
      const sortedMemories = [...memoryNotes].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));

      for (const mem of sortedMemories) {
        if (!mem.topic && !mem.path) continue;
        const topicRaw = mem.topic || mem.path.split('/').pop() || '';
        const topicFormatted = formatTopic(topicRaw);
        if (topicFormatted.length < 3) continue;

        const label = `Erinnerung: ${truncate(topicFormatted, 32)}`;
        if (seenLabels.has(label.toLowerCase())) continue;
        seenLabels.add(label.toLowerCase());

        items.push({
          id: `mem:${mem.path}`,
          kind: 'memory',
          tag: 'Memory',
          label,
          prompt: `Erinnerung zu "${topicFormatted}": Lass uns hier anknüpfen. Was ist der aktuelle Stand und was steht als Nächstes an?`,
          icon: 'brain',
        });

        if (items.filter(i => i.kind === 'memory').length >= 2) break;
      }
    }
  } catch {
    // Non-fatal if memory store is unavailable
  }

  // 3. Context: Active note in workspace
  try {
    const activeFile = plugin.app.workspace.getActiveFile();
    if (activeFile instanceof TFile && activeFile.extension === 'md' && !activeFile.path.startsWith('.claudian/')) {
      const label = `Notiz: ${truncate(activeFile.basename, 30)}`;
      if (!seenLabels.has(label.toLowerCase())) {
        seenLabels.add(label.toLowerCase());
        items.push({
          id: `note:${activeFile.path}`,
          kind: 'context',
          tag: 'Notiz',
          label,
          prompt: `Beziehe dich auf die Notiz "${activeFile.basename}" (@${activeFile.path}): `,
          icon: 'file-text',
        });
      }
    }
  } catch {
    // Non-fatal
  }

  // 4. Mode-aware fallbacks if history/memory is sparse
  if (items.length < limit) {
    const fallbacks: SmartPromptItem[] = mode === 'work'
      ? [
          {
            id: 'fallback:work-tasks',
            kind: 'context',
            tag: 'Aufgabe',
            label: 'Offene Punkte & nächste Schritte',
            prompt: 'Was steht aktuell an? Fasse die offenen Aufgaben und nächsten Meilensteine zusammen: ',
            icon: 'check-square',
          },
          {
            id: 'fallback:work-dossier',
            kind: 'context',
            tag: 'Fokus',
            label: 'Dokument & Richtlinie prüfen',
            prompt: 'Prüfe den aktuellen Stand meiner Dokumente und Notizen auf Vollständigkeit: ',
            icon: 'shield-check',
          },
        ]
      : [
          {
            id: 'fallback:code-status',
            kind: 'context',
            tag: 'Aufgabe',
            label: 'Was steht an? Status & To-Dos',
            prompt: 'Was steht als Nächstes an? Analysiere den aktuellen Stand des Projekts und schlage die wichtigsten nächsten Schritte vor.',
            icon: 'sparkles',
          },
          {
            id: 'fallback:code-arch',
            kind: 'context',
            tag: 'Fokus',
            label: 'Architektur & offene Implementierung',
            prompt: 'Lass uns an der Architektur weiterarbeiten: ',
            icon: 'layers',
          },
        ];

    for (const fb of fallbacks) {
      if (items.length >= limit) break;
      if (!seenLabels.has(fb.label.toLowerCase())) {
        seenLabels.add(fb.label.toLowerCase());
        items.push(fb);
      }
    }
  }

  return items.slice(0, limit);
}
