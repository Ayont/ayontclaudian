import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  applyDshDefaultModelToYaml,
  buildDshModelOptionsFromHarness,
  type DshActiveModel,
  parseDshActiveModel,
  parseDshHarnessProviders,
} from './harnessSettings';

const SETTINGS_YAML_PATH = join(homedir(), '.dsh', 'settings.yaml');
const BACKUP_SUFFIX = '.bak';

/** Raw harness settings text, or null when the file is missing/unreadable. */
export function readDshHarnessYaml(): string | null {
  try {
    if (!existsSync(SETTINGS_YAML_PATH)) {
      return null;
    }
    return readFileSync(SETTINGS_YAML_PATH, 'utf-8');
  } catch {
    return null;
  }
}

/** Active agent-default-model from the harness's own settings. */
export function readDshActiveModel(): DshActiveModel | null {
  return parseDshActiveModel(readDshHarnessYaml());
}

/** Writes the selection back into the harness yaml (with a one-shot .bak).
 *  The harness reads this file itself, so its next run picks the model up. */
function writeDshDefaultModel(provider: string, model: string): boolean {
  const current = readDshHarnessYaml();
  if (current === null) {
    return false;
  }
  const active = parseDshActiveModel(current);
  if (active && active.provider === provider && active.model === model) {
    return true;
  }
  const next = applyDshDefaultModelToYaml(current, provider, model);
  if (next === null) {
    return false;
  }
  try {
    writeFileSync(SETTINGS_YAML_PATH + BACKUP_SUFFIX, current, 'utf-8');
    writeFileSync(SETTINGS_YAML_PATH, next, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** Dropdown values for every configured harness model; empty when unreadable. */
export function getDshConfiguredSelectionOptions(): { options: ReturnType<typeof buildDshModelOptionsFromHarness>; active: DshActiveModel | null } {
  const yamlText = readDshHarnessYaml();
  if (yamlText === null) {
    return { options: [], active: null };
  }
  return { options: buildDshModelOptionsFromHarness(parseDshHarnessProviders(yamlText)), active: parseDshActiveModel(yamlText) };
}

/** Called at turn time with the resolved toolbar pick: persists it to the
 *  harness selection file only when it differs from what is stored there. */
export function syncDshSelectionToHarness(model: string): boolean {
  const separator = model.indexOf('|');
  if (separator <= 0 || separator === model.length - 1) {
    return false;
  }
  return writeDshDefaultModel(model.slice(0, separator), model.slice(separator + 1));
}
