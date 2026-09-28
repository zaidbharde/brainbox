/**
 * engine/assembler/symbols.ts — names to values, addresses and segment names.
 *
 * The table is populated during the first pass and consulted during the second.
 * A name that is referenced before it is defined is recorded as an *undefined*
 * symbol rather than an immediate error, which is what makes forward jumps and
 * forward data references work.
 */

import type { DiagnosticBag } from "./diagnostics";

export type SymbolKind = "equate" | "label" | "variable" | "segment" | "proc";

export interface Symbol {
  name: string;
  kind: SymbolKind;
  /** Equate value, or the offset within the defining segment. */
  value: number;
  /** Segment the name belongs to; `undefined` for equates. */
  segment?: string;
  /** Declared width for `DB`/`DW` data. */
  size?: 8 | 16;
  line: number;
  column: number;
  /** False while the name is still waiting to be defined in this pass. */
  defined: boolean;
  /**
   * True once the name has a real value, from this pass or an earlier one.
   *
   * This is deliberately separate from `defined`. `defined` is reset at the
   * start of every pass so that a redefinition is not reported as a duplicate,
   * but a forward reference on pass 2 must still read the address that pass 1
   * computed. Keeping the value means the second pass can resolve a jump
   * target that appears *after* the jump, which is the whole point of two
   * passes.
   */
  valueKnown?: boolean;
}

export function symbolKey(name: string): string {
  return name.toUpperCase();
}

export class SymbolTable {
  private readonly entries = new Map<string, Symbol>();

  /** Names in definition order, for the listing and the debugger. */
  order: string[] = [];

  lookup(name: string): Symbol | undefined {
    return this.entries.get(symbolKey(name));
  }

  has(name: string): boolean {
    return this.entries.has(symbolKey(name));
  }

  /** Record a forward reference seen before the definition. */
  reference(name: string, line: number, column: number): void {
    const key = symbolKey(name);
    if (this.entries.has(key)) return;
    this.entries.set(key, {
      name: key,
      kind: "label",
      value: 0,
      line,
      column,
      defined: false,
      valueKnown: false,
    });
  }

  /**
   * Define a name. Redefinition is an error, but an equate forward-reference
   * placeholder is overwritten silently, since that is the normal case for
   * `x = y` where `y` is defined further down the file.
   */
  define(symbol: Symbol, diagnostics: DiagnosticBag): void {
    const key = symbolKey(symbol.name);
    const existing = this.entries.get(key);
    if (existing?.defined) {
      diagnostics.error(symbol.line, symbol.column, `symbol ${key} is already defined`);
      return;
    }
    this.entries.set(key, { ...symbol, name: key, defined: true, valueKnown: true });
    this.order.push(key);
  }

  /** Every defined symbol, in definition order. */
  all(): Symbol[] {
    return this.order
      .map((key) => this.entries.get(key))
      .filter((s): s is Symbol => s?.defined === true);
  }

  /** Names still without a value once assembly has finished. */
  undefinedNames(): Symbol[] {
    const result: Symbol[] = [];
    for (const symbol of this.entries.values()) {
      if (!symbol.valueKnown) result.push(symbol);
    }
    return result;
  }

  /** Every name that has a value, for comparing one pass against the next. */
  addresses(): Map<string, number> {
    const result = new Map<string, number>();
    for (const [key, symbol] of this.entries) {
      if (symbol.valueKnown) result.set(key, symbol.value);
    }
    return result;
  }

  /**
   * Start a new pass. `defined` is cleared so that redefining a label on the
   * second pass is not reported as a duplicate, but the value each name was
   * given stays: that is what lets pass 2 resolve forward references.
   */
  beginPass(): void {
    for (const symbol of this.entries.values()) symbol.defined = false;
  }
}
