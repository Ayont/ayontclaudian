export function updateContextRowHasContent(contextRowEl: HTMLElement): void {
  const editorIndicator = contextRowEl.querySelector('.claudian-selection-indicator');
  const browserIndicator = contextRowEl.querySelector('.claudian-browser-selection-indicator');
  const canvasIndicator = contextRowEl.querySelector('.claudian-canvas-indicator');
  const fileIndicator = contextRowEl.querySelector('.claudian-file-indicator');
  const imagePreview = contextRowEl.querySelector('.claudian-image-preview');
  // Non-image attachment preview (PDF/DOCX/video/binary chips). MUST be checked
  // here too — otherwise dropping a PDF alone leaves the whole context row at
  // `display: none` and the chip stays invisible until an image is also attached.
  const attachmentPreview = contextRowEl.querySelector('.claudian-attachment-preview');

  const hasEditorSelection = !!editorIndicator && !editorIndicator.hasClass('claudian-hidden');
  const hasBrowserSelection = !!browserIndicator && !browserIndicator.hasClass('claudian-hidden');
  const hasCanvasSelection = !!canvasIndicator && !canvasIndicator.hasClass('claudian-hidden');
  const hasFileChips = !!fileIndicator && fileIndicator.hasClass('claudian-visible-flex');
  const hasImageChips = !!imagePreview && imagePreview.hasClass('claudian-visible-flex');
  const hasAttachmentChips = !!attachmentPreview && attachmentPreview.hasClass('claudian-visible-flex');

  contextRowEl.classList.toggle(
    'has-content',
    hasEditorSelection
      || hasBrowserSelection
      || hasCanvasSelection
      || hasFileChips
      || hasImageChips
      || hasAttachmentChips
  );
}
