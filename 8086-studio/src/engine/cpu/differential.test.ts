/**
 * Differential test: the new CPU against the legacy emulator.
 *
 * The unit tests in `cpu.test.ts` check that the new engine does what I think
 * the 8086 does. That is not the same as checking that it does what the lab
 * already did, and the lab is what users see. So every program here is run
 * twice: once through `src/emulator`, which is the shipped behaviour and is
 * never modified, and once through the new engine, and the two end states have
 * to match field for field.
 *
 * The two engines disagree about almost everything except the instruction set,
 * so the comparison is done through `project`, which reduces each state to the
 * same observable shape: the registers, the six arithmetic flags, the bytes
 * that were written, and whatever the program printed.
 *
 * The legacy works on parsed instructions at its own `IP`; the new engine works
 * on bytes at a physical address. Both are driven from the same source text, so
 * a disagreement can only be an execution difference and not a parsing one.
 *
 * One structural difference dominates everything else and is worth stating
 * plainly: **the legacy emulator has flat memory.** DS, ES and SS live in its
 * register set but are never used to compute an address -- `readByte` indexes
 * the 4 KB array with the bare offset. The new engine does real segmentation,
 * where an address is `(segment << 4) + offset`.
 *
 * So the harness pins every segment to zero, which makes the two address spaces
 * coincide and lets the comparison mean what it should: arithmetic, flags,
 * control flow, the stack, ports and output. Segmentation itself is the one
 * thing the legacy cannot check, and it is covered by its own tests instead --
 * `memory.test.ts` for addressing and `decode.test.ts` for the default segment
 * rules. If a disagreement ever turns out to be a segment difference, the fix is
 * to correct the new engine, not to flatten it.
 *
 * There is a second thing the legacy cannot be trusted for, and it needs stating
 * because it looks like a failing test when it is not. Its **flags for 8-bit
 * arithmetic are not the 8086's.** Scoring both engines over 1280 ALU programs
 * against flag rules written from the 8086 definitions, the new engine was
 * wrong in none of them and the legacy was wrong in a great many: its 8-bit `SF`
 * in up to 56 of 80 cases per operation, its 8-bit `CF` and `OF` in dozens more,
 * its 8-bit `AF` whenever a carry is added or subtracted, and the 16-bit `AF` of
 * `ADC`/`SBB`. Its *results* were right every time, and so were its `PF` and
 * `ZF`, so this is a flag bug and not a different arithmetic.
 *
 * Copying those bugs would make the new engine wrong in the one place users can
 * see it -- the debugger's flag panel -- so it is not copied. Programs that do
 * 8-bit arithmetic are compared on their registers, output and memory, and pass
 * `skipFlags`; 16-bit programs are compared on everything, since the legacy's
 * 16-bit flags are sound apart from the `ADC`/`SBB` carry cases. What the new
 * engine does with those 8-bit flags is pinned against the 8086 rules in
 * `flags-conformance.test.ts`, which is the test that has something to say about
 * correctness here.
 */

import { describe, expect, it } from "vitest";
import { runProgram as legacyRunProgram, createInitialState as legacyInitialState } from "../../emulator/cpu";
import { assemble as legacyAssemble } from "../../emulator/assembler";
import { Cpu, createInitialState, type CpuState } from "./cpu";
import { Memory } from "../memory";
import { assemble } from "../assembler/assemble";
import { getFlag } from "../isa/flags";

/**
 * The legacy's stack pointer. Its data segment is left out on purpose: it never
 * affects an address there, and forcing the new engine to zero to match is what
 * makes the two address spaces the same.
 */
const STACK_START = 4094;
const ORIGIN = 0x100;

/**
 * How much of the end state a comparison covers.
 */
interface Options {
  /**
   * Leave the six arithmetic flags out of the comparison. This is for 8-bit
   * arithmetic, where the legacy's flags are not the 8086's; see the note above
   * on those.
   */
  skipFlags?: boolean;
  /**
   * Leave the stack bytes out of the comparison, for a program that pushes a
   * return address. The two programs are loaded at different addresses, so what
   * `CALL` leaves on the stack differs by exactly that offset and can never
   * agree. SP itself is still compared, so the pushes are not hidden.
   */
  skipStack?: boolean;
}

/** A comparison key for one end state, from either engine. */
interface Projection {
  registers: Record<string, number>;
  flags: Record<string, boolean>;
  output: string;
  memory: Record<number, number>;
}

const COMPARED_REGISTERS = ["AX", "BX", "CX", "DX", "SI", "DI", "BP", "SP"] as const;
const COMPARED_FLAGS = ["CF", "PF", "AF", "ZF", "SF", "OF"] as const;

/**
 * Physical addresses worth comparing. The legacy has only 4 KB of memory and
 * puts the data segment at 0x100, so `MOV AX,[300h]` lands at 1300h physically
 * in both engines. The I/O window at 300h is included because it is the one
 * part of memory the lab reads back.
 */
const WATCHED: readonly number[] = [
  // The code area is not compared: the legacy executes parsed instructions and
  // never loads its own output into memory, so there is nothing there to
  // compare against. Byte-for-byte assembler agreement is checked against GNU
  // as instead, in encoder-fixtures.test.ts.
  0x0200, 0x0201, 0x0202, 0x0203, // the usual scratch area
  0x0300, 0x0301, 0x0302, 0x0303, // the I/O window
  0x0304, 0x0305, 0x0306, 0x0307, // a second port pair
  0x0ffa, 0x0ffb, 0x0ffc, 0x0ffd, 0x0ffe, 0x0fff, // the stack, growing down
];

/** The stack half of `WATCHED`, which a `CALL` makes incomparable. */
const STACK_AREA: readonly number[] = WATCHED.filter((address) => address >= 0x0ffa);

function projectLegacy(state: ReturnType<typeof legacyInitialState>, output: string): Projection {
  const registers: Record<string, number> = {};
  for (const name of COMPARED_REGISTERS) registers[name] = state.registers[name] & 0xffff;
  const flags: Record<string, boolean> = {};
  for (const name of COMPARED_FLAGS) flags[name] = Boolean(state.registers.FLAGS & legacyFlagBit(name));
  const memory: Record<number, number> = {};
  for (const address of WATCHED) memory[address] = state.memory[address] ?? 0;
  return { registers, flags, output, memory };
}

function projectNew(cpu: Cpu, output: string): Projection {
  const registers: Record<string, number> = {};
  for (const name of COMPARED_REGISTERS) registers[name] = cpu.readReg16(name) & 0xffff;
  const flags: Record<string, boolean> = {};
  for (const name of COMPARED_FLAGS) flags[name] = getFlag(cpu.state.FLAGS, name);
  const memory: Record<number, number> = {};
  for (const address of WATCHED) memory[address] = cpu.memory.bytes[address] ?? 0;
  return { registers, flags, output, memory };
}

function legacyFlagBit(name: string): number {
  return { CF: 0x0001, PF: 0x0004, AF: 0x0010, ZF: 0x0040, SF: 0x0080, OF: 0x0800 }[name]!;
}

function describeOutput(output: readonly { type: string; value: number }[]): string {
  return output
    .map((entry) => `${entry.type}:${entry.value}`)
    .join(",");
}

function runProgramOnce(source: string): Projection {
  const legacyProgram = legacyAssemble(source);
  expect(legacyProgram.errors.filter((e) => e.type === "error").map((e) => e.message)).toEqual([]);
  const legacy = legacyRunProgram(legacyProgram, 5000);
  return projectLegacy(legacy.finalState, describeOutput(legacy.output));
}

function runNew(source: string): Projection {
  const cpu = newCpu(source);
  return projectNew(cpu, describeOutput(cpu.output));
}

/** The new engine, run to completion, for the fields `projectNew` leaves out. */
function newCpu(source: string): Cpu {
  const assembled = assemble(source, { origin: ORIGIN });
  expect(assembled.errors.map((d) => d.message)).toEqual([]);
  const memory = new Memory();
  memory.bytes.set(assembled.image, ORIGIN);
  // The legacy starts IP at 0, with a bare flag word and SP at the top of its
  // 4 KB. The new engine's own defaults are the .COM image, so they are
  // overridden to make the two comparable. The segments are zeroed for the flat
  // memory reason described at the top of this file.
  const state: CpuState = {
    ...createInitialState(),
    // Not ORIGIN: a program may open with data, and the legacy begins at the
    // first instruction rather than the first byte of the image. The assembler
    // already reports that offset, so the two start in the same place.
    IP: assembled.entry.ip,
    CS: 0,
    DS: 0,
    ES: 0,
    SS: 0,
    SP: STACK_START,
    FLAGS: 0,
  };
  const cpu = new Cpu(memory, state);
  cpu.run(5000);
  return cpu;
}

/**
 * Assert the two engines agree on a group of programs, collecting every
 * disagreement before failing. Reporting only the first would mean rediscovering
 * the same bug one edit at a time, which is exactly the loop this test exists to
 * end.
 */
function expectAllSame(sources: readonly string[], options: Options = {}): void {
  const problems: string[] = [];
  for (const source of sources) {
    for (const difference of compare(source, options)) {
      problems.push(`${difference}\n    -- in ${JSON.stringify(source)}`);
    }
  }
  expect(problems, "engines disagree").toEqual([]);
}

/** Every field on which the two engines differ for one program, or none. */
function compare(source: string, options: Options = {}): string[] {
  const legacy = runProgramOnce(source);
  const mine = runNew(source);
  if (JSON.stringify(legacy) === JSON.stringify(mine)) return [];
  const differences: string[] = [];
  for (const name of COMPARED_REGISTERS) {
    if (legacy.registers[name] !== mine.registers[name]) {
      differences.push(
        `${name}: legacy 0x${legacy.registers[name].toString(16)} new 0x${mine.registers[name].toString(16)}`,
      );
    }
  }
  if (!options.skipFlags) {
    for (const name of COMPARED_FLAGS) {
      if (legacy.flags[name] !== mine.flags[name]) {
        differences.push(`${name}: legacy ${legacy.flags[name]} new ${mine.flags[name]}`);
      }
    }
  }
  if (legacy.output !== mine.output) differences.push(`output: legacy "${legacy.output}" new "${mine.output}"`);
  for (const address of WATCHED) {
    if (options.skipStack && STACK_AREA.includes(address)) continue;
    if (legacy.memory[address] !== mine.memory[address]) {
      differences.push(
        `[0x${address.toString(16)}]: legacy 0x${legacy.memory[address].toString(16)} new 0x${mine.memory[address].toString(16)}`,
      );
    }
  }
  return differences;
}

function expectSame(source: string, options: Options = {}): void {
  expect(compare(source, options), `engines disagree on:\n${source}`).toEqual([]);
}

describe("differential: the new CPU matches the legacy emulator", () => {
  it("matches on arithmetic", () => {
    expectAllSame([
      "MOV AX, 1234h\nADD AX, 1111h\nHLT",
      "MOV AX, 0\nSUB AX, 1\nHLT",
      "MOV AX, 0FFFFh\nINC AX\nHLT",
      "MOV AX, 8000h\nADD AX, 8000h\nHLT",
      "MOV AX, 7\nMOV BL, 3\nDIV BL\nHLT",
      "MOV AX, 100\nMOV BL, 7\nMUL BL\nHLT",
      "MOV AX, 100\nMOV BX, 7\nMUL BX\nHLT",
      "MOV AX, 0FFFFh\nDEC AX\nHLT",
      "MOV AX, 0\nNEG AX\nHLT",
      "MOV AX, 0F0F0h\nNOT AX\nHLT",
    ]);
  });

  it("matches on every ALU operation and both operand sizes", () => {
    // Sixteen-bit programs, where the legacy's flags are sound, are compared on
    // everything. The eight-bit ones are compared on their results only: its
    // eight-bit flags are not the 8086's, which `flags-conformance.test.ts`
    // measures and the note at the top of this file explains.
    const sixteenBit: string[] = [];
    const eightBit: string[] = [];
    for (const op of ["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR", "CMP"]) {
      sixteenBit.push(`MOV AX, 1234h\nMOV BX, 0FEDCh\n${op} AX, BX\nHLT`);
      sixteenBit.push(`MOV AX, 0\n${op} AX, 0FFFFh\nHLT`);
      eightBit.push(`MOV AL, 34h\nMOV BL, 12h\n${op} AL, BL\nHLT`);
    }
    // Feeding a carry into ADC or SBB is where the legacy's AF goes wrong even at
    // sixteen bits, so those two keep their own result-only comparison.
    const carryIn: string[] = [];
    for (const op of ["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR", "CMP"]) {
      carryIn.push(`MOV AX, 0FFFFh\nSTC\nMOV BX, 5\n${op} AX, BX\nHLT`);
    }
    expectAllSame(sixteenBit);
    expectAllSame(eightBit, { skipFlags: true });
    expectAllSame(carryIn, { skipFlags: true });
  });

  it("matches on the shifts the legacy has", () => {
    // Sixteen-bit shifts are compared on everything. The eight-bit ones keep
    // their results only, because the legacy's eight-bit SF is not the 8086's
    // (it clears SF for every eight-bit shift, whatever the result's top bit).
    //
    // Every count goes through CL, including the constant ones. The legacy
    // accepts `SHL AX, 4` and so did this engine once, via the 80186 `C1` group
    // -- but a count of 4 has no 8086 encoding, so the two engines can only be
    // compared by writing the 8086 version. `expectAllSame` assembles on both,
    // so an immediate here would now fail the comparison rather than paper over
    // it. The refusal itself is checked in `isa-boundary.test.ts`.
    const sixteenBit: string[] = [];
    const eightBit: string[] = [];
    for (const op of ["SHL", "SHR", "SAL", "SAR"]) {
      for (const count of [1, 4, 9]) {
        sixteenBit.push(`MOV AX, 1234h\nMOV CL, ${count}\n${op} AX, CL\nHLT`);
        eightBit.push(`MOV AL, 34h\nMOV CL, ${count}\n${op} AL, CL\nHLT`);
      }
      // `SHL AX, 1` is the implied-count form and is spelled without CL.
      sixteenBit.push(`MOV AX, 1234h\n${op} AX, 1\nHLT`);
      eightBit.push(`MOV AL, 34h\n${op} AL, 1\nHLT`);
    }
    // A count of zero leaves the register alone and, on the 8086, the flags
    // with it.
    sixteenBit.push("MOV AX, 1234h\nMOV CL, 0\nSHL AX, CL\nHLT");
    sixteenBit.push("MOV AX, 0FFFFh\nMOV CL, 0\nSAR AX, CL\nHLT");
    // More than one shift's worth is masked down to five bits.
    sixteenBit.push("MOV AX, 1234h\nMOV CL, 33\nSHL AX, CL\nHLT");
    expectAllSame(sixteenBit);
    expectAllSame(eightBit, { skipFlags: true });
  });

  it("is the only instruction the legacy takes that this engine refuses", () => {
    // `SHL AX, 4` is the one case where the legacy is more permissive and is
    // wrong to be: 0xC0/0xC1 do not exist on an 8086. Recorded as a named
    // exception rather than left to be rediscovered, because the general rule
    // is that anything the legacy assembles, this engine assembles.
    const legacyOnly = ["SHL AX, 4", "ROL AL, 2", "SHR BX, 3"];
    for (const source of legacyOnly) {
      expect(
        assemble(source, { origin: 0 }).errors.map((e) => e.message),
        `${source} must not assemble: the count has no 8086 encoding`,
      ).not.toEqual([]);
    }
  });

  it("matches on loads, stores and the stack", () => {
    expectAllSame([
      "MOV BX, 300h\nMOV WORD PTR [BX], 1234h\nHLT",
      "MOV BX, 300h\nMOV AL, 5Ah\nMOV BYTE PTR [BX], AL\nHLT",
      "MOV BP, 0F00h\nMOV AX, [BP]\nHLT",
      "MOV BX, 300h\nMOV AX, [BX+2]\nHLT",
      "MOV AX, 1234h\nPUSH AX\nPOP BX\nHLT",
      "MOV AX, 1234h\nPUSH AX\nPUSH AX\nPOP CX\nPOP BX\nHLT",
      "MOV AX, 1234h\nPUSH AX\nADD SP, 2\nHLT",
      "MOV BP, 0F00h\nMOV SP, BP\nMOV WORD PTR [BP+0], 5678h\nHLT",
    ]);
  });

  it("matches on the direct memory offsets, opcodes A0-A3", () => {
    // The four forms that put the address in the instruction instead of a ModR/M
    // byte. The new engine picked the wrong operand slot for the two store forms
    // and dropped them, which the legacy did not: a program that works in the lab
    // would have quietly stopped saving its data under v2.
    expectAllSame([
      "MOV AX, 1234h\nMOV [0200h], AX\nHLT",
      "MOV BX, 0200h\nMOV WORD PTR [BX], 0BEEFh\nMOV AX, [0200h]\nHLT",
      "MOV AX, 1234h\nMOV [0200h], AL\nHLT",
      "MOV BX, 0200h\nMOV WORD PTR [BX], 1234h\nMOV AL, [0200h]\nHLT",
      "MOV AX, 0ABCDh\nMOV [0300h], AX\nMOV BX, 0300h\nMOV CX, [BX]\nHLT",
    ]);
  });

  it("matches on loading a segment register", () => {
    // Segmentation is the one thing the legacy's flat memory cannot check: it
    // holds DS/ES/SS but never uses them to form an address, and it starts DS
    // and ES at 100h where this harness starts the new engine's at 0. So the
    // segment value is compared on its own rather than through the shared
    // projection. The addressing consequence -- a store that lands in the
    // segment that was asked for -- is in cpu.test.ts, with a real segment.
    // `POP ES`/`POP SS` are 8086 instructions that neither assembler here
    // accepts, so the two `MOV` forms are what can be compared. The segment
    // registers are still reachable as a destination in the CPU: the `MOV`
    // forms in cpu.test.ts write ES, DS and a segment into memory.
    const cases: ReadonlyArray<[string, "DS" | "ES" | "SS"]> = [
      ["MOV AX, 1000h\nMOV ES, AX\nHLT", "ES"],
      ["MOV AX, 2000h\nMOV DS, AX\nHLT", "DS"],
    ];
    for (const [source, segment] of cases) {
      const legacyProgram = legacyAssemble(source);
      expect(legacyProgram.errors.filter((e) => e.type === "error").map((e) => e.message)).toEqual([]);
      const legacy = legacyRunProgram(legacyProgram, 5000).finalState.registers[segment];
      const mine = newCpu(source).readReg16(segment);
      expect(mine, source).toBe(legacy & 0xffff);
    }
  });

  it("matches on control flow", () => {
    // The CALL program pushes a return address, which the two load addresses
    // make different, so its stack bytes are left out of the comparison.
    expectSame("CALL sub\nJMP done\nsub: MOV AX, 7\nRET\ndone: HLT", { skipStack: true });
    expectAllSame([
      "MOV AX, 0\nMOV CX, 5\nagain: INC AX\nJNZ again\nHLT",
      "MOV AX, 0\nagain: INC AX\nCMP AX, 5\nJB again\nHLT",
      "MOV AX, 10\nCMP AX, 5\nJLE done\nMOV AX, 0\ndone: HLT",
      "MOV AX, 0\nCMP AX, 0\nJZ done\nMOV AX, 99\ndone: HLT",
      "JMP over\nMOV AX, 1\nover: MOV AX, 2\nHLT",
      "MOV AX, 0\nCMP AX, 0\nJS neg\nJMP fin\nneg: MOV AX, 1\nfin: HLT",
      "MOV AX, 0\nCMP AX, 0\nJO done\nJMP over\ndone: MOV AX, 1\nover: HLT",
      // A forward jump whose operand is a directive word. The legacy allows a
      // label called END; the new assembler used to read `JMP end` as the name
      // "JMP" followed by the END directive and drop the instruction silently.
      "JMP end\nMOV AX, 1\nend: HLT",
    ]);
  });

  it("matches on the flag instructions", () => {
    expectAllSame([
      "STC\nCLC\nCMC\nHLT",
      "MOV AX, 1\nCLC\nADC AX, 1\nHLT",
      "MOV AX, 1\nSTC\nSBB AX, 1\nHLT",
    ]);
  });

  it("matches on extension instructions", () => {
    expectAllSame([
      "MOV AL, 41h\nOUTC AL\nHLT",
      "MOV AL, 42h\nOUT AL\nHLT",
      "MOV AX, 1234h\nMOV BX, 0FFFFh\nMOD BX\nHLT",
      "MOV AL, 19h\nMOV BL, 5\nMOD BL\nHLT",
      "MOV AX, 1234h\nOUTP 1, AX\nHLT",
    ]);
  });

  it("matches on the DOS interrupt surface the lab relies on", () => {
    expectSame("MOV DL, 41h\nMOV AH, 02h\nINT 21h\nHLT");
    // The string is written with instructions rather than declared with DB: the
    // two assemblers lay declared data out at different addresses, so DX would
    // point somewhere else in each. Writing it by hand puts it at the same
    // flat address in both. A declared string is still covered by the new
    // assembler's own tests, and the `$` terminator matters: the legacy reads
    // until it finds one, so an unterminated string is a program bug and the
    // two engines would disagree about how far to read, not about what to print.
    expectSame(
      "MOV BX, 300h\nMOV BYTE PTR [BX], 41h\nMOV BYTE PTR [BX+1], 24h\nMOV DX, 300h\nMOV AH, 09h\nINT 21h\nHLT",
    );
    expectSame("MOV AH, 4Ch\nINT 21h");
    expectSame("INT 20h");
    expectSame("INT 3");
  });

  it("matches on programs that mix everything", () => {
    // A sum over a small array. The legacy's assembler rejects [BX+CX] as a
    // source operand, so the walk advances a pointer instead; the new engine
    // supports both and the pointer form is the one they can share.
    expectAllSame([
      [
        "MOV AX, 0",
        "MOV BX, 300h",
        "MOV CX, 3",
        "count:",
        "  MOV DX, [BX]",
        "  CMP DX, 0",
        "  JE done",
        "  ADD AX, DX",
        "  ADD BX, 2",
        "  DEC CX",
        "  JNZ count",
        "done:",
        "  HLT",
      ].join("\n"),
      [
        "MOV CX, 4",
        "MOV BX, 300h",
        "fill:",
        "  MOV WORD PTR [BX], 0AAAAh",
        "  ADD BX, 2",
        "  DEC CX",
        "  JNZ fill",
        "MOV AX, [300h]",
        "HLT",
      ].join("\n"),
      [
        "MOV SP, 0F00h",
        "MOV BP, 0",
        "MOV AX, 1234h",
        "MOV BX, 5678h",
        "PUSH AX",
        "PUSH BX",
        "POP CX",
        "POP DX",
        "ADD BP, 2",
        "HLT",
      ].join("\n"),
    ]);
  });
});
