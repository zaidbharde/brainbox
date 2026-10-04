/**
 * The assembly example library.
 *
 * This is a catalog, not a program recogniser: every entry is a complete program
 * that gets assembled and executed by `examples.test.ts`, which asserts the
 * printed text and the final CPU state on each engine the entry claims. Nothing
 * here maps source text to a stored answer, so an example cannot pass by matching
 * a familiar string.
 *
 * There is no backend to put this in. The app has no server, no API client and no
 * network calls of any kind -- `demos.ts` is a static array in the same
 * `src/lab` directory for the same reason -- so the convention this follows is the
 * one already established: a typed module beside the emulator, imported by a
 * panel. `ExampleLibrary` renders it, `DemoLibrary` renders `ASSEMBLY_DEMOS`, and
 * both take the same three callbacks so they behave identically in the editor.
 *
 * It exists separately from the Demo Program Library in `demos.ts` because the two
 * answer different questions. That list is what the editor's library panel shows:
 * a handful of programs for poking at. This one is organised for reading and
 * pinned for regression -- every entry has a category, a description of what it
 * demonstrates, the engines it is known to run on, and the output it must produce.
 *
 * Where a program already existed in the demo list its source is imported rather
 * than copied, so there is one source of truth per program and the demo panel and
 * the catalog cannot drift apart.
 */

import { ASSEMBLY_DEMOS } from '@/lab/demos';
import type { EngineId } from '@/lab/execution-engine';

export type ExampleCategory =
  | 'basic-output'
  | 'arithmetic'
  | 'control-flow'
  | 'registers-memory'
  | 'arrays-strings'
  | 'stack-procedures'
  | 'dos-interrupts'
  | 'sorting-searching'
  | 'number-processing'
  | 'combined';

export interface ExampleCategoryInfo {
  id: ExampleCategory;
  label: string;
  blurb: string;
}

export const EXAMPLE_CATEGORIES: readonly ExampleCategoryInfo[] = [
  {
    id: 'basic-output',
    label: 'Basic programs and output',
    blurb: 'The shortest program that prints something, and the directives around it.',
  },
  {
    id: 'arithmetic',
    label: 'Arithmetic',
    blurb: 'ADD, SUB, MUL, DIV and MOD, and what each leaves in AX and DX.',
  },
  {
    id: 'control-flow',
    label: 'Conditions and loops',
    blurb: 'CMP with the conditional jumps, and counted loops written without LOOP.',
  },
  {
    id: 'registers-memory',
    label: 'Registers and memory',
    blurb: 'Direct addresses, register indirect addressing, and DS.',
  },
  {
    id: 'arrays-strings',
    label: 'Arrays and strings',
    blurb: 'Walking an array with SI, and rewriting a string in place.',
  },
  {
    id: 'stack-procedures',
    label: 'Stack and procedures',
    blurb: 'CALL, RET, parameters on the stack, and a register saved across a call.',
  },
  {
    id: 'dos-interrupts',
    label: 'Keyboard input and DOS interrupts',
    blurb: 'The INT 21h print and exit services, and the ones that differ by engine.',
  },
  {
    id: 'sorting-searching',
    label: 'Sorting and searching',
    blurb: 'Bubble sort and linear search over words in memory.',
  },
  {
    id: 'number-processing',
    label: 'Number-processing algorithms',
    blurb: 'Turning a number into digits: repeated division, and a digit sum.',
  },
  {
    id: 'combined',
    label: 'Combined programs',
    blurb: 'Several of the above in one program, which is what real programs are.',
  },
];

/**
 * Print AX as unsigned decimal, without leading zeros.
 *
 * Written out into each example that needs it rather than shared, because an
 * example a person can copy into the editor and run has to stand on its own.
 *
 * Two constraints come from the engines rather than from taste. There is no `LOOP`
 * on the legacy, so the digit counter uses `DEC`/`JNZ`. And `ADD DL, '0'` would
 * need a character literal in an immediate, which the legacy's immediate parser
 * does not accept, so it is the number 48 -- `'0'` is 0x30, which is 48 and not 30.
 */
const PRINT_UDEC = `PRINT_UDEC PROC              ; print AX as unsigned decimal
    PUSH AX
    PUSH BX
    PUSH CX
    PUSH DX
    MOV CX, 0                 ; digits pushed so far
    MOV BX, 10
PUD_DIV:
    XOR DX, DX
    DIV BX                    ; AX = AX / 10, DX = remainder
    PUSH DX
    INC CX
    CMP AX, 0
    JNE PUD_DIV
PUD_OUT:
    POP DX
    ADD DL, 48                ; '0' is 0x30
    MOV AH, 02H
    INT 21H
    DEC CX
    JNZ PUD_OUT
    POP DX
    POP CX
    POP BX
    POP AX
    RET
PRINT_UDEC ENDP`;

/**
 * A procedure worth reading twice, because the register it saves is the whole
 * point. `CALL` pushes a return address that `RET` needs back, and nothing about
 * `CALL` promises that BX still holds what the caller left in it. A procedure
 * that clobbers a register without saving it is correct until the day something
 * calls it twice.
 */
const DOUBLE = `DOUBLE PROC                 ; AX = AX * 2
    PUSH BX                   ; BX is not ours to spend
    ADD AX, AX
    POP BX
    RET
DOUBLE ENDP`;

/**
 * Wraps a program in the `.MODEL`/`.DATA`/`.CODE` shape every example shares.
 *
 * Procedures go after `MAIN ENDP`, and that placement is load-bearing rather than
 * stylistic. Both engines lay a `PROC` body out inline: the block between `PROC`
 * and `ENDP` is ordinary instructions in the stream, with a label in front of it
 * for `CALL` to find. MASM does not need the body anywhere particular, because it
 * knows a procedure is not fallen into. These engines do not, so a procedure
 * written before the end of `MAIN` is executed on the way past -- an early version
 * of `arithmetic-add-sub` fell out of `CALL PRINT_UDEC` and then ran the whole
 * digit routine again on the way to the exit, printing the answer dozens of times.
 * Every example here ends `MAIN` with the AH=4Ch exit, so nothing is ever reached by
 * falling.
 */
function model(dataLines: string, mainBody: string, procedures: string = ''): string {
  return [
    '.MODEL SMALL',
    '.STACK 100H',
    '',
    '.DATA',
    dataLines,
    '',
    '.CODE',
    'MAIN PROC',
    mainBody,
    '    MOV AH, 4CH',
    '    INT 21H',
    'MAIN ENDP',
    procedures,
    'END MAIN',
  ].join('\n');
}

const demoSource = (id: string): string => {
  const demo = ASSEMBLY_DEMOS.find((entry) => entry.id === id);
  if (!demo) throw new Error(`No demo with id ${id} to import into the example library`);
  return demo.source;
};

export interface AssemblyExample {
  /** Stable, and the handle tests and documentation use. Never reused. */
  id: string;
  title: string;
  category: ExampleCategory;
  description: string;
  source: string;
  /** Engines this program is verified on. See `examples.test.ts`. */
  engines: readonly EngineId[];
  /** The exact character output, and nothing else, that a run must produce. */
  expectedOutput: string;
}

export const ASM_EXAMPLES: readonly AssemblyExample[] = [
  {
    id: 'basic-hello-world',
    title: 'Hello World',
    category: 'basic-output',
    description:
      'The program from the bug report that started this. Prints one $-terminated string with INT 21h AH=09h and ends with AH=4Ch. Worth reading once for the whole shape of a DOS program: the string is in the data segment, DS has to be pointed at it before it can be read, and LEA is how the address gets into a register.',
    source: model(
      "    msg DB 'Hello World!$'",
      [
        '    MOV AX, @DATA',
        '    MOV DS, AX',
        '',
        '    LEA DX, msg',
        '    MOV AH, 09H',
        '    INT 21H',
      ].join('\n'),
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: 'Hello World!',
  },
  {
    id: 'basic-two-strings',
    title: 'Two strings, and a line break between them',
    category: 'basic-output',
    description:
      'One DB holding a string, a CR/LF pair as two numeric bytes, and another string. Shows that a data directive takes numbers and text in the same list, in order.',
    source: model(
      "    first DB 'Hello, 8086!', 13, 10, '$'\n    second DB 'Goodbye!$'",
      [
        '    MOV AX, @DATA',
        '    MOV DS, AX',
        '    LEA DX, first',
        '    MOV AH, 09H',
        '    INT 21H',
        '    LEA DX, second',
        '    MOV AH, 09H',
        '    INT 21H',
      ].join('\n'),
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: 'Hello, 8086!\r\nGoodbye!',
  },
  {
    id: 'arithmetic-add-sub',
    title: 'Adding and subtracting',
    category: 'arithmetic',
    description:
      'ADD and SUB on 16-bit registers, printing the result as decimal. The point is that ADD writes only AX and leaves the flags for a following jump; nothing else in AX survives it.',
    source: model(
      '    sum DW ?\n    diff DW ?',
      [
        '    MOV AX, 50',
        '    MOV BX, 7',
        '    ADD AX, BX              ; AX = 57',
        '    MOV [sum], AX',
        '    MOV AX, 57',
        '    SUB AX, BX              ; AX = 50',
        '    MOV [diff], AX',
        '',
        '    MOV AX, [sum]',
        '    CALL PRINT_UDEC',
        '    MOV DL, 32',
        '    MOV AH, 02H',
        '    INT 21H',
        '    MOV AX, [diff]',
        '    CALL PRINT_UDEC',
        '',
      ].join('\n'),
      PRINT_UDEC,
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: '57 50',
  },
  {
    id: 'arithmetic-multiply-divide',
    title: 'Multiplying and dividing 16-bit values',
    category: 'arithmetic',
    description:
      'MUL BX is unsigned and one-operand: it multiplies AX by BX and puts the 32-bit result in DX:AX. DIV BX divides DX:AX by BX, which is why the high half has to be zeroed first or a leftover DX changes the answer.',
    source: model(
      '',
      [
        '    MOV AX, 300',
        '    MOV BX, 7',
        '    MUL BX                   ; DX:AX = 2100',
        '    CALL PRINT_UDEC',
        '    MOV DL, 32',
        '    MOV AH, 02H',
        '    INT 21H',
        '',
        '    MOV AX, 2100',
        '    XOR DX, DX               ; high half must be 0 for DIV',
        '    MOV BX, 7',
        '    DIV BX                   ; AX = 300, DX = 0',
        '    CALL PRINT_UDEC         ; the quotient, still in AX',
        '    PUSH DX                  ; DIV left the remainder in DX, and',
        '    MOV DL, 32               ; printing a space overwrites DL',
        '    MOV AH, 02H',
        '    INT 21H',
        '    POP DX',
        '    MOV AX, DX',
        '    CALL PRINT_UDEC         ; the remainder',
        '',
      ].join('\n'),
      PRINT_UDEC,
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: '2100 300 0',
  },
  {
    id: 'control-flow-countdown',
    title: 'Counting down to zero',
    category: 'control-flow',
    description:
      'CMP and JNE around a loop body, with the counter printed each pass. There is no LOOP on the legacy engine, so the countdown uses DEC and a conditional jump, which is also how it has to be written on real hardware that lacks LOOP.',
    source: model(
      '',
      [
        '    MOV CX, 5',
        'LOOP_TOP:',
        '    MOV AX, CX',
        '    CALL PRINT_UDEC',
        '    MOV DL, 32',
        '    MOV AH, 02H',
        '    INT 21H',
        '    DEC CX',
        '    CMP CX, 0',
        '    JNE LOOP_TOP',
        '',
      ].join('\n'),
      PRINT_UDEC,
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: '5 4 3 2 1 ',
  },
  {
    id: 'control-flow-sign-branch',
    title: 'Branching on the sign of a subtraction',
    category: 'control-flow',
    description:
      'CMP sets the flags that a conditional jump reads. This compares two bytes in memory, prints which was larger, then reverses the operands so the same comparison decides the other way.',
    source: model(
      "    left DB 17\n    right DB 42\n    msg_left DB 'left is smaller$'\n    msg_right DB 'right is larger$'",
      [
        '    MOV AX, @DATA',
        '    MOV DS, AX',
        '',
        '    MOV AL, left',
        '    MOV BL, right',
        '    CMP AL, BL               ; 17 - 42, so it borrowed',
        '    JB PRINT_LEFT',
        '    LEA DX, msg_right',
        '    MOV AH, 09H',
        '    INT 21H',
        '    JMP REVERSED',
        'PRINT_LEFT:',
        '    LEA DX, msg_left',
        '    MOV AH, 09H',
        '    INT 21H',
        'REVERSED:',
        '    ; same two values, compared the other way round',
        '    MOV AL, right',
        '    MOV BL, left',
        '    CMP AL, BL',
        '    JG PRINT_RIGHT           ; 42 > 17, so right is the larger',
        '    LEA DX, msg_left',
        '    MOV AH, 09H',
        '    INT 21H',
        '    JMP FINISHED',
        'PRINT_RIGHT:',
        '    LEA DX, msg_right',
        '    MOV AH, 09H',
        '    INT 21H',
        'FINISHED:',
      ].join('\n'),
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: 'left is smallerright is larger',
  },
  {
    id: 'registers-memory-sum-array',
    title: 'Summing an array through SI',
    category: 'registers-memory',
    description:
      'Four words in memory, walked with SI in steps of two and added into AX. The array is addressed with [SI] rather than by name, which is what a loop over an array has to do.',
    source: model(
      '    values DW 10, 20, 30, 40',
      [
        '    MOV AX, @DATA',
        '    MOV DS, AX',
        '    MOV SI, OFFSET values',
        '    MOV CX, 4                ; words to read',
        '    XOR AX, AX               ; running total',
        'SUM_LOOP:',
        '    ADD AX, [SI]',
        '    ADD SI, 2',
        '    DEC CX',
        '    CMP CX, 0',
        '    JNE SUM_LOOP',
        '    CALL PRINT_UDEC',
        '',
      ].join('\n'),
      PRINT_UDEC,
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: '100',
  },
  {
    id: 'arrays-strings-reverse',
    title: 'Reversing a string in place',
    category: 'arrays-strings',
    description:
      'Copies eight characters into a buffer beside them, walking the source forwards and the destination backwards, so the buffer ends up holding the string reversed. Two details carry the example. The `$` goes at the *end* of the buffer, not the start, because AH=09h prints up to the first one and a reversed `\'abcdefgh$\'` would print nothing at all. And the stores say BYTE PTR: a bare `MOV [DI], AL` leaves the width unstated, and the legacy defaults that to a word, which writes a zero over the neighbouring character and quietly ruins the copy as soon as the pointer steps backwards.',
    source: model(
      "    src DB 'abcdefgh'\n    dst DB 0, 0, 0, 0, 0, 0, 0, 0, '$'",
      [
        '    LEA SI, src',
        '    LEA DI, dst',
        '    ADD DI, 7               ; last character, not the terminator',
        '    MOV CX, 8',
        'REV_LOOP:',
        '    MOV AL, BYTE PTR [SI]',
        '    MOV BYTE PTR [DI], AL',
        '    INC SI',
        '    DEC DI',
        '    DEC CX',
        '    CMP CX, 0',
        '    JNE REV_LOOP',
        '',
        '    LEA DX, dst',
        '    MOV AH, 09H',
        '    INT 21H',
      ].join('\n'),
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: 'hgfedcba',
  },
  {
    id: 'stack-procedures-call-ret',
    title: 'Calling a procedure',
    category: 'stack-procedures',
    description:
      'A procedure that doubles AX. The CALL pushes a return address and RET pops it, and the procedure saves BX around itself because BX is a register the caller expects to survive. No stack offsets: reading arguments at [SP+4] is left out on purpose, because the two engines do not agree about it and an example that only works on one of them is not an example.',
    source: model(
      '',
      [
        '    MOV AX, 30',
        '    CALL DOUBLE',
        '    CALL PRINT_UDEC',
        '    MOV DL, 32',
        '    MOV AH, 02H',
        '    INT 21H',
        '    MOV AX, 7',
        '    CALL DOUBLE',
        '    CALL PRINT_UDEC',
        '',
      ].join('\n'),
      `${DOUBLE}\n${PRINT_UDEC}`,
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: '60 14',
  },
  {
    id: 'dos-interrupts-print-and-exit',
    title: 'The three DOS services worth knowing',
    category: 'dos-interrupts',
    description:
      'AH=09h prints a $-terminated string, AH=02h prints one character from DL, and AH=4Ch ends the program. Both engines implement all three, which is why this example is listed for both. They differ on AH=01h, 07h, 08h and 0Ah: the legacy has no keyboard input at all.',
    source: model(
      "    banner DB 'Services:$, 0'\n    punct DB '!$'",
      [
        '    MOV AX, @DATA',
        '    MOV DS, AX',
        '',
        '    LEA DX, banner',
        '    MOV AH, 09H',
        '    INT 21H',
        '',
        '    MOV DL, 10',
        '    MOV AH, 02H',
        '    INT 21H',
        '',
        '    MOV DL, 90              ; \'Z\'',
        '    MOV AH, 02H',
        '    INT 21H',
        '',
        '    LEA DX, punct',
        '    MOV AH, 09H',
        '    INT 21H',
        '',
        '    ; AX holds 4Ch on exit, which is where the implicit exit comes from',
      ].join('\n'),
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: 'Services:\nZ!',
  },
  {
    id: 'sorting-searching-bubble-sort',
    title: 'Bubble sorting three words',
    category: 'sorting-searching',
    description:
      'The classic nested-loop bubble sort over three words in memory, then the sorted values printed in order. The inner loop walks with SI and swaps through [SI] and [SI+2], which is the only addressing a swap needs.',
    source: model(
      '    values DW 5, 2, 9',
      [
        '    MOV AX, @DATA',
        '    MOV DS, AX',
        '',
        '    MOV CX, 2                ; outer passes',
        'OUTER:',
        '    MOV SI, OFFSET values',
        '    MOV DX, 2                ; inner comparisons',
        'INNER:',
        '    MOV AX, [SI]',
        '    MOV BX, [SI+2]',
        '    CMP AX, BX',
        '    JLE NO_SWAP',
        '    MOV [SI], BX',
        '    MOV [SI+2], AX',
        'NO_SWAP:',
        '    ADD SI, 2',
        '    DEC DX',
        '    JNZ INNER',
        '    DEC CX',
        '    JNZ OUTER',
        '',
        '    LEA SI, values',
        '    MOV CX, 3',
        'SHOW:',
        '    MOV AX, [SI]',
        '    CALL PRINT_UDEC',
        '    MOV DL, 32',
        '    MOV AH, 02H',
        '    INT 21H',
        '    ADD SI, 2',
        '    DEC CX',
        '    CMP CX, 0',
        '    JNE SHOW',
        '',
      ].join('\n'),
      PRINT_UDEC,
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: '2 5 9 ',
  },
  {
    id: 'sorting-searching-linear-search',
    title: 'Finding a value in an array',
    category: 'sorting-searching',
    description:
      'Linear search for 30 in an array of five words, printing the index it was found at. The search stops as soon as CMP reports equality, so the index is whatever CX had been left at.',
    source: model(
      '    values DW 10, 20, 30, 40, 50',
      [
        '    MOV AX, @DATA',
        '    MOV DS, AX',
        '    LEA SI, values',
        '    MOV CX, 0                ; index, counting up to 5',
        '    MOV BX, 30               ; the value being looked for',
        'FIND:',
        '    MOV AX, [SI]',
        '    CMP AX, BX',
        '    JE FOUND',
        '    ADD SI, 2',
        '    INC CX',
        '    CMP CX, 5              ; five words, indices 0 to 4',
        '    JL FIND',
        '    JMP NOT_FOUND',
        'NOT_FOUND:',
        '    MOV DL, 63',
        '    MOV AH, 02H',
        '    INT 21H',
        '    JMP SEARCH_DONE',
        'FOUND:',
        '    MOV AX, CX',
        '    CALL PRINT_UDEC',
        'SEARCH_DONE:',
        '',
      ].join('\n'),
      PRINT_UDEC,
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: '2',
  },
  {
    id: 'number-processing-digit-sum',
    title: 'Sum of the digits of a number',
    category: 'number-processing',
    description:
      'Takes 12345 apart with repeated DIV by 10 and adds the remainders, giving 15. The remainder is already a digit, so this is the shortest route from a number to its digits.',
    source: model(
      '',
      [
        '    MOV AX, 12345',
        '    MOV BX, 10',
        '    XOR CX, CX               ; the sum',
        'DIGITS:',
        '    CMP AX, 0',
        '    JE DIGITS_DONE',
        '    XOR DX, DX',
        '    DIV BX                   ; AX = quotient, DX = next digit',
        '    ADD CX, DX',
        '    JMP DIGITS',
        'DIGITS_DONE:',
        '    MOV AX, CX',
        '    CALL PRINT_UDEC',
        '',
      ].join('\n'),
      PRINT_UDEC,
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: '15',
  },
  {
    id: 'combined-largest-of-three',
    title: 'Largest of three numbers, then its square',
    category: 'combined',
    description:
      'Compares three values to find the largest, then multiplies it by itself with MUL, which puts the 32-bit result in DX:AX. Registers, memory, conditional jumps, a procedure and a 16-bit multiply in one program.',
    source: model(
      '    a DB 12\n    b DB 30\n    c DB 21',
      [
        '    MOV AX, @DATA',
        '    MOV DS, AX',
        '    MOV AL, [a]',
        '    MOV BL, [b]',
        '    CMP AL, BL',
        '    JAE A_NOT_SMALLER',
        '    MOV AL, BL               ; b is larger',
        'A_NOT_SMALLER:',
        '    MOV BL, [c]',
        '    CMP AL, BL',
        '    JAE HAVE_LARGEST',
        '    MOV AL, BL               ; c is the largest',
        'HAVE_LARGEST:',
        '    MOV AH, 0                ; widen to a word for MUL',
        '    MOV BX, AX',
        '    MUL BX                   ; DX:AX = AL * AL',
        '    CALL PRINT_UDEC',
        '',
      ].join('\n'),
      PRINT_UDEC,
    ),
    engines: ['legacy', 'v2'],
    expectedOutput: '900',
  },
  {
    id: 'demo-sorting',
    title: 'Sorting Demo (library entry)',
    category: 'sorting-searching',
    description:
      'The editor library\'s sorting demo, imported rather than copied so the two cannot drift. Bubble sorts three memory words and outputs them with OUT.',
    source: demoSource('sorting'),
    engines: ['legacy', 'v2'],
    expectedOutput: '2\n5\n9\n',
  },
  {
    id: 'demo-calculator',
    title: 'Calculator Demo (library entry)',
    category: 'arithmetic',
    description:
      'The editor library\'s calculator demo, imported rather than copied. Runs ADD, SUB, MUL, DIV and MOD style arithmetic and prints each result with OUT.',
    source: demoSource('calculator'),
    engines: ['legacy', 'v2'],
    expectedOutput: '57\n47\n329\n14\n0\n',
  },
  {
    id: 'demo-call-stack',
    title: 'CALL/RET Demo (library entry)',
    category: 'stack-procedures',
    description:
      'The editor library\'s call-stack demo, imported rather than copied. Nested CALLs with values left on the stack.',
    source: demoSource('call-stack'),
    engines: ['legacy', 'v2'],
    expectedOutput: '10\n',
  },
];

/** The catalog grouped by category, in `EXAMPLE_CATEGORIES` order. */
export function examplesByCategory(): Array<{
  info: ExampleCategoryInfo;
  examples: AssemblyExample[];
}> {
  return EXAMPLE_CATEGORIES.map((info) => ({
    info,
    examples: ASM_EXAMPLES.filter((example) => example.category === info.id),
  }));
}

export function findExample(id: string): AssemblyExample | undefined {
  return ASM_EXAMPLES.find((example) => example.id === id);
}