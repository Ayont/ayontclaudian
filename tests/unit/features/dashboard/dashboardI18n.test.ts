import { dashboardStrings } from '@/features/dashboard/dashboardI18n';
import { setLocale } from '@/i18n/i18n';

describe('dashboardStrings', () => {
  afterEach(() => setLocale('en'));

  it('returns English by default (the main language)', () => {
    setLocale('en');
    const s = dashboardStrings();
    expect(s.cardProjects).toBe('Projects');
    expect(s.actCreate).toBe('Create');
    expect(s.headerSubtitle).toBe('Agent workspace for your vault');
  });

  it('returns German when the locale is de', () => {
    setLocale('de');
    const s = dashboardStrings();
    expect(s.cardProjects).toBe('Projekte');
    expect(s.actCreate).toBe('Erstellen');
    expect(s.headerSubtitle).toBe('Dein Agenten-Arbeitsbereich für den Vault');
  });

  it('falls back to English for other locales (e.g. French)', () => {
    setLocale('fr');
    expect(dashboardStrings().cardProjects).toBe('Projects');
  });

  it('interpolates dynamic strings per locale', () => {
    setLocale('de');
    expect(dashboardStrings().latest('Veylor')).toBe('Zuletzt: Veylor');
    expect(dashboardStrings().runningNow(3)).toBe('3 laufen gerade');
    setLocale('en');
    expect(dashboardStrings().latest('Veylor')).toBe('Latest: Veylor');
    expect(dashboardStrings().valWorkflowsActive(2, 5)).toBe('2/5 active');
  });
});
