/** Convert snake_case string to camelCase */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Recursively convert all snake_case keys in an object/array to camelCase */
export function camelCaseKeys<T = unknown>(input: unknown): T {
  if (Array.isArray(input)) {
    return input.map((item) => camelCaseKeys(item)) as T;
  }
  if (input !== null && typeof input === 'object' && !(input instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      result[snakeToCamel(key)] = camelCaseKeys(value);
    }
    return result as T;
  }
  return input as T;
}
