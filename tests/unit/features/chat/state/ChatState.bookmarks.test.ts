import { ChatState } from '@/features/chat/state/ChatState';

describe('ChatState bookmarks', () => {
  it('starts with no bookmarks', () => {
    const state = new ChatState();
    expect(state.bookmarkedMessageIds).toEqual([]);
    expect(state.isBookmarked('m1')).toBe(false);
  });

  it('toggles a bookmark on and off', () => {
    const state = new ChatState();

    state.toggleBookmark('m1');
    expect(state.isBookmarked('m1')).toBe(true);
    expect(state.bookmarkedMessageIds).toEqual(['m1']);

    state.toggleBookmark('m1');
    expect(state.isBookmarked('m1')).toBe(false);
    expect(state.bookmarkedMessageIds).toEqual([]);
  });

  it('supports multiple bookmarks', () => {
    const state = new ChatState();

    state.toggleBookmark('m1');
    state.toggleBookmark('m2');

    expect(state.bookmarkedMessageIds).toEqual(['m1', 'm2']);
    expect(state.isBookmarked('m1')).toBe(true);
    expect(state.isBookmarked('m2')).toBe(true);
    expect(state.isBookmarked('m3')).toBe(false);
  });

  it('fires onBookmarksChanged when bookmarks change', () => {
    const onBookmarksChanged = jest.fn();
    const state = new ChatState({ onBookmarksChanged });

    state.toggleBookmark('m1');
    expect(onBookmarksChanged).toHaveBeenCalledWith(['m1']);

    onBookmarksChanged.mockClear();
    state.toggleBookmark('m1');
    expect(onBookmarksChanged).toHaveBeenCalledWith([]);
  });

  it('fires onBookmarksChanged for every toggle', () => {
    const onBookmarksChanged = jest.fn();
    const state = new ChatState({ onBookmarksChanged });

    state.toggleBookmark('m1');
    onBookmarksChanged.mockClear();
    state.toggleBookmark('m1');
    state.toggleBookmark('m1');

    expect(onBookmarksChanged).toHaveBeenCalledTimes(2);
    expect(state.bookmarkedMessageIds).toEqual(['m1']);
  });

  it('returns a defensive copy of bookmarked ids', () => {
    const state = new ChatState();
    state.toggleBookmark('m1');

    const ids = state.bookmarkedMessageIds;
    ids.push('m2');

    expect(state.bookmarkedMessageIds).toEqual(['m1']);
  });

  it('clears bookmarks on resetForNewConversation', () => {
    const onBookmarksChanged = jest.fn();
    const state = new ChatState({ onBookmarksChanged });
    state.toggleBookmark('m1');
    onBookmarksChanged.mockClear();

    state.resetForNewConversation();

    expect(state.bookmarkedMessageIds).toEqual([]);
    expect(onBookmarksChanged).toHaveBeenCalledWith([]);
  });

  it('sets bookmarks from an array', () => {
    const onBookmarksChanged = jest.fn();
    const state = new ChatState({ onBookmarksChanged });

    state.bookmarkedMessageIds = ['m1', 'm2'];

    expect(state.bookmarkedMessageIds).toEqual(['m1', 'm2']);
    expect(onBookmarksChanged).toHaveBeenCalledWith(['m1', 'm2']);
  });
});
