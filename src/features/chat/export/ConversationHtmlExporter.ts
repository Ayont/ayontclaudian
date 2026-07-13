import { type App,normalizePath } from 'obsidian';

import type { Conversation } from '../../../core/types';
import { safeExportFileName } from './ConversationExporter';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function messageHtml(role: 'user' | 'assistant', content: string, label?: string): string {
  const displayRole = role === 'user' ? 'Du' : (label || 'Claudian');
  return `<article class="message ${role}">
    <header><span>${escapeHtml(displayRole)}</span></header>
    <div class="content">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
  </article>`;
}

export function formatConversationHtml(conversation: Conversation): string {
  const messages = conversation.messages
    .filter((message) => !message.isRebuiltContext && message.content.trim())
    .map((message) => messageHtml(message.role, message.displayContent ?? message.content, message.agentLabel))
    .join('\n');
  const title = escapeHtml(conversation.title || 'Claudian conversation');
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#11110f;color:#f2f0e9}
*{box-sizing:border-box}body{margin:0;background:#11110f;color:#f2f0e9}.page{width:min(880px,calc(100% - 32px));margin:48px auto 80px}
.masthead{margin-bottom:36px;padding-bottom:22px;border-bottom:1px solid #34342f}.eyebrow{color:#d97757;font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}
h1{margin:9px 0 6px;font-size:clamp(30px,5vw,52px);line-height:1.04;letter-spacing:-.035em}.meta{color:#99978f;font-size:13px}
.message{margin:0 0 18px;padding:18px 20px;border-radius:14px;background:#1b1b18;border:1px solid #30302b;break-inside:avoid}
.message.user{margin-left:10%;background:#22211d}.message header{margin-bottom:10px;color:#d97757;font:650 12px ui-monospace,monospace}.message.user header{color:#aaa79d}
.content{font-size:15px;line-height:1.65;overflow-wrap:anywhere}@media print{:root,body{background:#fff;color:#161616}.page{width:auto;margin:0}.message,.message.user{background:#fff;border-color:#ddd;box-shadow:none}.meta{color:#666}}
</style></head><body><main class="page"><header class="masthead"><div class="eyebrow">ayontclaudian export</div><h1>${title}</h1><div class="meta">${new Date(conversation.updatedAt).toLocaleString('de-DE')} · ${conversation.messages.length} Nachrichten</div></header>${messages}</main></body></html>`;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  const parts = normalizePath(folder).split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) await app.vault.adapter.mkdir(current);
  }
}

export async function exportConversationToHtml(app: App, conversation: Conversation): Promise<string> {
  const folder = 'Claudian/Exports';
  await ensureFolder(app, folder);
  const base = safeExportFileName(conversation.title);
  let path = `${folder}/${base}.html`;
  if (await app.vault.adapter.exists(path)) path = `${folder}/${base}-${Date.now()}.html`;
  await app.vault.adapter.write(path, formatConversationHtml(conversation));
  return path;
}

/** Uses Electron's hidden BrowserWindow to print the same designed HTML to A4. */
export async function exportConversationToPdf(app: App, conversation: Conversation): Promise<string> {
  const htmlPath = await exportConversationToHtml(app, conversation);
  const adapter = app.vault.adapter as typeof app.vault.adapter & { getFullPath?: (path: string) => string };
  const absoluteHtml = adapter.getFullPath?.(htmlPath);
  if (!absoluteHtml) throw new Error('Der Vault-Adapter stellt keinen lokalen Dateipfad bereit.');
  // Electron remote is provided by Obsidian desktop; mobile keeps the HTML fallback.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as { remote?: { BrowserWindow: new (options: Record<string, unknown>) => any } };
  if (!electron.remote?.BrowserWindow) throw new Error('PDF-Export ist nur in Obsidian Desktop verfügbar.');
  const window = new electron.remote.BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await window.loadFile(absoluteHtml);
    const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    const pdfPath = htmlPath.replace(/\.html$/i, '.pdf');
    const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    await app.vault.adapter.writeBinary(pdfPath, bytes);
    return pdfPath;
  } finally {
    window.destroy();
  }
}
