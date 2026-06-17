import { createMockEl } from '@test/helpers/mockElement';

import type { ClassifiedError } from '@/features/chat/rendering/errorClassification';
import { renderStatusCard } from '@/features/chat/rendering/StatusCardRenderer';

function classified(partial: Partial<ClassifiedError>): ClassifiedError {
  return {
    severity: 'error',
    title: 'Something went wrong',
    explanation: 'A clear explanation.',
    hint: 'Try this.',
    retryable: false,
    isLimit: false,
    raw: 'raw_error_token',
    providerId: 'kimi',
    ...partial,
  };
}

describe('renderStatusCard', () => {
  let parent: any;

  beforeEach(() => {
    jest.clearAllMocks();
    parent = createMockEl('div');
  });

  it('renders an error card with role=alert', () => {
    renderStatusCard(parent, classified({ severity: 'error' }));
    const card = parent.querySelector('.claudian-status-card--error');
    expect(card).not.toBeNull();
    expect(card.getAttribute('role')).toBe('alert');
  });

  it('renders a warning card with role=status and aria-live=polite', () => {
    renderStatusCard(parent, classified({ severity: 'warning' }));
    const card = parent.querySelector('.claudian-status-card--warning');
    expect(card.getAttribute('role')).toBe('status');
    expect(card.getAttribute('aria-live')).toBe('polite');
  });

  it('renders an info card with aria-live=polite', () => {
    renderStatusCard(parent, classified({ severity: 'info' }));
    const card = parent.querySelector('.claudian-status-card--info');
    expect(card.getAttribute('aria-live')).toBe('polite');
  });

  it('renders title, explanation and hint in distinct elements', () => {
    renderStatusCard(parent, classified({ title: 'Limit reached', explanation: 'You hit the limit.', hint: 'Wait or switch.' }));
    expect(parent.querySelector('.claudian-status-card-title').textContent).toBe('Limit reached');
    expect(parent.querySelector('.claudian-status-card-explanation').textContent).toBe('You hit the limit.');
    expect(parent.querySelector('.claudian-status-card-hint-text').textContent).toBe('Wait or switch.');
  });

  it('renders the limit badge only when isLimit is true', () => {
    renderStatusCard(parent, classified({ isLimit: true, severity: 'warning' }));
    expect(parent.querySelector('.claudian-status-card-badge')).not.toBeNull();

    const other = createMockEl('div');
    renderStatusCard(other, classified({ isLimit: false }));
    expect(other.querySelector('.claudian-status-card-badge')).toBeNull();
  });

  it('renders a collapsible raw-details disclosure containing the original text', () => {
    renderStatusCard(parent, classified({ explanation: 'Friendly text', raw: 'cryptic_raw_token' }));
    const details = parent.querySelector('.claudian-status-card-raw');
    expect(details).not.toBeNull();
    expect(parent.querySelector('.claudian-status-card-raw-body').textContent).toBe('cryptic_raw_token');
  });

  it('omits the raw disclosure when raw equals the explanation (notice case)', () => {
    renderStatusCard(parent, classified({ explanation: 'same text', raw: 'same text', hint: '' }));
    expect(parent.querySelector('.claudian-status-card-raw')).toBeNull();
  });

  it('sets raw content as text (no HTML injection)', () => {
    renderStatusCard(parent, classified({ explanation: 'x', raw: '<img src=x onerror=alert(1)>' }));
    const body = parent.querySelector('.claudian-status-card-raw-body');
    // text option sets textContent; the markup is preserved verbatim, not parsed.
    expect(body.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(body.children.length).toBe(0);
  });
});
