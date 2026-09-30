import { isDeepStrictEqual } from 'node:util';

/** A random pause of up to 4 ms, to shuffle the calls a race starts together. */
export const jitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 4));

export function show(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v === undefined ? '<undefined>' : typeof v === 'bigint' ? `${v}n` : v)) ?? String(value);
}

export function equal(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${label}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

/** What `promise` rejects with; throws when it resolves. */
export async function rejection(promise: Promise<unknown>, label: string): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error(`${label}: expected a rejection`);
}

/** The error's message and its causes' (Drizzle wraps a driver's error as "Failed query: ..."). */
export function messages(error: unknown): string {
  const parts: string[] = [];
  for (let current = error, depth = 0; current !== undefined && current !== null && depth < 5; current = (current as { cause?: unknown }).cause, depth++) {
    parts.push(String((current as Error).message ?? current));
  }
  return parts.join(' / ');
}

export function isTypeError(error: unknown, label: string): void {
  if (!(error instanceof TypeError)) {
    throw new Error(`${label}: expected a TypeError, got ${error instanceof Error ? `${error.name}: ${error.message}` : show(error)}`);
  }
}
