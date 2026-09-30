/**
 * The database's own message of `error`, whichever client raised it: Prisma's driver adapter keeps it as the cause's
 * `originalMessage`, Drizzle wraps the driver's error as "Failed query: <the whole statement>" with the database's in
 * its `cause` (PGlite's one level deeper), so the innermost cause's message is the database's.
 */
export function databaseMessage(error: unknown): string {
  const adapter = (error as { meta?: { driverAdapterError?: { cause?: { originalMessage?: unknown } } } } | null)?.meta?.driverAdapterError?.cause?.originalMessage;
  if (typeof adapter === 'string' && adapter.length > 0) {
    return adapter;
  }

  let innermost = error;
  for (let depth = 0; depth < 8; depth++) {
    const cause = (innermost as { cause?: unknown } | null)?.cause;
    if (typeof cause !== 'object' || cause === null || typeof (cause as { message?: unknown }).message !== 'string') {
      break;
    }
    innermost = cause;
  }
  return String((innermost as { message?: unknown } | null)?.message ?? innermost);
}
