/**
 * Extract the BLUF (Bottom Line Up Front) summary from a SITREP markdown response.
 * Falls back to the first non-header paragraph. Truncates to ~200 chars.
 */
export function extractBluf(markdown: string): string {
  if (!markdown) return '';

  // Try to find text between ## BLUF and the next ## header
  const blufMatch = markdown.match(/##\s*BLUF\s*\n([\s\S]*?)(?=\n##\s|\n---|\n$|$)/i);
  if (blufMatch?.[1]) {
    const text = blufMatch[1].trim().replace(/\*\*/g, '').replace(/\*/g, '');
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
  }

  // Fallback: first non-empty, non-header paragraph
  const lines = markdown.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('---')) continue;
    if (trimmed.startsWith('|')) continue;

    const clean = trimmed.replace(/\*\*/g, '').replace(/\*/g, '');
    return clean.length > 200 ? `${clean.slice(0, 197)}...` : clean;
  }

  return '';
}
