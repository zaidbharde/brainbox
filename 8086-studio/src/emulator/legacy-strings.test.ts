import { describe, expect, it } from 'vitest';
import { assemble } from './assembler';
import { runProgram, type ProgramOutput } from './cpu';

/**
 * The reported failure, and the three places its cause turned up.
 *
 * The program below is the one from the bug report: standard MASM/TASM, with a
 * single-quoted string, `.MODEL`, `.STACK`, `@DATA`, a bare `LEA`, and termination
 * on `INT 21h` AH=4Ch. It failed on the legacy engine with
 *
 *     Error:
 *     Line 5: Invalid data initializer: 'Hello World!$'
 *
 * while working on v2, so the same source either ran or did not depending on the
 * engine toggle. The message was accurate about the line and useless about the
 * cause: the string was not invalid, it was spelled with the quote character the
 * assembler did not recognise.
 *
 * There were three `"`-only checks and all three had to change, which is why these
 * tests reach past the one symptom. `parseStringLiteral` decided what a string was;
 * `splitOperands` decided what a comma separated; `stripInlineComment` decided what
 * a `;` started. Fixing only the first makes the reported program work and leaves
 * `DB 'a,b'` and `DB 'x ; y'` broken.
 */

/** The program exactly as reported. Line 5 is the `msg DB` line. */
const REPORTED_HELLO_WORLD = [
  '.MODEL SMALL',
  '.STACK 100H',
  '',
  '.DATA',
  "    msg DB 'Hello World!$'",
  '',
  '.CODE',
  'MAIN PROC',
  '    MOV AX, @DATA',
  '    MOV DS, AX',
  '',
  '    LEA DX, msg',
  '    MOV AH, 09H',
  '    INT 21H',
  '',
  '    MOV AH, 4CH',
  '    INT 21H',
  'MAIN ENDP',
  'END MAIN',
].join('\n');

const DATA_BASE = 0x0100;

/** Assembles, asserting there is nothing to report, then runs to completion. */
function assembleAndRun(source: string, maxSteps = 10_000) {
  const program = assemble(source);
  expect(program.errors).toEqual([]);
  const { finalState, output } = runProgram(program, maxSteps);
  return { program, finalState, printed: printOutput(output) };
}

function printOutput(output: ProgramOutput[]): string {
  return output
    .map((entry) =>
      entry.type === 'char' ? String.fromCharCode(entry.value) : String(entry.value),
    )
    .join('');
}

/** The bytes of `length` bytes at `address`, as characters. */
function bytesAt(memory: Uint8Array, address: number, length: number): string {
  return Array.from(memory.slice(address, address + length))
    .map((byte) => String.fromCharCode(byte))
    .join('');
}

describe('the reported program, on the legacy engine', () => {
  it('assembles without an error', () => {
    // The bug, stated as a fact about the assembler rather than about the panel.
    // Line 5 is what the report named.
    const program = assemble(REPORTED_HELLO_WORLD);
    expect(program.errors).toEqual([]);
    expect(program.errors.filter((e) => e.line === 5)).toEqual([]);
  });

  it('prints Hello World! through INT 21h AH=09h', () => {
    expect(assembleAndRun(REPORTED_HELLO_WORLD).printed).toBe('Hello World!');
  });

  it('terminates on INT 21h AH=4Ch rather than running out of steps', () => {
    const { finalState } = assembleAndRun(REPORTED_HELLO_WORLD);
    // `halted` is what AH=4Ch sets. Without it the run ends at the step limit and
    // the output can still look right, which is how a broken program passes a
    // test that only checks text.
    expect(finalState.halted).toBe(true);
    expect(finalState.error).toBeNull();
  });

  it('stops at the terminate call instead of falling off the end', () => {
    // If AH=4Ch did not halt, execution would continue into whatever follows and
    // the run would end on the step limit rather than on the interrupt.
    const program = assemble(REPORTED_HELLO_WORLD);
    const { history, finalState } = runProgram(program, 10_000);
    expect(history.length).toBeLessThan(10_000);
    expect(finalState.halted).toBe(true);
    // AX holds the terminate code, which is what AH=4Ch leaves behind.
    expect(finalState.registers.AX & 0xff00).toBe(0x4c00);
  });

  it('puts the string in memory at the address LEA resolves to', () => {
    // The label address and the memory contents have to agree, or the program
    // prints whatever happens to be at the right place.
    const { program, finalState } = assembleAndRun(REPORTED_HELLO_WORLD);
    expect(bytesAt(finalState.memory, DATA_BASE, 13)).toBe('Hello World!$');

    // `LEA DX, msg` is folded at assembly time, so the resolution is visible as the
    // address it produced rather than as a LEA that survived to run.
    const leaResolved = program.instructions.find(
      (i) => i.opcode === 'MOV' && i.operands[0] === 'DX',
    );
    expect(leaResolved, 'LEA DX, msg folded to a MOV of the label address').toBeDefined();
    expect(leaResolved!.operands[1].toLowerCase()).toBe(`${DATA_BASE.toString(16)}h`);
  });

  it('registers the PROC label and terminates the listing', () => {
    // `MAIN PROC` is a label and `END MAIN` closes the program, so the assembler
    // has to resolve the label to an instruction index rather than treating
    // `MAIN` as an unknown opcode.
    const program = assemble(REPORTED_HELLO_WORLD);
    expect(program.labels.get('MAIN')).toBe(0);
    // The implicit HLT after the last line is what stops a program that falls off
    // the end, and is why the run above halts even without AH=4Ch.
    expect(program.instructions.at(-1)!.opcode).toBe('HLT');
  });

  it('leaves DS pointing at the data segment', () => {
    const { finalState } = assembleAndRun(REPORTED_HELLO_WORLD);
    expect(finalState.registers.DS).toBe(DATA_BASE);
  });
});

describe('either quote character, on the legacy engine', () => {
  it.each([
    ['single', "msg DB 'Hello'"],
    ['double', 'msg DB "Hello"'],
  ] as const)('accepts a %s-quoted string', (_name, declaration) => {
    const program = assemble(declaration);
    expect(program.errors).toEqual([]);
    expect(bytesAt(program.initialMemory, DATA_BASE, 5)).toBe('Hello');
  });

  it('puts the same bytes in memory whichever quote was used', () => {
    // The point of the fix: one spelling of one declaration. If these ever differ
    // again, a program stops working because someone changed a quote.
    const single = assemble("msg DB 'Hello World!$'");
    const double = assemble('msg DB "Hello World!$"');
    expect(Array.from(single.initialMemory.slice(0, 32))).toEqual(
      Array.from(double.initialMemory.slice(0, 32)),
    );
  });

  it('reads an empty string as zero bytes rather than a bad initializer', () => {
    expect(assemble("msg DB ''").errors).toEqual([]);
    expect(assemble("msg DB ''").initialMemory[DATA_BASE]).toBe(0);
  });

  it('reports an unterminated string on the line that opened it', () => {
    const program = assemble(['msg1 DB 1', "msg2 DB 'oops"].join('\n'));
    expect(program.errors).toHaveLength(1);
    expect(program.errors[0].line).toBe(2);
    expect(program.errors[0].message).toContain('Invalid data initializer');
  });

  it('reports mismatched quote characters rather than reading the text', () => {
    // `"abc'` must not be accepted as `abc`: the closing character has to match
    // the opening one or a stray apostrophe silently changes what is assembled.
    const program = assemble('msg DB "it\'s');
    expect(program.errors).toHaveLength(1);
    expect(program.errors[0].message).toContain('Invalid data initializer');
  });
});

describe('commas and comments inside a quoted string, on the legacy engine', () => {
  // These are the two other `"`-only checks. They were not the reported symptom,
  // and fixing only `parseStringLiteral` would have left them: `DB 'a,b'` would
  // assemble to the two strings `a` and `b`, and `DB 'x ; y'` would assemble to
  // `x ` with the rest of the line treated as a comment.
  it('keeps a comma inside a string as one string', () => {
    const program = assemble("msg DB 'a,b,c'");
    expect(program.errors).toEqual([]);
    expect(bytesAt(program.initialMemory, DATA_BASE, 5)).toBe('a,b,c');
  });

  it('keeps a semicolon inside a string as part of the string', () => {
    const program = assemble("msg DB 'x ; not a comment'");
    expect(program.errors).toEqual([]);
    expect(bytesAt(program.initialMemory, DATA_BASE, 17)).toBe('x ; not a comment');
  });

  it('still ends a comment that follows a string', () => {
    const program = assemble("msg DB 'kept' ; dropped");
    expect(program.errors).toEqual([]);
    expect(bytesAt(program.initialMemory, DATA_BASE, 4)).toBe('kept');
  });

  it('does not let an apostrophe inside a double-quoted string end it early', () => {
    const program = assemble('msg DB "it\'s here"');
    expect(program.errors).toEqual([]);
    expect(bytesAt(program.initialMemory, DATA_BASE, 9)).toBe("it's here");
  });
});

describe('mixed and numeric initializers, on the legacy engine', () => {
  it('reads a mix of numbers and strings in one declaration', () => {
    const program = assemble("msg DB 10, 13, 'Hello', '$'");
    expect(program.errors).toEqual([]);
    expect(Array.from(program.initialMemory.slice(DATA_BASE, DATA_BASE + 9))).toEqual([
      10, 13, 72, 101, 108, 108, 111, 36, 0,
    ]);
  });

  it('prints a CRLF-prefixed string built from mixed initializers', () => {
    // The reason the mixed form matters: it is how a program puts a line break in
    // front of its text, and it only works if the comma inside a string and the
    // comma between initializers are told apart.
    const source = [
      '.DATA',
      "    msg DB 13, 10, 'Hello World!$'",
      '.CODE',
      'MAIN PROC',
      '    MOV AX, @DATA',
      '    MOV DS, AX',
      '    LEA DX, msg',
      '    MOV AH, 09H',
      '    INT 21H',
      '    MOV AH, 4CH',
      '    INT 21H',
      'MAIN ENDP',
      'END MAIN',
    ].join('\n');
    expect(assembleAndRun(source).printed).toBe('\r\nHello World!');
  });

  it.each([
    ['decimal', 'msg DB 1, 2, 3', [1, 2, 3]],
    ['hexadecimal', 'msg DB 0FFH, 10h', [0x0ff, 0x10]],
    ['0x hex', 'msg DB 0x41, 0x42', [0x41, 0x42]],
    ['binary', 'msg DB 1010B', [0b1010]],
    ['character codes', 'msg DB 41H, 42H', [0x41, 0x42]],
  ] as const)('reads %s initializers', (_name, declaration, expected) => {
    const program = assemble(declaration);
    expect(program.errors).toEqual([]);
    expect(Array.from(program.initialMemory.slice(DATA_BASE, DATA_BASE + expected.length))).toEqual([
      ...expected,
    ]);
  });

  it('reads a negative initializer as a byte', () => {
    const program = assemble('msg DB -1');
    expect(program.errors).toEqual([]);
    expect(program.initialMemory[DATA_BASE]).toBe(0xff);
  });

  it('reads DW as a word and DB as a byte', () => {
    const program = assemble('w DW 1234H');
    expect(program.errors).toEqual([]);
    expect(program.initialMemory[DATA_BASE]).toBe(0x34);
    expect(program.initialMemory[DATA_BASE + 1]).toBe(0x12);
  });

  it('reads ? as an uninitialised byte', () => {
    const program = assemble('msg DB ?');
    expect(program.errors).toEqual([]);
    expect(program.initialMemory[DATA_BASE]).toBe(0);
  });

  it('still refuses a DW string rather than guessing a width', () => {
    // Not something this fix should quietly allow: a string in a word directive
    // has no single right answer.
    const program = assemble("msg DW 'text'");
    expect(program.errors).toHaveLength(1);
    expect(program.errors[0].message).toContain('DW string initializers are not supported');
  });
});

describe('invalid initializers, on the legacy engine', () => {
  it.each([
    ['a bare identifier', 'msg DB notAnIdentifier', 'notAnIdentifier'],
    ['a stray bracket', 'msg DB ]', ']'],
  ] as const)('rejects %s with the offending text and its line', (_name, source, text) => {
    const program = assemble(['.DATA', source].join('\n'));
    expect(program.errors).toHaveLength(1);
    expect(program.errors[0].type).toBe('error');
    expect(program.errors[0].line).toBe(2);
    expect(program.errors[0].message).toContain(text);
  });

  it('keeps assembling after a bad initializer so later lines are still checked', () => {
    const program = assemble(
      ['msg DB nope', 'other DB 1', 'also DB @@@'].join('\n'),
    );
    expect(program.errors.length).toBeGreaterThanOrEqual(2);
    expect(program.errors.map((e) => e.line)).toContain(1);
    expect(program.errors.map((e) => e.line)).toContain(3);
  });
});

describe('case and whitespace, on the legacy engine', () => {
  it('assembles the program in lower case', () => {
    // Lowercased syntax only: the text inside the string is data, and lowercasing
    // it would change what the program prints.
    //
    // Replaced through a function, not a string: the replacement ends in `$'`,
    // which `String.replace` reads as "everything after the match" and splices
    // the rest of the program in after the closing quote.
    const source = REPORTED_HELLO_WORLD.toLowerCase().replace(
      "'hello world!$'",
      () => "'Hello World!$'",
    );
    const program = assemble(source);
    expect(program.errors).toEqual([]);
    expect(assembleAndRun(source).printed).toBe('Hello World!');
  });

  it('assembles the program with comments and blank lines', () => {
    const source = [
      '; a leading comment',
      '.MODEL SMALL ; and a trailing one',
      '',
      '.STACK 100H',
      '.DATA',
      "    msg DB 'Hello World!$'   ; the text",
      '.CODE',
      'MAIN PROC',
      '    MOV  AX,@DATA',
      '    MOV  DS, AX',
      '    LEA  DX, msg',
      '    MOV  AH, 09H',
      '    INT  21H',
      '    MOV  AH, 4CH',
      '    INT  21H',
      'MAIN ENDP',
      'END MAIN',
    ].join('\n');
    expect(assembleAndRun(source).printed).toBe('Hello World!');
  });
});