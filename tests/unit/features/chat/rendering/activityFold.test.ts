import { buildActivityLabels } from '@/features/chat/rendering/activityFold';

describe('local proposal activity labels', () => {
  it('does not claim a denied or pending local proposal was executed', () => {
    expect(buildActivityLabels(1, 1, 0, ['Local run'], 'de').title).toBe('1 lokale Werkzeuganfrage');
    expect(buildActivityLabels(2, 2, 0, ['Local write', 'Local run'], 'de').title).toBe('2 lokale Werkzeuganfragen');
  });
  it('preserves ordinary coding provider labels', () => {
    expect(buildActivityLabels(1, 1, 0, ['Bash'], 'de').title).toBe('1 Coding-Aktion ausgeführt');
  });
});
