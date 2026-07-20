/**
 * Terminal-style prompt recall for the composer: ArrowUp on an EMPTY composer
 * starts browsing the conversation's previous user prompts (newest first),
 * ArrowUp/ArrowDown navigate while browsing, typing or Escape exits.
 *
 * Pure cursor logic — no DOM. Wiring lives in Tab.ts's keydown/input handlers.
 */

export class PromptHistoryCursor {
  /** Index into the prompt list counted FROM THE NEWEST (0 = latest). */
  private index: number | null = null;
  /** The value this cursor last placed into the composer (guards typing-reset). */
  private lastSetValue: string | null = null;

  constructor(private readonly getPrompts: () => string[]) {}

  isBrowsing(): boolean {
    return this.index !== null;
  }

  /**
   * ArrowUp. Starts browsing when the composer is empty; steps to older
   * prompts while browsing. Returns the prompt to display, or null when the
   * key should not be consumed (composer holds a user draft / no history).
   */
  older(currentValue: string): string | null {
    const prompts = this.getPrompts();
    if (prompts.length === 0) {
      return null;
    }
    if (this.index === null) {
      if (currentValue.trim().length > 0) {
        return null;
      }
      this.index = 0;
    } else if (this.index < prompts.length - 1) {
      this.index += 1;
    }
    const value = prompts[prompts.length - 1 - this.index] ?? null;
    this.lastSetValue = value;
    return value;
  }

  /**
   * ArrowDown while browsing. Steps toward newer prompts; moving past the
   * newest returns '' (back to the empty draft) and exits browsing. Returns
   * null when not browsing (key not consumed).
   */
  newer(): string | null {
    if (this.index === null) {
      return null;
    }
    if (this.index === 0) {
      this.reset();
      this.lastSetValue = '';
      return '';
    }
    this.index -= 1;
    const prompts = this.getPrompts();
    const value = prompts[prompts.length - 1 - this.index] ?? '';
    this.lastSetValue = value;
    return value;
  }

  /** Exits browsing (Escape, send, conversation switch). */
  reset(): void {
    this.index = null;
  }

  /**
   * Input-event hook: typing (any value we did not set ourselves) exits
   * browsing so ArrowUp goes back to normal caret movement in the draft.
   */
  notifyInput(currentValue: string): void {
    if (this.index !== null && currentValue !== this.lastSetValue) {
      this.reset();
    }
  }
}

/** Extracts the recallable user prompts (oldest → newest) from messages. */
export function extractRecallablePrompts(
  messages: ReadonlyArray<{
    role: string;
    content: string;
    displayContent?: string;
    isInterrupt?: boolean;
    isRebuiltContext?: boolean;
  }>,
): string[] {
  const prompts: string[] = [];
  for (const message of messages) {
    if (message.role !== 'user' || message.isInterrupt || message.isRebuiltContext) {
      continue;
    }
    const text = (message.displayContent ?? message.content).trim();
    if (!text) {
      continue;
    }
    // Collapse consecutive duplicates (retries) so cycling doesn't stutter.
    if (prompts[prompts.length - 1] !== text) {
      prompts.push(text);
    }
  }
  return prompts;
}
