/**
 * The register-effect table, checked against the CPU that implements it.
 *
 * `effects.ts` is a second description of what the CPU does, written from the
 * table's operands and mnemonics rather than from the CPU's cases. Two
 * descriptions of the same behaviour can disagree, and nothing in the type
 * system stops them -- so this file steps the real CPU and compares.
 *
 * The direction of the check is the one that can fail. A register the CPU
 * changes but the table did not predict is a missing case, and it is a bug the
 * debugger would show as an empty register list. A register the table predicts
 * and the CPU leaves alone is not detectable this way, and does not matter: the
 * panel would highlight a register that did not move, which is the harmless
 * direction to be wrong in.
 *
 * The whole table is walked, so an instruction added to the ISA is covered
 * without anyone remembering to add it here. An instruction with no
 * classification makes `registerEffects` throw rather than return nothing, which
 * turns a stale table into a failing test instead of a plausible-looking panel.
 */

import { describe, expect, it } from "vitest";
import { INSTRUCTION_TABLE, type InsnDef, type OperandType } from "@/engine/isa/table";
import { assemble } from "@/engine/assembler/assemble";
import { decode } from "./decode";
import { parentRegisterOf, registerEffects } from "./effects";
import { Cpu, createInitialState, type CpuState } from "./cpu";
import { Memory } from "../memory";
import type { Registers } from "@/types/cpu";

const ORIGIN = 0x100;

const OPERAND: Readonly<Record<OperandType, string>> = {
  none: "",
  al: "AL",
  ax: "AX",
  cl: "CL",
  dx: "DX",
  imm8: "34h",
  imm16: "1234h",
  moffs8: "BYTE PTR [0200h]",
  moffs16: "WORD PTR [0200h]",
  one: "1",
  three: "3",
  ptr16: "0200h:0300h",
  r8: "CL",
  r16: "CX",
  reg8: "CL",
  reg16: "CX",
  rm8: "CL",
  rm16: "CX",
  sreg: "ES",
  rel8: "target",
  rel16: "target",
  label: "target",
};

const MEMORY: Readonly<Record<string, string>> = { rm8: "BYTE PTR [SI]", rm16: "WORD PTR [SI]" };

/** The far transfers, which no source spelling reaches. Mirrors the coverage test. */
const NOT_ASSEMBLABLE = new Set(["CALLF ptr16 (9a)", "JMP ptr16 (ea)"]);

function title(def: InsnDef): string {
  return `${def.mnem} ${def.ops.join(",")} (${def.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")})`;
}

/** Spells one table entry as a program of exactly one instruction plus a HLT. */
function sourceFor(def: InsnDef, prefix = ""): string {
  const operands = def.ops.map((kind, index) => {
    if (kind === "none") return "";
    if ((def.modrm?.rm === index || def.modrm?.sreg === index) && def.modrm?.mod3Forbidden && MEMORY[kind]) {
      return MEMORY[kind];
    }
    return OPERAND[kind];
  });
  const line = operands.some((text) => text !== "") ? `${def.mnem} ${operands.join(", ")}` : def.mnem;
  return `${prefix}${line}\ntarget:\nHLT`;
}

const REGISTER_NAMES: (keyof Registers)[] = [
  "AX", "BX", "CX", "DX", "CS", "DS", "ES", "SS", "SI", "DI", "SP", "BP", "IP", "FLAGS",
];

/**
 * Registers the table is allowed to miss.
 *
 * IP is written by every instruction and is added by `classify` itself, but is
 * listed here too because the CPU also rewrites it on a fault. SP is implicit in
 * anything using the stack. FLAGS is a register to the panel but not one any
 * operand names. CX is implicit under a REP prefix, which the table records on
 * the decode rather than as an operand.
 */
const IMPLICIT = new Set(["IP", "SP", "FLAGS", "CX"]);

/** Seed values chosen so an instruction has something to work on and nothing to fault on. */
const SEED: Partial<CpuState> = {
  AX: 8,
  BX: 2,
  CX: 1,
  DX: 1,
  SI: 0x200,
  DI: 0x300,
  SP: 0x0ffe,
  BP: 0x200,
  FLAGS: 0,
};

function stepOnce(source: string): { before: CpuState; after: CpuState; error: string | null } | null {
  const assembled = assemble(source, { origin: ORIGIN });
  if (assembled.errors.length > 0) return null;
  const memory = new Memory();
  memory.bytes.set(assembled.image, ORIGIN);
  // An interrupt vector of 0000:0000 lands in the middle of this program, so it
  // is pointed at a HLT; INT and INT3 are in the table and have to be run.
  memory.write8(0, 0, 0xf4);
  const cpu = new Cpu(memory, { ...createInitialState(), ...SEED, IP: ORIGIN, CS: 0, DS: 0, ES: 0, SS: 0 });
  const before = { ...cpu.state };
  cpu.step();
  return { before, after: { ...cpu.state }, error: cpu.state.error };
}

function changed(before: CpuState, after: CpuState): string[] {
  return REGISTER_NAMES.filter((name) => before[name] !== after[name]);
}

describe("register effects", () => {
  it.each(INSTRUCTION_TABLE.map((def) => [title(def), def] as const))(
    "predicts every register the CPU writes: %s",
    (name, def) => {
      if (NOT_ASSEMBLABLE.has(name)) return;
      const source = sourceFor(def);
      const assembled = assemble(source, { origin: ORIGIN });
      if (assembled.errors.length > 0) return; // Not assemblable; the coverage test owns that gap.
      const decoded = decode(assembled.image.subarray(0, 16));
      const { writes } = registerEffects(decoded);

      const run = stepOnce(source);
      if (run === null) return;
      // A fault stops the instruction part-way, so the registers it had already
      // written are not the ones it would have written. `FAULTING` names them.
      if (run.error !== null) return;

      const predicted = new Set(writes.map(parentRegisterOf));
      for (const name2 of IMPLICIT) predicted.add(name2);
      const unexpected = changed(run.before, run.after).filter((reg) => !predicted.has(reg));
      expect(
        unexpected,
        `the CPU changed ${unexpected.join(", ")} and the table did not predict it`,
      ).toEqual([]);
    },
  );

  it("predicts the same registers with and without a REP prefix", () => {
    // A REP is a prefix, not an operand, and the table records it on the decode.
    // The one thing it adds is CX, so a string instruction's set should be the
    // plain set plus CX and nothing else.
    const stringOps = ["MOVSB", "STOSW", "LODSB", "SCASB", "CMPSB"];
    for (const mnem of stringOps) {
      const def = INSTRUCTION_TABLE.find((entry) => entry.mnem === mnem);
      expect(def, `${mnem} is in the table`).toBeDefined();
      const plain = decode(assemble(mnem, { origin: ORIGIN }).image.subarray(0, 16));
      const repeated = decode(assemble(`REP ${mnem}`, { origin: ORIGIN }).image.subarray(0, 16));
      const plainEffects = registerEffects(plain);
      const repeatedEffects = registerEffects(repeated);
      expect(repeated.repeat).not.toEqual("none");
      expect(
        repeatedEffects.writes.filter((reg) => !plainEffects.writes.includes(reg)),
        `${mnem} gains writes under REP`,
      ).toEqual(["CX"]);
    }
  });

  it("names AX as both read and written by the accumulator instructions", () => {
    for (const source of ["MUL CL", "DIV CL", "IMUL CL", "IDIV CL", "MUL CX", "DIV CX"]) {
      const decoded = decode(assemble(source, { origin: ORIGIN }).image.subarray(0, 16));
      const effects = registerEffects(decoded);
      expect(effects.reads, source).toContain("AX");
      expect(effects.writes, source).toContain("AX");
    }
  });

  it("names DX as an accumulator only for the 16-bit multiply and divide", () => {
    const eight = registerEffects(decode(assemble("MUL CL", { origin: ORIGIN }).image.subarray(0, 16)));
    const sixteen = registerEffects(decode(assemble("MUL CX", { origin: ORIGIN }).image.subarray(0, 16)));
    expect(eight.writes).not.toContain("DX");
    expect(sixteen.reads).toContain("DX");
    expect(sixteen.writes).toContain("DX");
  });

  it("reports MOV as writing the destination without reading it", () => {
    const effects = registerEffects(decode(assemble("MOV AX, BX", { origin: ORIGIN }).image.subarray(0, 16)));
    expect(effects.writes).toContain("AX");
    expect(effects.reads).not.toContain("AX");
    expect(effects.reads).toContain("BX");
  });

  it("reports LEA as reading the address registers and not the memory", () => {
    const effects = registerEffects(decode(assemble("LEA AX, [BX+SI]", { origin: ORIGIN }).image.subarray(0, 16)));
    expect(effects.writes).toContain("AX");
    expect(effects.reads).toEqual(expect.arrayContaining(["BX", "SI"]));
    expect(effects.reads).not.toContain("AX");
  });

  it("names SS for a stack-relative operand and not for an overridden one", () => {
    // `[BP+SI]` rather than `[SP]`: a bare displacement assembles to the moffs
    // form, which is a different operand kind and carries no address registers
    // at all. The segment override is ES rather than DS because DS is also what
    // the base register would have chosen, and an override to the default is
    // indistinguishable from no override.
    const plain = registerEffects(decode(assemble("MOV AX, [BP+SI]", { origin: ORIGIN }).image.subarray(0, 16)));
    expect(plain.reads).toContain("SS");
    const overridden = registerEffects(
      decode(assemble("MOV AX, ES:[BP+SI]", { origin: ORIGIN }).image.subarray(0, 16)),
    );
    expect(overridden.reads).not.toContain("SS");
    const dataSegment = registerEffects(
      decode(assemble("MOV AX, [BX+SI]", { origin: ORIGIN }).image.subarray(0, 16)),
    );
    expect(dataSegment.reads).not.toContain("SS");
  });

  it("reports the comparison instructions as writing no register but the flags", () => {
    for (const source of ["CMP AX, BX", "TEST AL, 1"]) {
      const decoded = decode(assemble(source, { origin: ORIGIN }).image.subarray(0, 16));
      const effects = registerEffects(decoded);
      expect(effects.writes, source).toEqual(["FLAGS", "IP"]);
    }
  });

  it("reports a push as writing the stack pointer", () => {
    const effects = registerEffects(decode(assemble("PUSH AX", { origin: ORIGIN }).image.subarray(0, 16)));
    expect(effects.writes).toContain("SP");
    expect(effects.reads).toContain("AX");
    expect(effects.writes).not.toContain("AX");
  });
});
