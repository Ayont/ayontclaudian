/** Escapes a value that will sit inside a double-quoted XML attribute. */
export function escapePromptXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Neutralizes a forged `</tag>` so user-controlled body text cannot close the envelope. */
export function escapePromptXmlClosingTags(value: string, tag: string): string {
  const pattern = new RegExp(`</${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`, 'gi');
  return value.replace(pattern, `&lt;/${tag}&gt;`);
}
