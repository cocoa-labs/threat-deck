/**
 * Pure unit tests for the tolerant JSON extractor. Three observed LLM
 * output dialects plus a few common corruption modes.
 */

import { describe, expect, it } from 'vitest';
import { extractJsonObject } from './tolerant-json';

describe('extractJsonObject', () => {
  it('parses pure JSON', () => {
    const r = extractJsonObject('{"a": 1, "b": "hello"}');
    expect(r).toEqual({ a: 1, b: 'hello' });
  });

  it('strips ```json fences', () => {
    const r = extractJsonObject('```json\n{"a": 1}\n```');
    expect(r).toEqual({ a: 1 });
  });

  it('strips plain ``` fences', () => {
    const r = extractJsonObject('```\n{"a": 1}\n```');
    expect(r).toEqual({ a: 1 });
  });

  it('extracts JSON embedded in prose', () => {
    const r = extractJsonObject('Here\'s my answer: {"a": 1, "b": 2}. Hope that helps!');
    expect(r).toEqual({ a: 1, b: 2 });
  });

  it('handles nested objects', () => {
    const r = extractJsonObject('{"outer": {"inner": {"deep": true}}}');
    expect(r).toEqual({ outer: { inner: { deep: true } } });
  });

  it('handles braces inside string values', () => {
    const r = extractJsonObject('{"text": "this is {not} an object"}');
    expect(r).toEqual({ text: 'this is {not} an object' });
  });

  it('handles escaped quotes inside strings', () => {
    const r = extractJsonObject('{"text": "he said \\"hi\\""}');
    expect(r).toEqual({ text: 'he said "hi"' });
  });

  it('returns null for empty input', () => {
    expect(extractJsonObject('')).toBeNull();
  });

  it('returns null for prose with no JSON object', () => {
    expect(extractJsonObject('No object here, just words.')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractJsonObject('{this is not json}')).toBeNull();
  });

  it('returns null for unbalanced braces', () => {
    expect(extractJsonObject('{"a": 1')).toBeNull();
  });
});
