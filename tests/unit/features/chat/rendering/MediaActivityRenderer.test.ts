/** @jest-environment jsdom */
import { createMockEl } from '@test/helpers/mockElement';
import { setIcon } from 'obsidian';

import type { ToolCallInfo } from '@/core/types';
import {
  describeMediaActivity,
  getMediaKindFromPath,
  isMediaToolName,
  openMediaModal,
  renderMediaContent,
  resolveMediaActivity,
  resolveMediaResourceUrl,
} from '@/features/chat/rendering/MediaActivityRenderer';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
  normalizePath: jest.fn((p: string) => p),
}));

describe('MediaActivityRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('getMediaKindFromPath', () => {
    it('detects image extensions and data URIs', () => {
      expect(getMediaKindFromPath('photo.jpg')).toBe('image');
      expect(getMediaKindFromPath('/path/to/diagram.PNG')).toBe('image');
      expect(getMediaKindFromPath('icon.svg')).toBe('image');
      expect(getMediaKindFromPath('anim.webp')).toBe('image');
      expect(getMediaKindFromPath('data:image/png;base64,iVBORw0KGgo=')).toBe('image');
    });

    it('detects video extensions', () => {
      expect(getMediaKindFromPath('demo.mp4')).toBe('video');
      expect(getMediaKindFromPath('/vault/screencast.webm')).toBe('video');
      expect(getMediaKindFromPath('movie.mov')).toBe('video');
    });

    it('detects audio extensions', () => {
      expect(getMediaKindFromPath('voice.mp3')).toBe('audio');
      expect(getMediaKindFromPath('record.wav')).toBe('audio');
      expect(getMediaKindFromPath('podcast.m4a')).toBe('audio');
    });

    it('detects PDF documents', () => {
      expect(getMediaKindFromPath('paper.pdf')).toBe('pdf');
      expect(getMediaKindFromPath('data:application/pdf;base64,JVBERi0=')).toBe('pdf');
    });

    it('returns null for non-media files', () => {
      expect(getMediaKindFromPath('main.ts')).toBeNull();
      expect(getMediaKindFromPath('notes.md')).toBeNull();
      expect(getMediaKindFromPath('data.json')).toBeNull();
      expect(getMediaKindFromPath('')).toBeNull();
    });
  });

  describe('isMediaToolName', () => {
    it('identifies media inspection and analysis tools', () => {
      expect(isMediaToolName('analyze_image')).toBe(true);
      expect(isMediaToolName('show_image')).toBe(true);
      expect(isMediaToolName('view_image')).toBe(true);
      expect(isMediaToolName('read_image')).toBe(true);
      expect(isMediaToolName('inspect_image')).toBe(true);
      expect(isMediaToolName('image_analysis')).toBe(true);
      expect(isMediaToolName('Read')).toBe(false);
      expect(isMediaToolName('Bash')).toBe(false);
    });
  });

  describe('resolveMediaActivity', () => {
    it('resolves named media tools with target path', () => {
      const activity = resolveMediaActivity('analyze_image', { file_path: '/tmp/screenshot.png' });
      expect(activity).not.toBeNull();
      expect(activity?.kind).toBe('image');
      expect(activity?.action).toBe('analyze');
      expect(activity?.fileName).toBe('screenshot.png');
      expect(activity?.extension).toBe('PNG');
    });

    it('resolves generic read tool when targeting an image', () => {
      const activity = resolveMediaActivity('Read', { file_path: 'attachments/mockup.jpg' });
      expect(activity).not.toBeNull();
      expect(activity?.kind).toBe('image');
      expect(activity?.action).toBe('read');
      expect(activity?.fileName).toBe('mockup.jpg');
      expect(activity?.extension).toBe('JPG');
    });

    it('resolves video analysis tool', () => {
      const activity = resolveMediaActivity('show_video', { url: 'https://example.com/demo.mp4' });
      expect(activity).not.toBeNull();
      expect(activity?.kind).toBe('video');
      expect(activity?.action).toBe('view');
      expect(activity?.fileName).toBe('demo.mp4');
      expect(activity?.extension).toBe('MP4');
    });

    it('returns null for generic tools on non-media files', () => {
      expect(resolveMediaActivity('Read', { file_path: 'src/index.ts' })).toBeNull();
      expect(resolveMediaActivity('Write', { file_path: 'notes.md' })).toBeNull();
    });
  });

  describe('describeMediaActivity', () => {
    it('provides clear localized labels and icons', () => {
      const imgActivity = resolveMediaActivity('analyze_image', { file_path: 'cat.png' })!;
      expect(describeMediaActivity(imgActivity, 'de')).toEqual({
        title: 'Bild analysieren',
        detail: 'cat.png',
        icon: 'image',
      });
      expect(describeMediaActivity(imgActivity, 'en')).toEqual({
        title: 'Analyze image',
        detail: 'cat.png',
        icon: 'image',
      });

      const showActivity = resolveMediaActivity('show_image', { file_path: 'photo.jpg' })!;
      expect(describeMediaActivity(showActivity, 'de')).toEqual({
        title: 'Bild anzeigen',
        detail: 'photo.jpg',
        icon: 'image',
      });
      expect(describeMediaActivity(showActivity, 'en')).toEqual({
        title: 'View image',
        detail: 'photo.jpg',
        icon: 'image',
      });

      const videoActivity = resolveMediaActivity('view_video', { file_path: 'clip.mp4' })!;
      expect(describeMediaActivity(videoActivity, 'de')).toEqual({
        title: 'Video ansehen',
        detail: 'clip.mp4',
        icon: 'video',
      });
      expect(describeMediaActivity(videoActivity, 'en')).toEqual({
        title: 'View video',
        detail: 'clip.mp4',
        icon: 'video',
      });
    });
  });

  describe('resolveMediaResourceUrl', () => {
    it('passes web URLs and data URIs through unchanged', () => {
      expect(resolveMediaResourceUrl('https://example.com/pic.png')).toBe('https://example.com/pic.png');
      expect(resolveMediaResourceUrl('data:image/png;base64,123')).toBe('data:image/png;base64,123');
    });

    it('returns file URL for absolute paths outside vault', () => {
      const res = resolveMediaResourceUrl('/tmp/image.png');
      expect(res.startsWith('file://') || res === '/tmp/image.png').toBe(true);
    });
  });

  describe('renderMediaContent', () => {
    function createToolCall(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
      return {
        id: 'media-1',
        name: 'analyze_image',
        input: { file_path: '/vault/photo.jpg' },
        status: 'completed',
        result: 'Auf dem Bild ist eine Berglandschaft im Sonnenuntergang zu sehen.',
        ...overrides,
      };
    }

    it('renders running state with pulsing indicator', () => {
      const container = createMockEl();
      const toolCall = createToolCall({ status: 'running' });
      const activity = resolveMediaActivity(toolCall.name, toolCall.input)!;

      renderMediaContent(container, toolCall, activity, true);

      const runningEl = container.querySelector('.claudian-media-running');
      expect(runningEl).not.toBeNull();
      expect(container.querySelector('.claudian-media-running-text')?.textContent).toContain('wird analysiert');
    });

    it('renders completed image card with format badge, action buttons, image element, and model analysis', () => {
      const container = createMockEl();
      const toolCall = createToolCall();
      const activity = resolveMediaActivity(toolCall.name, toolCall.input)!;

      renderMediaContent(container, toolCall, activity, false);

      expect(container.querySelector('.claudian-media-title')?.textContent).toBe('photo.jpg');
      expect(container.querySelector('.claudian-media-badge')?.textContent).toBe('JPG');

      const img = container.querySelector('.claudian-media-preview-img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('alt') || img.alt).toBe('photo.jpg');

      const captionBody = container.querySelector('.claudian-media-caption-body');
      expect(captionBody?.textContent).toContain('Berglandschaft im Sonnenuntergang');
      expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'maximize-2');
      expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'copy');
    });

    it('renders video player when media kind is video', () => {
      const container = createMockEl();
      const toolCall = createToolCall({
        name: 'view_video',
        input: { file_path: 'intro.mp4' },
      });
      const activity = resolveMediaActivity(toolCall.name, toolCall.input)!;

      renderMediaContent(container, toolCall, activity, false);

      const video = container.querySelector('.claudian-media-preview-video');
      expect(video).not.toBeNull();
    });

    it('filters out raw base64 data dumps from caption', () => {
      const container = createMockEl();
      const rawBase64 = 'data:image/png;base64,' + 'A'.repeat(200);
      const toolCall = createToolCall({ result: rawBase64 });
      const activity = resolveMediaActivity(toolCall.name, toolCall.input)!;

      renderMediaContent(container, toolCall, activity, false);

      expect(container.querySelector('.claudian-media-caption')).toBeNull();
    });
  });

  describe('openMediaModal', () => {
    it('creates modal overlay and closes on close button click', () => {
      openMediaModal({
        src: 'file:///tmp/diagram.png',
        title: 'diagram.png (Bild analysieren)',
        kind: 'image',
      });

      const overlay = document.querySelector('.claudian-image-modal-overlay');
      expect(overlay).not.toBeNull();
      const modal = overlay?.querySelector('.claudian-image-modal');
      expect(modal).not.toBeNull();
      expect(modal?.querySelector('img')).not.toBeNull();

      const closeBtn = modal?.querySelector('.claudian-image-modal-close') as HTMLElement;
      closeBtn.click();
      expect(document.querySelector('.claudian-image-modal-overlay')).toBeNull();
    });

    it('closes modal on Escape key', () => {
      openMediaModal({
        src: 'file:///tmp/diagram.png',
        title: 'diagram.png',
      });

      expect(document.querySelector('.claudian-image-modal-overlay')).not.toBeNull();
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escEvent);
      expect(document.querySelector('.claudian-image-modal-overlay')).toBeNull();
    });
  });
});
