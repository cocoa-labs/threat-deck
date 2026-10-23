/**
 * Tolerant JSON extractor for LLM outputs.
 *
 * LLMs are instructed to return strict JSON but routinely violate the contract
 * in three observed ways:
 *   1. Pure JSON                — `{"a": 1, "b": "x"}`           (the happy case)
 *   2. Markdown-fenced JSON     — ` ```json\n{"a": 1}\n``` `
 *   3. JSON embedded in prose   — `Sure! Here's the result: {"a": 1}.`
 *
 * `extractJsonObject` returns the first balanced JSON object found in any of
 * those dialects, or `null` if no valid object is present. Callers are
 * responsible for SHAPE validation (e.g., required fields, value ranges) on
 * the returned value.
 *
 * Used by:
 *   - `src/lib/ai-relevance/haiku.ts`     (Phase 9.2 — AI-relevance scorer)
 *   - `src/lib/twitter/content/llm.ts`    (Phase 9.4 — Twitter draft generators)
 */

/** Parse a Markdown-fence-tolerant LLM response into the first JSON object found. */
export function extractJsonObject(raw: string): unknown | null {
  let candidate = raw.trim();

  // Strip ```json / ``` fences if present.
  candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');

  // If still not pure JSON, find the first balanced { ... } block.
  if (!candidate.startsWith('{')) {
    const startIdx = candidate.indexOf('{');
    if (startIdx === -1) return null;
    const endIdx = findMatchingBrace(candidate, startIdx);
    if (endIdx === -1) return null;
    candidate = candidate.slice(startIdx, endIdx + 1);
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * Walk a string from `start` (pointing at a `{`) to the matching `}` while
 * respecting JSON string escape semantics. Returns the index of the close
 * brace, or -1 if no balanced close is found.
 */
function findMatchingBrace(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') isEscaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
