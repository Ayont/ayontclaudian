import { projectSlug } from '@/features/dashboard/NewProjectModal';

describe('projectSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(projectSlug('Veylor Backend')).toBe('veylor-backend');
  });

  it('collapses non-word runs and trims edge hyphens', () => {
    expect(projectSlug('  Hello -- World!!  ')).toBe('hello-world');
  });

  it('keeps digits and underscores', () => {
    expect(projectSlug('Projekt_2026 v2')).toBe('projekt_2026-v2');
  });

  it('returns empty for punctuation-only names (caller rejects these)', () => {
    expect(projectSlug('!!!')).toBe('');
    expect(projectSlug('   ')).toBe('');
  });

  it('matches the id ProjectService would derive (dedup parity)', () => {
    // ProjectService: name.toLowerCase().replace(/[^\w]+/g, '-')
    const name = 'My Cool Project';
    const serviceId = name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
    expect(projectSlug(name)).toBe(serviceId);
  });
});
