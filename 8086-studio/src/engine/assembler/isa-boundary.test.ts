/**
 * The 8086 boundary: what the assembler must accept, and what it must refuse.
 *
 * An 8086 engine is defined as much by what it turns down as by what it runs.
 * Both mistakes are quiet, which is why they need tests rather than a code
 * review:
 *
 *  - **Refusing a real 8086 instruction** breaks a program that works, with a
 *    message that looks like a missing feature. The ISA table did this to the
 *    segment `PUSH`/`POP` forms, which were rejected for years of commits on the
 *    belief that they were 80186 additions. They are not.
 *  - **Accepting a 80186 instruction** is worse, because it does not fail. It
 *    assembles, and it emits bytes a real 8086 cannot execute -- `SHL AL, 2`
 *    came out as `C0 E0 02`, and opcode `C0` is reserved on an 8086. The
 *    program runs correctly in this engine and is unrunnable anywhere else.
 *
 * So both directions are pinned here, and `opcodeSreg`/`one`/`sreg` in the ISA
 * table are what they are checked against.
 */

import { describe, expect, it } from "vitest";
import { assemble } from "./assemble";
import { decode } from "../cpu/decode";

/** `SHL AL, 1` and friends: the count is implied, so no immediate is encoded. */
const IS_8086 = [
  // segment PUSH/POP -- 8086, and the reason the table is not shorter
  "PUSH ES", "POP ES", "PUSH CS", "PUSH SS", "POP SS", "PUSH DS", "POP DS",
  // segment MOV, both directions, register and memory
  "MOV AX, DS", "MOV DS, AX", "MOV ES, AX", "MOV SS, AX", "MOV BX, CS",
  "MOV [0100h], DS", "MOV DS, [0100h]", "MOV SP, SS",
  // arithmetic, both widths, all three addressing styles
  "ADD AL, BL", "ADD AX, BX", "ADD [0100h], AL", "ADD AL, [0100h]",
  "ADD AL, 1", "ADD AX, 1", "SUB AX, BX", "CMP AL, 1", "AND AL, 0Fh",
  "XOR AX, AX", "TEST AX, 100h", "OR BL, 80h",
  // inc/dec, push/pop, mul/div
  "INC AX", "INC WORD PTR [0100h]", "DEC SP", "PUSH AX", "POP BX",
  "PUSH SP", "POP SP", "PUSH WORD PTR [0100h]",
  "MUL BL", "IMUL BX", "DIV BL", "IDIV BX",
  // accumulator and stack
  "IN AL, 60h", "IN AX, 60h", "OUT 60h, AL", "OUT DX, AX", "IN AL, DX",
  "LEA AX, [0100h]", "LES BX, [0100h]", "LDS BX, [0100h]",
  "PUSHF", "POPF", "SAHF", "LAHF",
  // control transfer
  "JMP 0100h", "JMP WORD PTR [0100h]", "CALL 0100h", "RET", "RETF",
  "JE 2", "JNE 2", "JL 2", "JLE 2", "JG 2", "JGE 2", "JB 2", "JBE 2",
  "JO 2", "JNO 2", "JS 2", "JP 2", "JL 2",
  "LOOP 2", "LOOPE 2", "LOOPNE 2", "JCXZ 2",
  // string
  "MOVSB", "MOVSW", "CMPSB", "STOSB", "STOSW", "LODSB", "LODSW", "SCASB",
  "SCASW", "REP MOVSB", "REPE SCASB", "REPNE SCASB",
  // shifts and rotates: by 1, and by CL. Both are 8086. The count is implied
  // or a register -- there is no immediate form.
  "ROL AL, 1", "ROR AL, 1", "RCL AL, 1", "RCR AL, 1",
  "SHL AL, 1", "SHR AL, 1", "SAR AL, 1", "SHL WORD PTR [0100h], 1",
  "ROL AL, CL", "ROR BX, CL", "SHL WORD PTR [0100h], CL", "SAR AL, CL",
  // flags, bcd, misc
  "CLC", "STC", "CMC", "CLD", "STD", "CLI", "STI",
  "DAA", "DAS", "AAA", "AAS", "NOP", "HLT", "INT 3", "INT 21h",
  "XCHG AX, BX", "XCHG AL, BL", "XLAT", "WAIT",
  // mov forms
  "MOV AL, 1", "MOV [0100h], 1", "MOV AL, [BX+SI]", "MOV [BX+SI], AX",
  "MOV AX, [BP+SI-2]", "MOV WORD PTR ES:[0100h], AX", "MOV AX, DS:[BX]",
];

/**
 * 80186 and later. Every one of these must be refused, because the bytes that
 * would implement them are not 8086 instructions. Grouped by why, so the reason
 * a name is here is visible:
 *
 *  - the `60-6F` block: PUSHA/POPA/BOUND/ARPL, `PUSH imm`, the two IMUL
 *    three-operand forms, and the INS/OUTS string I/O
 *  - `C0`/`C1`: shift and rotate by an 8-bit immediate. The 8086 has `D0`/`D1`
 *    (by one) and `D2`/`D3` (by CL) and nothing else
 *  - `C8`/`C9`: ENTER and LEAVE
 *  - `CA`: RETF with an immediate. Plain `RETF` is `CB` and is 8086
 */
const NOT_8086 = [
  "PUSHA", "POPA", "BOUND AX, 0100h", "ARPL AX, BX",
  "PUSH 100h", "IMUL AX, BX, 3", "IMUL BX, 3",
  "INSB", "INSW", "OUTSB", "OUTSW", "INS BYTE PTR ES:[DI], DX", "OUTS",
  "ROL AL, 2", "ROR AL, 3", "RCL BX, 4", "RCR BX, 5",
  "SHL AL, 2", "SHR AX, 3", "SHL BX, 4", "SAR AL, 5", "SAL AL, 2",
  "ENTER 8, 0", "LEAVE", "RETF 4",
];

function accepts(source: string): boolean {
  return assemble(source, { origin: 0x100 }).errors.length === 0;
}

describe("the assembler accepts the 8086 instruction set", () => {
  it.each(IS_8086)("%s", (source) => {
    const result = assemble(source, { origin: 0x100 });
    expect(result.errors.map((d) => d.message), `${source} must assemble`).toEqual([]);
  });

  it("keeps the shift count out of the opcode when it is 1", () => {
    // `SHL AL, 1` is D0 E0. The immediate form is C0 E0 01, which is 80186 --
    // so this is the assertion that distinguishes the two.
    expect(Array.from(assemble("SHL AL, 1", { origin: 0 }).image.subarray(0, 2))).toEqual([0xd0, 0xe0]);
  });

  it("encodes the shift-by-CL form as D2, which is the 8086 spelling", () => {
    expect(Array.from(assemble("SHL AL, CL", { origin: 0 }).image.subarray(0, 2))).toEqual([0xd2, 0xe0]);
  });
});

describe("the assembler refuses instructions that postdate the 8086", () => {
  it.each(NOT_8086)("%s", (source) => {
    expect(accepts(source), `${source} is not an 8086 instruction`).toBe(false);
  });

  it("names the 8086 boundary in the error, not a generic failure", () => {
    // A bare "unknown instruction" sends people looking for a typo. The
    // rejection should say the instruction is out of period.
    const result = assemble("SHL AL, 2", { origin: 0x100 });
    const message = result.errors.map((d) => d.message).join("; ");
    expect(message).toMatch(/8086|80186|shift/i);
  });

  it("refuses a non-8086 form without affecting the 8086 one beside it", () => {
    // The risk in removing C0/C1 is collateral damage to D0/D2.
    expect(accepts("SHL AL, 1")).toBe(true);
    expect(accepts("SHL AL, CL")).toBe(true);
    expect(accepts("SHL AL, 2")).toBe(false);
  });
});

describe("the decoder does not claim opcodes the 8086 left unassigned", () => {
  it.each([
    [0x60, "PUSHA"], [0x61, "POPA"], [0x62, "BOUND"], [0x63, "ARPL"],
    [0x68, "PUSH imm16"], [0x69, "IMUL r,rm,imm16"], [0x6a, "PUSH imm8"],
    [0x6b, "IMUL r,rm,imm8"],
    [0x6c, "INSB"], [0x6d, "INSW"], [0x6e, "OUTSB"], [0x6f, "OUTSW"],
    [0xc0, "ROL r/m8, imm8"], [0xc1, "ROL r/m16, imm8"],
    [0xc8, "ENTER"], [0xc9, "LEAVE"], [0xca, "RETF imm16"],
  ])("%s is not decoded as %s", (opcode, name) => {
    const result = decode(Uint8Array.of(opcode as number, 0, 0, 0, 0, 0));
    expect(
      result.ok,
      `0x${(opcode as number).toString(16)} decoded as ${result.text}, which is ${name}`,
    ).toBe(false);
  });

  it("still decodes the 8086 instruction that shares the 0xCA/0xCB pair", () => {
    // `RETF` is 0xCB and is 8086. Rejecting the immediate form must not take
    // the plain one with it.
    expect(decode(Uint8Array.of(0xcb)).mnem).toBe("RETF");
  });
});
