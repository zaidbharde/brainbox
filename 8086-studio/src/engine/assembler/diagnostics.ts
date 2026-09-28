/**
 * engine/assembler/diagnostics.ts — error and warning collection.
 *
 * Every diagnostic carries a line, a column and a message, which is what the
 * editor needs to draw a squiggle under the right character. The assembler
 * never throws on a source-level problem: it records a diagnostic and keeps
 * going, so a single run reports every mistake in the file rather than only
 * the first one.
 */

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  /** 1-based source line. */
  readonly line: number;
  /** 1-based source column. */
  readonly column: number;
  readonly message: string;
  /** Optional source excerpt, for the editor gutter. */
  readonly text?: string;
}

export function error(line: number, column: number, message: string, text?: string): Diagnostic {
  return { severity: "error", line, column, message, ...(text !== undefined ? { text } : {}) };
}

export function warning(line: number, column: number, message: string, text?: string): Diagnostic {
  return { severity: "warning", line, column, message, ...(text !== undefined ? { text } : {}) };
}

/**
 * Accumulates diagnostics. A cap keeps a pathological file (an unterminated
 * macro expanded thousands of times) from exhausting memory.
 */
export class DiagnosticBag {
  private readonly items: Diagnostic[] = [];

  constructor(private readonly limit = 500) {}

  add(diagnostic: Diagnostic): void {
    if (this.items.length < this.limit) this.items.push(diagnostic);
  }

  error(line: number, column: number, message: string, text?: string): void {
    this.add(error(line, column, message, text));
  }

  warning(line: number, column: number, message: string, text?: string): void {
    this.add(warning(line, column, message, text));
  }

  get all(): readonly Diagnostic[] {
    return this.items;
  }

  get errors(): Diagnostic[] {
    return this.items.filter((d) => d.severity === "error");
  }

  get warnings(): Diagnostic[] {
    return this.items.filter((d) => d.severity === "warning");
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }

  get truncated(): boolean {
    return this.items.length >= this.limit;
  }
}
