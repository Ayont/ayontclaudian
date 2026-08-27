jest.mock('@/utils/date', () => ({
  getTodayDate: () => 'Mocked Date',
}));

import { getInlineEditSystemPrompt } from '@/core/prompt/inlineEdit';
import {
  buildSystemPrompt,
  buildTurnOutputContract,
  computeSystemPromptKey,
} from '@/core/prompt/mainAgent';

describe('systemPrompt', () => {
  describe('buildSystemPrompt', () => {
    it('should append custom prompt section when provided', () => {
      const prompt = buildSystemPrompt({ customPrompt: 'Always be concise.' });
      expect(prompt).toContain('# Custom Instructions');
      expect(prompt).toContain('Always be concise.');
    });

    it('should not append custom prompt section when empty', () => {
      const prompt = buildSystemPrompt({ customPrompt: '   ' });
      expect(prompt).not.toContain('# Custom Instructions');
    });

    it('should not append custom prompt section when undefined', () => {
      const prompt = buildSystemPrompt({});
      expect(prompt).not.toContain('# Custom Instructions');
    });

    it('should include base system prompt elements', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('Use `bash: date` to get the current date and time. Never guess or assume.');
      expect(prompt).toContain('Claudian');
      expect(prompt).toContain('## Path Conventions');
      expect(prompt).toContain('# User Message Format');
    });

    it('should omit Claude-specific tool guidance from the shared prompt', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).not.toContain('## Tool Usage Guidelines');
      expect(prompt).not.toContain('### WebSearch');
      expect(prompt).not.toContain('### Agent (Subagents)');
      expect(prompt).not.toContain('### TodoWrite');
      expect(prompt).not.toContain('### Skills');
    });

    it('keeps optional presentation manuals out of the persistent base prompt', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).not.toContain('## Live Network Diagrams');
      expect(prompt).not.toContain('## Live Document Builder');
      expect(prompt).not.toContain('## Live Email Templates');
      expect(prompt).not.toContain('## Cisco Packet Tracer Labs');
      expect(prompt).not.toContain('## Desktop Control');
      expect(prompt.length).toBeLessThan(8_000);
    });

  });

  describe('userName in system prompt', () => {
    it('should include user context when userName is provided', () => {
      const prompt = buildSystemPrompt({ userName: 'Alice' });
      expect(prompt).toContain('## User Context');
      expect(prompt).toContain('You are collaborating with **Alice**.');
    });

    it('should not include user context when userName is empty', () => {
      const prompt = buildSystemPrompt({ userName: '' });
      expect(prompt).not.toContain('## User Context');
    });

    it('should not include user context when userName is whitespace only', () => {
      const prompt = buildSystemPrompt({ userName: '   ' });
      expect(prompt).not.toContain('## User Context');
    });

    it('should not include user context when userName is undefined', () => {
      const prompt = buildSystemPrompt({});
      expect(prompt).not.toContain('## User Context');
    });

    it('should trim whitespace from userName', () => {
      const prompt = buildSystemPrompt({ userName: '  Bob  ' });
      expect(prompt).toContain('You are collaborating with **Bob**.');
      expect(prompt).not.toContain('**  Bob  **');
    });
  });

  describe('media folder instructions', () => {
    it('should use vault root path when mediaFolder is empty', () => {
      const prompt = buildTurnOutputContract({ text: 'Analysiere @image.jpg' }, { mediaFolder: '' });
      expect(prompt).toContain('Located in media folder: `.`');
      expect(prompt).toContain('Read file_path="image.jpg"');
    });

    it('should use vault root path when mediaFolder is whitespace only', () => {
      const prompt = buildTurnOutputContract({ text: 'Analysiere @image.jpg' }, { mediaFolder: '   ' });
      expect(prompt).toContain('Located in media folder: `.`');
    });

    it('should use custom mediaFolder path when provided', () => {
      const prompt = buildTurnOutputContract({ text: 'Analysiere @image.jpg' }, { mediaFolder: 'attachments' });
      expect(prompt).toContain('Located in media folder: `./attachments`');
      expect(prompt).toContain('Read file_path="attachments/image.jpg"');
    });

    it('should handle mediaFolder with special characters', () => {
      const prompt = buildTurnOutputContract({ text: 'Analysiere @image.jpg' }, { mediaFolder: '- attachments' });
      expect(prompt).toContain('Located in media folder: `./- attachments`');
      expect(prompt).toContain('Read file_path="- attachments/image.jpg"');
    });

    it('should include external image handling instructions', () => {
      const prompt = buildTurnOutputContract({ text: 'Analysiere @image.jpg' }, { mediaFolder: 'media' });
      expect(prompt).toContain('WebFetch does NOT support images');
      expect(prompt).toContain('Download to media folder');
      expect(prompt).toContain('curl');
      expect(prompt).toContain('replace the markdown link');
    });
  });

  describe('getInlineEditSystemPrompt', () => {
    it('should include inline edit critical output rules', () => {
      const prompt = getInlineEditSystemPrompt();
      expect(prompt).toContain('ABSOLUTE RULE');
      expect(prompt).toContain('<replacement>');
    });

    it('should include read-only tool descriptions', () => {
      const prompt = getInlineEditSystemPrompt();
      expect(prompt).toContain('Read, Grep, Glob, LS, WebSearch, WebFetch');
      expect(prompt).toContain('read-only');
    });

    it('should include example scenarios', () => {
      const prompt = getInlineEditSystemPrompt();
      expect(prompt).toContain('translate to French');
      expect(prompt).toContain('Bonjour le monde');
      expect(prompt).toContain('asking for clarification');
    });

    it('should include date from utils', () => {
      const prompt = getInlineEditSystemPrompt();
      expect(prompt).toContain('Mocked Date');
    });

  });

  describe('computeSystemPromptKey', () => {
    it('computes key from all settings', () => {
      const settings = {
        mediaFolder: 'attachments',
        customPrompt: 'Be helpful',
        vaultPath: '/vault',
        userName: 'Alice',
      };

      const key = computeSystemPromptKey(settings);

      expect(key).toBe('presentation-contract-v3::Be helpful::/vault::Alice');
    });

    it('handles empty or undefined values', () => {
      const key = computeSystemPromptKey({
        mediaFolder: '',
        customPrompt: '',
        vaultPath: '',
        userName: '',
      });

      expect(key).toBe('presentation-contract-v3::::::');
    });
  });
});
