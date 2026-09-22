import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { FileSystemAdapter } from 'obsidian';
import { homedir } from 'os';
import { join } from 'path';

declare const __DESKTOP_BRIDGE_SOURCE__: string;
import type ClaudianPlugin from '../../main';
import type { DesktopBridgeProviderId } from './DesktopBridgeTransport';
export function desktopAppPath(id: DesktopBridgeProviderId): string | null {
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/swift')) return null;
  const name = id === 'grok-bot' ? 'Grok Bot.app' : 'Perplexity.app';
  return [join('/Applications', name), join(homedir(), 'Applications', name)].find(p => existsSync(p)) ?? null;
}
export function prepareHelper(plugin: ClaudianPlugin): string {
  const adapter = plugin.app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter) || !plugin.manifest.dir) throw new Error('Lokaler Plugin-Pfad fehlt');
  const dir = join(adapter.getBasePath(), plugin.manifest.dir);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'desktop-bridge.swift');
  if (typeof __DESKTOP_BRIDGE_SOURCE__ !== 'string') throw new Error('Desktop-Helper fehlt im Bundle');
  writeFileSync(target, __DESKTOP_BRIDGE_SOURCE__, { mode: 0o600 });
  return target;
}
