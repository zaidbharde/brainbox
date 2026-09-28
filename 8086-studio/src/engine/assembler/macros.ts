/**
 * engine/assembler/macros.ts — `name MACRO ... ENDM` expansion.
 *
 * Expansion happens on the token stream, before statement parsing, so a macro
 * body is parsed by exactly the same code as ordinary source. Each expansion
 * appends a serial number to every label defined inside the body, so invoking a
 * macro twice produces two distinct labels instead of a duplicate-symbol error.
 */

import type { Token } from "./lexer";
import { DiagnosticBag } from "./diagnostics";

export interface MacroDefinition {
  name: string;
  /** Parameter names, upper-cased, in order. */
  parameters: string[];
  /** Body tokens, with the `name MACRO ...` line and the `ENDM` removed. */
  body: Token[];
  line: number;
  column: number;
}

export interface MacroExtraction {
  /** The token stream with macro definitions removed. */
  tokens: Token[];
  macros: Map<string, MacroDefinition>;
}

function isWord(token: Token | undefined, word: string): boolean {
  return token?.kind === "ident" && token.text.toUpperCase() === word;
}

/**
 * Remove `name MACRO params ... ENDM` blocks from the stream and record them.
 * Nested macro definitions are not supported, and are reported as an error.
 */
export function extractMacros(tokens: readonly Token[], diagnostics: DiagnosticBag): MacroExtraction {
  const out: Token[] = [];
  const macros = new Map<string, MacroDefinition>();
  const eof = tokens[tokens.length - 1];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const next = tokens[i + 1];

    if (token.kind === "ident" && isWord(next, "MACRO")) {
      const { line, column } = token;
      const name = token.text.toUpperCase();
      i += 2;

      // Parameter list, up to the end of the line.
      const parameters: string[] = [];
      const { line: headerLine, column: headerColumn } = token;
      while (i < tokens.length && tokens[i].line === headerLine) {
        if (tokens[i].kind === "ident" && !isWord(tokens[i], "MACRO")) {
          parameters.push(tokens[i].text.toUpperCase());
        }
        i++;
      }

      // Body, up to ENDM.
      const body: Token[] = [];
      let closed = false;
      while (i < tokens.length && tokens[i].kind !== "eof") {
        if (isWord(tokens[i], "ENDM")) {
          // Skip `ENDM` and any name that follows it on the same line.
          i++;
          while (i < tokens.length && tokens[i].line === tokens[i - 1]?.line) i++;
          closed = true;
          break;
        }
        body.push(tokens[i]);
        i++;
      }
      if (!closed) {
        diagnostics.error(line, column, `macro ${name} is missing its ENDM`);
      }
      if (macros.has(name)) {
        diagnostics.error(line, column, `macro ${name} is already defined`);
      }
      macros.set(name, { name, parameters, body, line, column: headerColumn });
      continue;
    }

    out.push(token);
    i++;
  }

  out.push(eof);
  return { tokens: out, macros };
}

/**
 * Expand macro invocations. An invocation is `name` (not a known directive)
 * followed by either whitespace-separated or parenthesised arguments.
 */
export function expandMacros(
  tokens: readonly Token[],
  macros: ReadonlyMap<string, MacroDefinition>,
  diagnostics: DiagnosticBag,
): Token[] {
  const out: Token[] = [];
  const eof = tokens[tokens.length - 1];
  const serial = new Map<string, number>();
  let i = 0;
  // Bounded so a self-recursive macro cannot hang the assembler.
  let budget = 100_000;

  while (i < tokens.length && tokens[i].kind !== "eof") {
    if (budget-- <= 0) {
      diagnostics.error(tokens[i].line, tokens[i].column, "macro expansion limit exceeded (recursion?)");
      break;
    }

    const token = tokens[i];
    if (token.kind !== "ident") {
      out.push(token);
      i++;
      continue;
    }

    const macro = macros.get(token.text.toUpperCase());
    if (!macro) {
      out.push(token);
      i++;
      continue;
    }

    // Gather arguments.
    let j = i + 1;
    const args: Token[][] = [];
    const parenthesised =
      tokens[j]?.kind === "punct" && tokens[j]?.text === "(";

    const endOfLine = token.line;
    if (parenthesised) {
      j++;
      let depth = 1;
      let current: Token[] = [];
      while (j < tokens.length && tokens[j].kind !== "eof") {
        const t = tokens[j];
        if (t.kind === "punct" && t.text === "(") depth++;
        if (t.kind === "punct" && t.text === ")") {
          depth--;
          if (depth === 0) {
            if (current.length > 0) args.push(current);
            j++;
            break;
          }
        }
        if (t.kind === "punct" && t.text === "," && depth === 1) {
          args.push(current);
          current = [];
          j++;
          continue;
        }
        if (!(t.kind === "punct" && t.text === "(")) current.push(t);
        j++;
      }
    } else {
      // Whitespace separated, to the end of the line.
      const perParam = macro.parameters.length;
      let collected = 0;
      while (j < tokens.length && tokens[j].kind !== "eof" && tokens[j].line === endOfLine) {
        const t = tokens[j];
        if (t.kind === "punct" && t.text === ",") {
          j++;
          continue;
        }
        if (collected >= perParam) break;
        // One argument runs to the next comma.
        const arg: Token[] = [];
        while (j < tokens.length && tokens[j].line === endOfLine && !(tokens[j].kind === "punct" && tokens[j].text === ",")) {
          arg.push(tokens[j]);
          j++;
        }
        if (arg.length === 0) break;
        args.push(arg);
        collected++;
      }
    }

    if (macro.parameters.length !== args.length) {
      diagnostics.error(
        token.line,
        token.column,
        `macro ${macro.name} takes ${macro.parameters.length} argument(s) but ${args.length} were given`,
      );
    }

    const serialNumber = (serial.get(macro.name) ?? 0) + 1;
    serial.set(macro.name, serialNumber);

    for (const bodyToken of substitute(macro, args, serialNumber, token)) out.push(bodyToken);
    i = j;
  }

  out.push(eof);
  return out;
}

/**
 * Copy the body with parameters replaced, then re-stamp every token onto the
 * call site.
 *
 * Re-stamping matters: tokens are grouped into statements by line number, so
 * leaving an argument tagged with the *call site's* line inside a body tagged
 * with the *definition's* line would split one instruction across two
 * statements. Line and column are the only position information a token has, so
 * the expansion is reported at the call site, which is also what the debugger
 * should highlight when a single macro call emits several instructions.
 */
function substitute(
  macro: MacroDefinition,
  args: Token[][],
  serial: number,
  callSite: Token,
): Token[] {
  const out: Token[] = [];
  for (const token of macro.body) {
    if (token.kind === "ident") {
      const paramIndex = macro.parameters.indexOf(token.text.toUpperCase());
      if (paramIndex >= 0) {
        const arg = args[paramIndex];
        if (arg && arg.length > 0) {
          out.push(...arg);
          continue;
        }
        // Missing argument: substitute a harmless zero so the body still parses
        // and the arity error is the only diagnostic.
        out.push({
          kind: "number",
          text: "0",
          value: 0,
          line: callSite.line,
          column: callSite.column,
          negative: false,
        });
        continue;
      }
    }
    out.push(token);
  }

  // Labels defined inside the body become unique per expansion, so invoking a
  // macro twice yields two labels instead of a duplicate-symbol error. A label
  // is an `ident` immediately followed by `:`. Their *references* have to be
  // renamed as well, otherwise `JMP local` inside the body would still point at
  // a name that no longer exists.
  const localLabels = new Set<string>();
  for (let k = 0; k < out.length; k++) {
    const t = out[k];
    if (t.kind !== "ident") continue;
    const next = out[k + 1];
    if (next?.kind !== "punct" || next.text !== ":") continue;
    if (macro.parameters.indexOf(t.text.toUpperCase()) >= 0) continue;
    if (macro.name === t.text.toUpperCase()) continue;
    localLabels.add(t.text.toUpperCase());
  }
  if (localLabels.size > 0) {
    for (let k = 0; k < out.length; k++) {
      const t = out[k];
      if (t.kind !== "ident" || !localLabels.has(t.text.toUpperCase())) continue;
      out[k] = { ...t, text: `${t.text}$BB${serial}`, value: 0 };
    }
  }

  // Re-stamp onto the call site, preserving the body's column layout.
  const base = callSite.column;
  let column = base;
  return out.map((token) => {
    const stamped: Token = { ...token, line: callSite.line, column };
    column += Math.max(1, token.text.length);
    return stamped;
  });
}
