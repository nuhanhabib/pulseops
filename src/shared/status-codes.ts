/**
 * Expected-status expressions, e.g. "200-299,301,404".
 *
 * Kept isomorphic and dependency-free: the browser uses it for instant form
 * feedback, the API to validate, and the worker to judge every response.
 */
export interface StatusRange {
  from: number;
  to: number;
}

const MIN_STATUS = 100;
const MAX_STATUS = 599;
const MAX_PARTS = 20;

export type StatusExpressionResult = { ok: true; ranges: StatusRange[] } | { ok: false; error: string };

export function parseStatusExpression(expression: string): StatusExpressionResult {
  const parts = expression
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return { ok: false, error: "Enter at least one status code, e.g. 200-299." };
  if (parts.length > MAX_PARTS) return { ok: false, error: `Use at most ${MAX_PARTS} codes or ranges.` };

  const ranges: StatusRange[] = [];
  for (const part of parts) {
    const match = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(part);
    if (!match) return { ok: false, error: `"${part}" is not a status code or range like 200-299.` };
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < MIN_STATUS || to > MAX_STATUS) {
      return { ok: false, error: `Status codes must be between ${MIN_STATUS} and ${MAX_STATUS}.` };
    }
    if (from > to) return { ok: false, error: `Range "${part}" is reversed.` };
    ranges.push({ from, to });
  }
  return { ok: true, ranges };
}

export function isValidStatusExpression(expression: string): boolean {
  return parseStatusExpression(expression).ok;
}

/** Canonical form: trimmed, sorted, de-duplicated. Stored in the database. */
export function normalizeStatusExpression(expression: string): string {
  const parsed = parseStatusExpression(expression);
  if (!parsed.ok) return expression.trim();
  const seen = new Set<string>();
  return parsed.ranges
    .slice()
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((range) => (range.from === range.to ? String(range.from) : `${range.from}-${range.to}`))
    .filter((text) => (seen.has(text) ? false : (seen.add(text), true)))
    .join(",");
}

export function matchesExpectedStatus(expression: string, statusCode: number): boolean {
  const parsed = parseStatusExpression(expression);
  if (!parsed.ok) return false;
  return parsed.ranges.some((range) => statusCode >= range.from && statusCode <= range.to);
}
