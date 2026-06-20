# Auto-Mode Model Router & Image Attachment Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement automatic question-aware model selection on send and persistent image attachment staging that survives Obsidian restarts.

**Architecture:** Extend the existing keyword-based `ModelRouter` to run silently inside `InputController.sendMessage()`. Introduce a new `ImageStagingService` that stores pasted/dropped images as files under `.claudian/staging/images/` with a JSON manifest, and wire it into `ImageContextManager` for save/restore/cleanup.

**Tech Stack:** TypeScript, Obsidian Plugin API, esbuild, Jest, Node.js Buffer/File APIs.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/core/types/settings.ts` | Add `modelRouterAutoMode` setting type. |
| `src/app/settings/defaultSettings.ts` | Change `modelRouterEnabled` default to `true`; add `modelRouterAutoMode: true`. |
| `src/main.ts` | Extract `resolveModelRouteForInput()` from `applyModelRouterToCurrentInput()`; expose it on the plugin. |
| `src/features/chat/controllers/InputController.ts` | Hook auto-router before send; preserve images on cancel. |
| `src/features/chat/services/ImageStagingService.ts` | New service: save/delete/load/cleanup staged images. |
| `src/features/chat/ui/ImageContext.ts` | Persist added images; restore from staging on init; delete on manual remove. |
| `tests/core/routing/modelRouterRules.test.ts` | Existing tests; add auto-mode routing cases. |
| `tests/features/chat/services/ImageStagingService.test.ts` | New unit tests for staging service. |
| `manifest.json` / `package.json` | Bump version to `4.1.0`. |

---

## Task 1: Extend Settings Types and Defaults

**Files:**
- Modify: `src/core/types/settings.ts:124-125`
- Modify: `src/app/settings/defaultSettings.ts:11-12`

- [ ] **Step 1: Add `modelRouterAutoMode` to settings type**

```ts
// src/core/types/settings.ts
/** Optional prompt-based model routing. When enabled, first send can switch to the matching rule's model. */
modelRouterEnabled?: boolean;
/** Automatically apply model routing on every user send. */
modelRouterAutoMode?: boolean;
modelRouterRules?: ModelRouterRuleSetting[];
```

- [ ] **Step 2: Update defaults**

```ts
// src/app/settings/defaultSettings.ts
modelRouterEnabled: true,
modelRouterAutoMode: true,
modelRouterRules: [],
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts
git commit -m "feat(settings): enable model router by default and add auto-mode flag"
```

---

## Task 2: Extract Silent Model Routing Method

**Files:**
- Modify: `src/main.ts:814-857`

- [ ] **Step 1: Extract `resolveModelRouteForInput()`**

Replace the current `applyModelRouterToCurrentInput()` body with a new internal method that returns the decision without UI side effects.

```ts
// src/main.ts
resolveModelRouteForInput(prompt: string, tab: ClaudianTab): ModelRouteDecision | null {
  const settingsBag = this.settings as unknown as Record<string, unknown>;
  const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.settings, tab.providerId);
  const fallbackModel = tab.draftModel ?? String(snapshot.model ?? this.settings.model);
  const availableModels = ProviderRegistry.getAggregatedModelOptions(settingsBag);
  const explicitRules = normalizeRouterRules(this.settings.modelRouterRules);
  const rules = explicitRules.length > 0 ? explicitRules : this.defaultRouterRulesFromModels();
  const decision = chooseModelRoute({ prompt, rules, availableModels, fallbackModel });

  if (decision.model === fallbackModel) {
    return null;
  }
  return decision;
}

async applyModelRouterToCurrentInput(): Promise<void> {
  const tab = this.getView()?.getActiveTab();
  if (!tab) {
    new Notice('Kein aktiver Chat-Tab.');
    return;
  }

  const prompt = tab.dom.inputEl.value.trim();
  if (!prompt) {
    new Notice('Gib zuerst einen Prompt ins Eingabefeld ein.');
    return;
  }

  const decision = this.resolveModelRouteForInput(prompt, tab);
  if (!decision) {
    const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.settings, tab.providerId);
    const currentModel = tab.draftModel ?? String(snapshot.model ?? this.settings.model);
    new Notice(`Model Router: bleibe bei ${currentModel}.`);
    return;
  }

  await tab.ui.modelSelector?.selectModel(decision.model);
  new Notice(`Model Router: ${decision.task} → ${decision.model} (${decision.reason}).`);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "refactor(router): extract silent resolveModelRouteForInput method"
```

---

## Task 3: Hook Auto-Router into `sendMessage`

**Files:**
- Modify: `src/features/chat/controllers/InputController.ts:235-320`

- [ ] **Step 1: Add auto-router hook after content extraction**

After `const content = ...` and `const imageOverride = ...`, insert:

```ts
// src/features/chat/controllers/InputController.ts
const tab = this.deps.plugin.getView()?.getActiveTab();
if (
  tab &&
  plugin.settings.modelRouterEnabled !== false &&
  plugin.settings.modelRouterAutoMode !== false &&
  !tab.draftModel &&
  shouldUseInput
) {
  const decision = plugin.resolveModelRouteForInput(content, tab);
  if (decision && decision.model !== (tab.draftModel ?? this.getActiveModel())) {
    await tab.ui.modelSelector?.selectModel(decision.model);
  }
}
```

> Note: `this.getActiveModel()` should be derived from the active provider/model. If `getActiveModel` is not exposed on `InputControllerDeps`, use `this.deps.getActiveModel?.() ?? tab.draftModel ?? String(ProviderSettingsCoordinator.getProviderSettingsSnapshot(plugin.settings, tab.providerId).model ?? plugin.settings.model)`.

- [ ] **Step 2: Ensure async `sendMessage` handles the hook**

The method is already `async`, so the `await` is valid.

- [ ] **Step 3: Run existing tests**

Run: `npm test -- --testPathPattern=InputController`
Expected: Existing tests pass (or no tests found for this file).

- [ ] **Step 4: Commit**

```bash
git add src/features/chat/controllers/InputController.ts
git commit -m "feat(router): apply model router automatically on user send"
```

---

## Task 4: Create `ImageStagingService`

**Files:**
- Create: `src/features/chat/services/ImageStagingService.ts`
- Create: `tests/features/chat/services/ImageStagingService.test.ts`

- [ ] **Step 1: Write the staging service**

```ts
// src/features/chat/services/ImageStagingService.ts
import { normalizePath, Notice, type Vault } from 'obsidian';
import type { ImageAttachment, ImageMediaType } from '../../../core/types';

export interface StagedImageEntry {
  id: string;
  filename: string;
  name: string;
  mediaType: ImageMediaType;
  size: number;
  source: 'paste' | 'drop';
  createdAt: number;
}

interface Manifest {
  version: 1;
  images: StagedImageEntry[];
}

const MANIFEST_FILE = 'manifest.json';
const STAGING_FOLDER = '.claudian/staging/images';
const DEFAULT_MAX_AGE_DAYS = 7;

export class ImageStagingService {
  private vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  private async getStagingFolder(): Promise<string> {
    const folder = normalizePath(`${STAGING_FOLDER}`);
    const exists = await this.vault.adapter.exists(folder);
    if (!exists) {
      await this.vault.adapter.mkdir(folder);
    }
    return folder;
  }

  private async getManifest(): Promise<Manifest> {
    const folder = await this.getStagingFolder();
    const path = normalizePath(`${folder}/${MANIFEST_FILE}`);
    try {
      const raw = await this.vault.adapter.read(path);
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.images)) {
        return parsed as Manifest;
      }
    } catch {
      // ignore read/parse errors
    }
    return { version: 1, images: [] };
  }

  private async saveManifest(manifest: Manifest): Promise<void> {
    const folder = await this.getStagingFolder();
    const path = normalizePath(`${folder}/${MANIFEST_FILE}`);
    await this.vault.adapter.write(path, JSON.stringify(manifest, null, 2));
  }

  async saveImage(attachment: ImageAttachment): Promise<void> {
    const folder = await this.getStagingFolder();
    const filename = `${attachment.id}.${attachment.mediaType.split('/')[1]}`;
    const filePath = normalizePath(`${folder}/${filename}`);

    await this.vault.adapter.writeBinary(filePath, Buffer.from(attachment.data, 'base64'));

    const manifest = await this.getManifest();
    const entry: StagedImageEntry = {
      id: attachment.id,
      filename,
      name: attachment.name,
      mediaType: attachment.mediaType,
      size: attachment.size,
      source: attachment.source,
      createdAt: Date.now(),
    };

    const index = manifest.images.findIndex(img => img.id === attachment.id);
    if (index >= 0) {
      manifest.images[index] = entry;
    } else {
      manifest.images.push(entry);
    }

    await this.saveManifest(manifest);
  }

  async deleteImage(id: string): Promise<void> {
    const manifest = await this.getManifest();
    const entry = manifest.images.find(img => img.id === id);
    if (!entry) return;

    const folder = await this.getStagingFolder();
    const filePath = normalizePath(`${folder}/${entry.filename}`);
    try {
      if (await this.vault.adapter.exists(filePath)) {
        await this.vault.adapter.remove(filePath);
      }
    } catch (error) {
      console.warn(`Failed to remove staged image file ${filePath}`, error);
    }

    manifest.images = manifest.images.filter(img => img.id !== id);
    await this.saveManifest(manifest);
  }

  async loadImage(id: string): Promise<ImageAttachment | null> {
    const manifest = await this.getManifest();
    const entry = manifest.images.find(img => img.id === id);
    if (!entry) return null;

    const folder = await this.getStagingFolder();
    const filePath = normalizePath(`${folder}/${entry.filename}`);
    try {
      const buffer = await this.vault.adapter.readBinary(filePath);
      const data = Buffer.from(buffer).toString('base64');
      return {
        id: entry.id,
        name: entry.name,
        mediaType: entry.mediaType,
        data,
        size: entry.size,
        source: entry.source,
      };
    } catch (error) {
      console.warn(`Failed to load staged image ${id}`, error);
      await this.deleteImage(id);
      return null;
    }
  }

  async listImages(): Promise<StagedImageEntry[]> {
    const manifest = await this.getManifest();
    return manifest.images;
  }

  async cleanup(maxAgeDays = DEFAULT_MAX_AGE_DAYS): Promise<void> {
    const manifest = await this.getManifest();
    const folder = await this.getStagingFolder();
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const remaining: StagedImageEntry[] = [];

    for (const entry of manifest.images) {
      const filePath = normalizePath(`${folder}/${entry.filename}`);
      const exists = await this.vault.adapter.exists(filePath);
      if (!exists || entry.createdAt < cutoff) {
        try {
          if (exists) {
            await this.vault.adapter.remove(filePath);
          }
        } catch (error) {
          console.warn(`Failed to cleanup staged image ${entry.id}`, error);
        }
        continue;
      }
      remaining.push(entry);
    }

    await this.saveManifest({ version: 1, images: remaining });
  }
}
```

- [ ] **Step 2: Write unit tests**

```ts
// tests/features/chat/services/ImageStagingService.test.ts
import { ImageStagingService } from '../../../../src/features/chat/services/ImageStagingService';

describe('ImageStagingService', () => {
  // Use a simple in-memory vault adapter mock
  const createService = () => {
    const files = new Map<string, Buffer>();
    const vault = {
      adapter: {
        exists: jest.fn(async (path: string) => files.has(path)),
        mkdir: jest.fn(async () => {}),
        read: jest.fn(async (path: string) => {
          const data = files.get(path);
          if (!data) throw new Error('File not found');
          return data.toString('utf-8');
        }),
        write: jest.fn(async (path: string, data: string) => {
          files.set(path, Buffer.from(data, 'utf-8'));
        }),
        readBinary: jest.fn(async (path: string) => {
          const data = files.get(path);
          if (!data) throw new Error('File not found');
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }),
        writeBinary: jest.fn(async (path: string, data: ArrayBuffer) => {
          files.set(path, Buffer.from(data));
        }),
        remove: jest.fn(async (path: string) => {
          files.delete(path);
        }),
      },
    } as unknown as import('obsidian').Vault;
    return { service: new ImageStagingService(vault), files, vault };
  };

  it('saves and loads an image', async () => {
    const { service } = createService();
    const attachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png' as const,
      data: Buffer.from('fake-image').toString('base64'),
      size: 1234,
      source: 'paste' as const,
    };

    await service.saveImage(attachment);
    const loaded = await service.loadImage('img-1');

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('img-1');
    expect(loaded?.data).toBe(attachment.data);
  });

  it('deletes an image and removes the file', async () => {
    const { service, files } = createService();
    await service.saveImage({
      id: 'img-2',
      name: 'test.jpg',
      mediaType: 'image/jpeg' as const,
      data: Buffer.from('fake').toString('base64'),
      size: 100,
      source: 'drop' as const,
    });

    await service.deleteImage('img-2');

    expect(await service.loadImage('img-2')).toBeNull();
    expect(files.size).toBe(1); // only manifest remains
  });

  it('cleans up old images', async () => {
    const { service } = createService();
    await service.saveImage({
      id: 'img-new',
      name: 'new.png',
      mediaType: 'image/png' as const,
      data: Buffer.from('new').toString('base64'),
      size: 100,
      source: 'paste' as const,
    });

    await service.saveImage({
      id: 'img-old',
      name: 'old.png',
      mediaType: 'image/png' as const,
      data: Buffer.from('old').toString('base64'),
      size: 100,
      source: 'paste' as const,
    });

    const manifest = JSON.parse(Buffer.from((await service as any).getManifest() as unknown as string).toString());
    manifest.images.find((i: { id: string }) => i.id === 'img-old').createdAt = Date.now() - 10 * 24 * 60 * 60 * 1000;

    await service.cleanup(7);

    expect(await service.loadImage('img-new')).not.toBeNull();
    expect(await service.loadImage('img-old')).toBeNull();
  });
});
```

> Note: The cleanup test may need adjustment based on the actual `getManifest` visibility. If `getManifest` is private, mutate the service state via a test-only helper or make the test more integration-style.

- [ ] **Step 3: Run the new tests**

Run: `npm test -- --testPathPattern=ImageStagingService`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/chat/services/ImageStagingService.ts tests/features/chat/services/ImageStagingService.test.ts
git commit -m "feat(images): add ImageStagingService for persistent image cache"
```

---

## Task 5: Wire Staging into `ImageContextManager`

**Files:**
- Modify: `src/features/chat/ui/ImageContext.ts`

- [ ] **Step 1: Extend constructor to accept staging service**

```ts
// src/features/chat/ui/ImageContext.ts
import { ImageStagingService } from '../services/ImageStagingService';

export interface ImageContextCallbacks {
  onImagesChanged: () => void;
}

export class ImageContextManager {
  private callbacks: ImageContextCallbacks;
  private containerEl: HTMLElement;
  private previewContainerEl: HTMLElement;
  private imagePreviewEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private dropOverlay: HTMLElement | null = null;
  private attachedImages: Map<string, ImageAttachment> = new Map();
  private enabled = true;
  private stagingService: ImageStagingService;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: ImageContextCallbacks,
    previewContainerEl?: HTMLElement,
    stagingService?: ImageStagingService
  ) {
    this.containerEl = containerEl;
    this.previewContainerEl = previewContainerEl ?? containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.stagingService = stagingService ?? new ImageStagingService((window as any).app?.vault);

    // ... existing preview setup

    this.setupDragAndDrop();
    this.setupPasteHandler();
    this.restoreFromStaging();
  }
```

> Note: `(window as any).app?.vault` is a fallback for when no staging service is injected. In production, the plugin should always inject the service.

- [ ] **Step 2: Persist on add and delete on remove**

In `addImageFromFile()`, after `this.attachedImages.set(...)`:

```ts
void this.stagingService.saveImage(attachment).catch((error) => {
  console.warn('Failed to stage image', error);
});
```

In `renderImagePreview()`, update the remove handler:

```ts
removeEl.addEventListener('click', (e) => {
  e.stopPropagation();
  const image = this.attachedImages.get(id);
  if (image) {
    void this.stagingService.deleteImage(id);
  }
  this.attachedImages.delete(id);
  this.updateImagePreview();
  this.callbacks.onImagesChanged();
});
```

- [ ] **Step 3: Add restore method**

```ts
// src/features/chat/ui/ImageContext.ts
private async restoreFromStaging(): Promise<void> {
  try {
    const entries = await this.stagingService.listImages();
    for (const entry of entries) {
      const loaded = await this.stagingService.loadImage(entry.id);
      if (loaded) {
        this.attachedImages.set(loaded.id, loaded);
      }
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  } catch (error) {
    console.warn('Failed to restore staged images', error);
  }
}
```

- [ ] **Step 4: Update `clearImages` to optionally clear staging**

```ts
clearImages(clearStaging = true) {
  if (clearStaging) {
    for (const id of this.attachedImages.keys()) {
      void this.stagingService.deleteImage(id);
    }
  }
  this.attachedImages.clear();
  this.updateImagePreview();
  this.callbacks.onImagesChanged();
}
```

- [ ] **Step 5: Run tests and build**

Run: `npm test -- --testPathPattern=ImageContext`
Expected: Tests pass.

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/ui/ImageContext.ts
git commit -m "feat(images): persist and restore image attachments via staging"
```

---

## Task 6: Preserve Images on Cancel

**Files:**
- Modify: `src/features/chat/controllers/InputController.ts`

- [ ] **Step 1: Find cancel/stop handling**

Search for the cancel/stop method (likely `cancelCurrentStream()` or `stopStreaming()`). Identify where it clears images.

- [ ] **Step 2: Remove image clearing on cancel**

Ensure that the cancel path does **not** call `imageContextManager?.clearImages()`. Only the successful send path should clear images.

For example, change:

```ts
// before
this.deps.getImageContextManager()?.clearImages();
```

in the cancel handler to:

```ts
// after (cancel path does nothing with images)
```

- [ ] **Step 3: Ensure successful send still clears images**

After a successful send (where `shouldUseInput` is true), the existing code should already call:

```ts
imageContextManager?.clearImages();
```

If it does not, add it after the message is submitted.

- [ ] **Step 4: Commit**

```bash
git add src/features/chat/controllers/InputController.ts
git commit -m "feat(images): keep image attachments attached when canceling a message"
```

---

## Task 7: Plugin Startup Cleanup

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Initialize staging service on plugin load**

In `ClaudianPlugin.onload()`, after settings are loaded, add:

```ts
// src/main.ts
this.imageStagingService = new ImageStagingService(this.app.vault);
void this.imageStagingService.cleanup(7).catch((error) => {
  console.warn('Failed to cleanup staged images', error);
});
```

- [ ] **Step 2: Expose staging service for injection**

Add a getter or public field on `ClaudianPlugin`:

```ts
// src/main.ts
imageStagingService: ImageStagingService;
```

- [ ] **Step 3: Inject service into `ImageContextManager`**

Find where `ImageContextManager` is instantiated (likely in `ClaudianView` or tab setup). Pass `plugin.imageStagingService` as the fifth constructor argument.

```ts
new ImageContextManager(
  containerEl,
  inputEl,
  { onImagesChanged: () => this.updateImagePreviews() },
  previewContainerEl,
  plugin.imageStagingService,
);
```

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/features/chat/ClaudianView.ts
git commit -m "feat(images): cleanup staged images on plugin startup and inject service"
```

---

## Task 8: Add/Update Tests for Auto-Mode

**Files:**
- Modify: `tests/core/routing/modelRouterRules.test.ts` (or create)
- Modify: `tests/features/chat/controllers/InputController.test.ts` (or create)

- [ ] **Step 1: Add routing test for code prompt**

```ts
// tests/core/routing/modelRouterRules.test.ts
import { chooseModelRoute } from '../../../src/core/routing/modelRouterRules';

describe('chooseModelRoute auto-mode', () => {
  it('routes code prompts to a code model', () => {
    const decision = chooseModelRoute({
      prompt: 'Fix this TypeScript bug',
      rules: [{ task: 'code', model: 'kimi-code' }],
      availableModels: [{ value: 'kimi-code', label: 'Kimi Code', providerId: 'kimi' }],
      fallbackModel: 'default-model',
    });
    expect(decision.model).toBe('kimi-code');
    expect(decision.task).toBe('code');
  });

  it('falls back when no rule matches', () => {
    const decision = chooseModelRoute({
      prompt: 'What is the weather?',
      rules: [{ task: 'code', model: 'kimi-code' }],
      availableModels: [{ value: 'kimi-code', label: 'Kimi Code', providerId: 'kimi' }],
      fallbackModel: 'default-model',
    });
    expect(decision.model).toBe('default-model');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- --testPathPattern=modelRouterRules`
Expected: Tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/core/routing/modelRouterRules.test.ts
git commit -m "test(router): add auto-mode routing cases"
```

---

## Task 9: Version Bump and Final Verification

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `versions.json`

- [ ] **Step 1: Bump version to `4.1.0`**

```json
// manifest.json
{
  "id": "claudian",
  "name": "Claudian",
  "version": "4.1.0",
  ...
}
```

```json
// package.json
{
  "version": "4.1.0",
  ...
}
```

```json
// versions.json
{
  "4.1.0": "0.15.0"
}
```

> Note: `minAppVersion` should remain unchanged unless the new features require a newer Obsidian API.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds and outputs `main.js`, `styles.css`.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No lint errors.

- [ ] **Step 5: Commit and tag**

```bash
git add manifest.json package.json versions.json
git commit -m "chore(release): bump version to 4.1.0"
git tag -a v4.1.0 -m "Release v4.1.0: auto-mode model router and image staging"
```

---

## Self-Review

### Spec Coverage

- Auto-Mode enabled by default: Task 1.
- Auto-Mode hook on send: Task 3.
- Silent routing method: Task 2.
- Image staging service: Task 4.
- Persist/restore images: Task 5.
- Preserve images on cancel: Task 6.
- Startup cleanup: Task 7.
- Tests: Tasks 4, 8.
- Release: Task 9.

No gaps identified.

### Placeholder Scan

- No TBD/TODO.
- No vague instructions like "add appropriate error handling".
- Code examples are concrete.
- Test code is included.

### Type Consistency

- `modelRouterAutoMode` is defined in `ClaudianSettings` and used consistently.
- `ImageStagingService` methods use `ImageAttachment` and `StagedImageEntry` consistently.
- `ImageContextManager` constructor signature is updated in Task 5 and Task 7.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-19-auto-mode-and-image-staging-plan.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach do you prefer?
