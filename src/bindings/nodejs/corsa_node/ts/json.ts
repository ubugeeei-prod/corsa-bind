/** Parses a JSON payload returned by the native binding into a typed value. */
export function fromJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

/**
 * Serializes optional request parameters for native methods.
 *
 * Native endpoints expect a JSON string even for omitted payloads, so `undefined`
 * is normalized to JSON `null` before crossing the napi boundary.
 */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
