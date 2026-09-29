/**
 * What the legacy assembler takes that this engine must also take.
 *
 * The rule this file exists to enforce: **if the legacy assembles it and it is
 * genuinely 8086, the new engine assembles it too.** The legacy is the engine
 * the lab has always run, so anything it refuses is a program that works today
 * and would break on a URL parameter -- the worst kind of surprise a switch can
 * spring.
 *
 * The interesting failures in this area have all been this engine being *wrong*
 * in one direction or the other rather than merely narrower:
 *
 *  - The segment `PUSH`/`POP` forms were rejected because they were believed to
 *    be 80186 additions. They are 8086, and every program using `PUSH DS` broke
 *    on the switch.
 *  - Shift-by-immediate was *accepted*, because it is convenient and it is also
 *    80186. Accepting it is the mirror image of the above and just as wrong.
 *
 * Neither is visible from inside one engine, which is why the comparison is
 * against the legacy rather than against a list.
 *
 * `EXCEPTIONS` is the whole allowance, and it is checked to be exactly that: a
 * new disagreement fails the test rather than being absorbed, so the list cannot
 * quietly grow to mean nothing.
 */

import { describe, expect, it } from "vitest";
import { assemble as legacyAssemble } from "../../emulator/assembler";
import { assemble } from "./assemble";

/**
 * One or more source lines per 8086 instruction family, in this assembler's
 * syntax. Bracketed forms are appended to `HLT` so a lone instruction is a whole
 * program, which is how the legacy wants to be given one.
 */
const CORPUS: readonly string[] = [
  // data movement
  "MOV AL, 1", "MOV AX, 100h", "MOV BL, 1", "MOV BX, 100h",
  "MOV AL, BL", "MOV AX, BX", "MOV AL, [0100h]", "MOV AX, [0100h]",
  "MOV [0100h], AL", "MOV [0100h], AX", "MOV [0100h], 1", "MOV [0100h], 100h",
  "MOV AX, [BX]", "MOV AL, [SI]", "MOV [BX+SI], AX", "MOV AX, [BP+DI]",
  "MOV AX, [BP+SI-2]", "MOV AX, [DI+10h]", "MOV CL, [SI]", "MOV [BP], AL",
  // segment registers -- the family the legacy is loosest about
  "MOV AX, DS", "MOV DS, AX", "MOV ES, AX", "MOV SS, AX", "MOV BX, CS", "MOV CX, ES",
  "MOV SP, SS", "MOV [0100h], DS", "MOV DS, [0100h]",
  // stack, including the segment forms
  "PUSH AX", "PUSH BX", "PUSH CX", "PUSH DX", "PUSH SP", "PUSH BP", "PUSH SI", "PUSH DI",
  "POP AX", "POP BX", "POP CX", "POP DX", "POP SP", "POP BP", "POP SI", "POP DI",
  "PUSH ES", "POP ES", "PUSH CS", "PUSH SS", "POP SS", "PUSH DS", "POP DS",
  "PUSH [0100h]",
  // arithmetic and logic
  "ADD AL, BL", "ADD AX, BX", "ADD AL, 1", "ADD AX, 1", "ADD [0100h], AL",
  "ADD AL, [0100h]", "SUB AL, BL", "SUB AX, 1", "SBB AX, BX", "CMP AL, 1",
  "CMP AX, BX", "AND AL, 0Fh", "OR BL, 80h", "XOR AX, AX", "TEST AL, 1",
  "TEST AX, 100h", "NOT AX", "NEG AX",
  // inc/dec, mul/div
  "INC AX", "INC BX", "INC [0100h]", "DEC AX", "DEC SP", "DEC BP", "DEC SI", "DEC DI",
  "MUL BL", "MUL BX", "IMUL BL", "IMUL BX", "DIV BL", "DIV BX", "IDIV BX",
  // accumulator, stack and memory
  "IN AL, 60h", "IN AX, 60h", "OUT 60h, AL", "OUT 60h, AX", "IN AL, DX", "OUT DX, AX",
  "LEA AX, [0100h]", "LES BX, [0100h]", "LDS BX, [0100h]",
  "PUSHF", "POPF", "SAHF", "LAHF",
  // control transfer
  "JMP 0100h", "CALL 0100h", "RET", "RETF",
  "JE 0100h", "JNE 0100h", "JL 0100h", "JLE 0100h", "JG 0100h", "JGE 0100h",
  "JB 0100h", "JBE 0100h", "JA 0100h", "JAE 0100h", "JO 0100h", "JNO 0100h",
  "JS 0100h", "JNS 0100h", "JP 0100h", "JNP 0100h",
  "LOOP 0100h", "LOOPE 0100h", "LOOPNE 0100h", "LOOPZ 0100h", "LOOPNZ 0100h", "JCXZ 0100h",
  // strings
  "MOVSB", "MOVSW", "CMPSB", "CMPSW", "STOSB", "STOSW",
  "LODSB", "LODSW", "SCASB", "SCASW", "XLAT",
  "REP MOVSB", "REPE SCASB", "REPNE SCASB", "REP STOSW",
  // shifts and rotates, 8086 counts only
  "ROL AL, 1", "ROR AL, 1", "RCL AL, 1", "RCR AL, 1",
  "SHL AL, 1", "SHR AL, 1", "SAR AL, 1", "SHL AX, 1", "SHR [0100h], 1",
  "ROL AL, CL", "ROR BX, CL", "RCL AL, CL", "RCR BX, CL",
  "SHL AL, CL", "SHR AX, CL", "SAR [0100h], CL",
  // flags and bcd
  "CLC", "STC", "CMC", "CLD", "STD", "CLI", "STI",
  "DAA", "DAS", "AAA", "AAS",
  // misc
  "NOP", "HLT", "INT 3", "INT 20h", "INT 21h", "IRET", "WAIT",
  "XCHG AX, BX", "XCHG AL, BL", "CBW", "CWD",
];

/**
 * Forms that are 80186 or later. Both engines are supposed to refuse these, and
 * `isa-boundary.test.ts` is where that is checked. They are listed here too
 * because the legacy does not refuse all of them, and the ones it accepts are
 * what `EXCEPTIONS` has to account for.
 */
const NOT_8086_FORMS: readonly string[] = [
  "SHL AL, 2", "SHR AX, 3", "ROL BX, 4", "SAR AL, 5", "RCL AX, 2", "RCR BX, 3",
  "ENTER", "LEAVE", "RETF 4", "PUSHA", "POPA",
  "INSB", "INSW", "OUTSB", "OUTSW",
  "PUSH 100h", "IMUL AX, BX, 3", "IMUL BX, 3", "BOUND AX, 0100h", "ARPL AX, BX",
];

/**
 * The whole differential allowance: what the legacy assembles, that this engine
 * refuses, and that is not 8086.
 *
 * It is short, and deliberately so. The legacy's own instruction table is
 * narrower than the ISA it runs on -- it has no ENTER, LEAVE, PUSHA, BOUND, the
 * string port I/O, the three-operand IMUL, or RETF with an immediate, and
 * rejects them at validation. So of the twenty-odd non-8086 forms below, only
 * four ever reach the encoder here.
 *
 * Each needs a reason, and the tests below check the list against what the two
 * engines actually do, so an entry cannot go stale and a new disagreement cannot
 * be absorbed.
 */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  "SHL AL, 2": "shift by an immediate is 80186 (C0); a 8086 counts by 1 or CL",
  "SHR AX, 3": "shift by an immediate is 80186 (C1)",
  "SAR AL, 5": "shift by an immediate is 80186 (C0)",
  "PUSH 100h": "PUSH with an immediate is 80186 (68); the operand must be a register or memory",
};

/** A source with a trailing HLT, so the legacy is handed a whole program. */
function program(source: string): string {
  return `${source}\nHLT`;
}

function legacyAccepts(source: string): boolean {
  return legacyAssemble(program(source)).errors.length === 0;
}

function v2Accepts(source: string): boolean {
  return assemble(program(source), { origin: 0x100 }).errors.length === 0;
}

describe("legacy vs v2: assembler coverage", () => {
  it("takes everything the legacy takes, apart from the listed exceptions", () => {
    // Reported as one list rather than a per-source `it`, because the useful
    // failure is the whole set: a regression here usually moves several
    // instructions at once, and seeing them together shows the family.
    const missing: string[] = [];
    for (const source of CORPUS) {
      if (EXCEPTIONS[source] !== undefined) continue;
      if (!legacyAccepts(source)) continue;
      if (!v2Accepts(source)) missing.push(source);
    }
    expect(
      missing,
      "the legacy assembles these but this engine does not, and they are not " +
        "listed in EXCEPTIONS",
    ).toEqual([]);
  });

  it("has an exception for everything the legacy takes and this engine refuses", () => {
    // The list is derived from both engines' actual behaviour and then compared,
    // so it can only be right. A hand-maintained list of the same thing drifts:
    // the entries that were checked in the first test above are exactly the ones
    // that rot, because nothing else looks at them.
    const corpus = [...CORPUS, ...NOT_8086_FORMS];
    const disagreements = corpus
      .filter((source) => legacyAccepts(source) && !v2Accepts(source))
      .sort();
    expect(
      disagreements,
      "the legacy assembles these and this engine does not; every one needs an " +
        "entry in EXCEPTIONS, or the exclusion has to go",
    ).toEqual(Object.keys(EXCEPTIONS).sort());
  });

  it("names a reason for each exception", () => {
    for (const [source, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason, `${source} has no reason`).not.toEqual("");
      expect(NOT_8086_FORMS, `${source} should appear in NOT_8086_FORMS`).toContain(source);
    }
  });

  it("refuses every exception, so the list cannot be quietly wrong", () => {
    const accepted = Object.keys(EXCEPTIONS).filter((source) => v2Accepts(source));
    expect(
      accepted,
      "listed as refused, but this engine assembles it, so the exception is stale",
    ).toEqual([]);
  });

  it("assembles the whole corpus on both engines, exceptions aside", () => {
    // A sanity net on the corpus itself. If a source in CORPUS were malformed,
    // the first test would pass vacuously because the legacy refuses it, and a
    // corpus that tests nothing looks exactly like a corpus that passes.
    const neither = CORPUS.filter((source) => !legacyAccepts(source) && !v2Accepts(source));
    expect(
      neither,
      "neither engine assembles these, so they are testing nothing",
    ).toEqual([]);
  });
});
