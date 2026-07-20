/**
 * Shared welcome-screen content: the serif greeting plus a mode-aware
 * subline. BOTH mode sublines are always rendered — CSS shows only the one
 * matching the container's `claudian-mode-*` class, so a mode switch updates
 * the welcome screen with zero re-render wiring.
 */
export function renderWelcomeContent(welcomeEl: HTMLElement, greeting: string): void {
  welcomeEl.createDiv({ cls: 'claudian-welcome-greeting', text: greeting });
  welcomeEl.createDiv({
    cls: 'claudian-welcome-sub claudian-welcome-sub--code',
    text: 'Code-Modus · Dein Vault ist das Arbeitsverzeichnis',
  });
  welcomeEl.createDiv({
    cls: 'claudian-welcome-sub claudian-welcome-sub--work',
    text: 'Work-Modus · Dokumente, Notizen, Recherche',
  });
}
