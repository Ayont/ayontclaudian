import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import { shouldRaiseTabAttention, tabAttentionNotice } from '@/features/chat/tabs/tabAttention';

describe('shouldRaiseTabAttention', () => {
  it('raises attention for a tab the user is not looking at', () => {
    expect(shouldRaiseTabAttention({ isActive: false, isChatVisible: true, isClosing: false })).toBe(true);
  });

  it('raises attention for the active tab while the whole chat is hidden', () => {
    expect(shouldRaiseTabAttention({ isActive: true, isChatVisible: false, isClosing: false })).toBe(true);
  });

  it('stays quiet for the tab the user is looking at', () => {
    expect(shouldRaiseTabAttention({ isActive: true, isChatVisible: true, isClosing: false })).toBe(false);
  });

  it('never raises attention for a tab that is being closed', () => {
    expect(shouldRaiseTabAttention({ isActive: false, isChatVisible: true, isClosing: true })).toBe(false);
  });
});

describe('background tab notices', () => {
  it('are opt-in: the badge and the overview already carry the state', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.notifyOnBackgroundTabDone).toBe(false);
  });
});

describe('tabAttentionNotice', () => {
  it('names the chat and what happened, in German', () => {
    expect(tabAttentionNotice('Firewall CERTUSS', 'finished')).toBe('„Firewall CERTUSS“ ist fertig');
    expect(tabAttentionNotice('Firewall CERTUSS', 'failed')).toBe('„Firewall CERTUSS“ ist fehlgeschlagen');
    expect(tabAttentionNotice('Firewall CERTUSS', 'input')).toBe('„Firewall CERTUSS“ wartet auf dich');
  });
});
