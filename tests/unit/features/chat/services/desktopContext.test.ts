import { DesktopContextSnapshot } from '../../../../../src/features/chat/services/desktopContext';

describe('DesktopContextSnapshot', () => {
  const make = () => new DesktopContextSnapshot('synthetic-turn', [{ kind: 'selection', label: 'Fixture', text: 'private fixture' }]);

  it('rejects unknown/cross-turn ids before approval', async () => {
    const first = make();
    const second = make();
    const approve = jest.fn(async () => true);
    await expect(second.readPage(first.manifest().items[0].firstPageId, approve, new AbortController().signal, () => true)).rejects.toThrow('Unbekannte');
    expect(approve).not.toHaveBeenCalled();
  });

  it.each(['deny', 'revoke', 'dispose', 'abort'])('blocks release after %s while approval is pending', async mode => {
    const context = make();
    const controller = new AbortController();
    let allowed = true;
    let resolve!: (value: boolean) => void;
    const pending = context.readPage(context.manifest().items[0].firstPageId, () => new Promise<boolean>(r => { resolve = r; }), controller.signal, () => allowed);
    await Promise.resolve();
    if (mode === 'revoke') allowed = false;
    if (mode === 'dispose') context.dispose();
    if (mode === 'abort') controller.abort();
    resolve(mode !== 'deny');
    await expect(pending).rejects.toThrow();
  });

  it('settles cancellation without waiting for the approval callback', async () => {
    const context = make();
    const controller = new AbortController();
    const pending = context.readPage(context.manifest().items[0].firstPageId, () => new Promise<boolean>(() => {}), controller.signal, () => true);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow('abgebrochen');
  });

  it('rejects oversize input instead of truncating and clears disposed state', () => {
    expect(() => new DesktopContextSnapshot('turn', [{ kind: 'text', label: '', text: 'x'.repeat(65537) }])).toThrow('Nichts gekürzt');
    const context = make();
    context.dispose();
    expect(() => context.manifest()).toThrow();
  });

  it('snapshots input and isolates manifest mutation; even empty text has an explicit page', async () => {
    const input = { kind: 'text' as const, label: 'Fixture', text: '' };
    const context = new DesktopContextSnapshot('turn', [input]);
    input.text = 'changed';
    const manifest = context.manifest();
    const id = manifest.items[0].firstPageId;
    manifest.items[0].firstPageId = 'tampered';
    expect(context.manifest().items[0].firstPageId).toBe(id);
    const page = await context.readPage(id, async () => true, new AbortController().signal, () => true);
    expect(page.data).toBe('');
    expect(page.nextPageId).toBeNull();
    expect(Object.isFrozen(page)).toBe(true);
  });

  it('preserves exact selected text through JSON-budgeted pages without exposing it in the manifest', async () => {
    const text = '"\\\n😀'.repeat(400);
    const context = new DesktopContextSnapshot('turn-1', [{ kind: 'note', label: 'Synthetic.md', text }]);
    const manifest = context.manifest();
    expect(JSON.stringify(manifest)).not.toContain('Synthetic.md');
    expect(manifest.items[0].utf16Length).toBe(text.length);
    expect(manifest.items[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    let restored = '';
    let pageId: string | null = manifest.items[0].firstPageId;
    while (pageId) {
      const page = await context.readPage(pageId, async details => { expect(details.label).toBe('Synthetic.md'); return true; }, new AbortController().signal, () => true);
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(900);
      restored += page.data;
      pageId = page.nextPageId;
    }
    expect(restored).toBe(text);
  });
});
