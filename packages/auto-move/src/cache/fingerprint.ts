/** FNV-1a 32-bit — enough to detect an edited note or a changed candidate list. */
export function contentFingerprint(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
