/** What drizzle-kit's migrator splits a migration file on, and runs each piece of on its own. */
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

/**
 * `statements` as one script under `header`'s comment lines: a statement per paragraph, each ending with a semicolon,
 * or, with `statementBreakpoints`, separated by drizzle-kit's `--> statement-breakpoint` as its generated files are.
 */
export function migrationScript(header: readonly string[], statements: readonly string[], statementBreakpoints = false): string {
  const separator = statementBreakpoints ? `\n${STATEMENT_BREAKPOINT}\n` : '\n\n';
  return `${header.join('\n')}\n\n${statements.map((statement) => `${statement};`).join(separator)}\n`;
}
