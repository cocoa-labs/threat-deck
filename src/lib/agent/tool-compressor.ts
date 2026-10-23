import { type CompressionResult, StoragePolicy } from './types';

/**
 * ToolResultCompressor - 3-tier compression for tool outputs.
 * Ported from Klammer Studio Python `tools/tool_result_compressor.py`.
 *
 * Tiers:
 * - FULL: Store complete result (within budget)
 * - SUMMARY: Extract key fields only
 * - MINIMAL: Count + first few items only
 */
// biome-ignore lint/complexity/noStaticOnlyClass: ported from Python Klammer, refactoring would change import patterns
export class ToolResultCompressor {
  private static readonly CHARS_PER_TOKEN = 4;

  /**
   * Compress a tool result to fit within a token budget.
   */
  static compress(_toolName: string, result: unknown, tokenBudget: number): CompressionResult {
    const serialized = JSON.stringify(result);
    const originalSize = Math.ceil(serialized.length / ToolResultCompressor.CHARS_PER_TOKEN);

    // If within budget, return full result
    if (originalSize <= tokenBudget) {
      return {
        data: result,
        policy: StoragePolicy.FULL,
        originalSize,
        compressedSize: originalSize,
      };
    }

    // Try summary compression
    const summary = ToolResultCompressor.summarize(result, tokenBudget);
    const summarySize = Math.ceil(
      JSON.stringify(summary).length / ToolResultCompressor.CHARS_PER_TOKEN,
    );

    if (summarySize <= tokenBudget) {
      return {
        data: summary,
        policy: StoragePolicy.SUMMARY,
        originalSize,
        compressedSize: summarySize,
      };
    }

    // Fall back to minimal
    const minimal = ToolResultCompressor.minimize(result, tokenBudget);
    const minimalSize = Math.ceil(
      JSON.stringify(minimal).length / ToolResultCompressor.CHARS_PER_TOKEN,
    );

    return {
      data: minimal,
      policy: StoragePolicy.MINIMAL,
      originalSize,
      compressedSize: minimalSize,
    };
  }

  /**
   * Extract key fields from arrays and objects.
   */
  private static summarize(data: unknown, budget: number): unknown {
    if (Array.isArray(data)) {
      // Keep first N items based on budget
      const maxItems = Math.min(data.length, Math.max(5, Math.floor(budget / 100)));

      return {
        _compressed: true,
        _policy: 'summary',
        _total: data.length,
        _showing: maxItems,
        items: data.slice(0, maxItems).map((item) => ToolResultCompressor.extractKeyFields(item)),
      };
    }

    if (data && typeof data === 'object') {
      return ToolResultCompressor.extractKeyFields(data);
    }

    return data;
  }

  /**
   * Minimal representation: counts and first items.
   */
  private static minimize(data: unknown, _budget: number): unknown {
    if (Array.isArray(data)) {
      return {
        _compressed: true,
        _policy: 'minimal',
        _total: data.length,
        _showing: Math.min(3, data.length),
        items: data.slice(0, 3).map((item) => {
          if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            // Keep only the most essential fields
            const essential: Record<string, unknown> = {};
            for (const key of ['id', 'name', 'title', 'symbol', 'value', 'status', 'severity']) {
              if (key in obj) essential[key] = obj[key];
            }
            return Object.keys(essential).length > 0 ? essential : obj;
          }
          return item;
        }),
      };
    }

    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const essential: Record<string, unknown> = {
        _compressed: true,
        _policy: 'minimal',
      };
      // Keep only scalar values and short strings
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'number' || typeof value === 'boolean') {
          essential[key] = value;
        } else if (typeof value === 'string' && value.length < 100) {
          essential[key] = value;
        }
      }
      return essential;
    }

    return data;
  }

  /**
   * Extract key fields from an object, dropping large nested structures.
   */
  private static extractKeyFields(data: unknown): unknown {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.slice(0, 5);

    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;

      if (typeof value === 'string') {
        // Truncate long strings
        result[key] = value.length > 200 ? `${value.slice(0, 200)}...` : value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        result[key] = value;
      } else if (Array.isArray(value)) {
        // Include count and first 3 items
        result[key] = {
          _count: value.length,
          _sample: value.slice(0, 3),
        };
      }
      // Skip deeply nested objects
    }

    return result;
  }
}
