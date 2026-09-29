/**
 * The assembler must not be able to produce a program the CPU cannot run.
 *
 * The ISA table is the single source of truth for what the engine can encode, and
 * the CPU's execution is keyed on the same mnemonic. Those are two separate
 * lists, and nothing in the type system or at runtime checks that they agree --
 * so an instruction can be added to the table, assemble cleanly, and then stop
 * the program the moment it is reached, with `unimplemented instruction` as the
 * only symptom.
 *
 * That is not hypothetical. `NOP` was in the table and decoded, and the CPU had
 * no case for it, so every program the compiler's own code generator emitted
 * died on its first padding byte. The dual-engine tests in `compatibility.test.ts`
 * found it, and only because they run the generated programs rather than
 * assembling them.
 *
 * So the check is stated as an invariant over the whole table: for every
 * instruction definition, the assembler accepts a spelling of it and the CPU
 * executes it. A new table entry is covered by this test without anyone having to
 * remember to add it anywhere.
 *
 * The instruction is run for a few steps with registers seeded to values that
 * keep it from faulting, and the only thing asserted is that the CPU did not
 * report it as unimplemented. What each instruction actually computes is checked
 * in `cpu.test.ts` and `differential.test.ts`; repeating that here would test
 * the table, not the wiring, and a test that only looks for one string in an
 * error field is the whole point of this file.
 */

import { describe, expect, it } from "vitest";
import { INSTRUCTION_TABLE, type InsnDef, type OperandType } from "@/engine/isa/table";
import { assemble } from "@/engine/assembler/assemble";
import { Cpu, createInitialState } from "./cpu";
import { Memory } from "../memory";

const ORIGIN = 0x100;

/**
 * A source operand for each kind the table can name.
 *
 * `rm8`/`rm16` are registers here, which is legal for almost everything. The
 * exceptions are the instructions whose table entry says `mod3Forbidden` -- LEA,
 * LES and LDS -- and those are given a memory operand instead, below. Picking a
 * register for them would assemble to the `reg` form of the opcode, which is a
 * different instruction, and the test would pass on the wrong encoding.
 */
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

/** The memory spelling of an `rm` operand, for the entries that require one. */
const MEMORY: Readonly<Record<string, string>> = { rm8: "BYTE PTR [SI]", rm16: "WORD PTR [SI]" };

/**
 * Table entries the assembler cannot produce, named with the reason.
 *
 * These are the opposite of a bug: the table can decode and the CPU can execute
 * them, but no source spelling reaches the encoder, so this test cannot feed them
 * in. Listing them is what makes the gap visible -- an entry added here has
 * stopped being a known limitation, and whoever adds it has to say so.
 *
 * The two far transfers are the whole list. `CALLF` (9Ah) has no encoding at all:
 * a bare label is a `target`, and the far-pointer path in the encoder takes its
 * offset from a memory operand, so the `ptr16` slot never matches anything the
 * parser produces. `JMP 0EAh` is reachable in principle but is never chosen,
 * because a bare label also matches `rel8`/`rel16` and the encoder prefers the
 * narrowest form that arrives -- so `JMP label` is always the near jump.
 *
 * Neither is a compatibility gap: the legacy assembler has no far CALL or JMP
 * either, so no program the lab can already run needs them. What is missing is a
 * source syntax for a far pointer, which is a decision about the assembler's
 * language rather than a hole in it, and it is left alone here on purpose.
 */
const NOT_ASSEMBLABLE: Readonly<Record<string, string>> = {
  "CALLF ptr16 (9a)": "no source spelling produces a far pointer",
  "JMP ptr16 (ea)": "a bare label always takes the near form",
};

/** Spells one table entry as a line of source. */
function sourceFor(def: InsnDef): string {
  const operands = def.ops.map((kind, index) => {
    if (kind === "none") return "";
    // The r/m field is only the one the entry points at; on a `mod3Forbidden`
    // entry it has to be memory, whatever the generic spelling is. LEA encodes
    // to a different opcode in the register form, so using a register here would
    // quietly test the wrong instruction.
    if ((def.modrm?.rm === index || def.modrm?.sreg === index) && def.modrm?.mod3Forbidden && MEMORY[kind]) {
      return MEMORY[kind];
    }
    return OPERAND[kind];
  });
  const line = operands.some((text) => text !== "") ? `${def.mnem} ${operands.join(", ")}` : def.mnem;
  // A branch target has to exist, and an interrupt vector has to point somewhere
  // that is not the middle of the program.
  return `${line}\ntarget:\nHLT`;
}

/** A CPU with the registers the instructions need, run a few steps. */
function execute(source: string): { error: string | null; halted: boolean } {
  const assembled = assemble(source, { origin: ORIGIN });
  expect(assembled.errors.map((d) => d.message), `assembling ${JSON.stringify(source)}`).toEqual([]);
  const memory = new Memory();
  memory.bytes.set(assembled.image, ORIGIN);
  // An interrupt vector of 0000:0000 would land on whatever is at the bottom of
  // memory, so the vector table is pointed at a HLT. INT and INT3 are in the
  // table and have to be executed like anything else.
  memory.write8(0, 0, 0xf4);
  const cpu = new Cpu(memory, {
    ...createInitialState(),
    IP: ORIGIN,
    CS: 0,
    DS: 0,
    ES: 0,
    SS: 0,
    // DX is non-zero because DIV and IDIV fault on a zero divisor, and the
    // string instructions read a port number out of it. AX and BX give MUL and
    // IMUL something to multiply, CX a count, and SI/DI an address that is not
    // the program itself.
    AX: 8,
    BX: 2,
    CX: 1,
    DX: 1,
    SI: 0x200,
    DI: 0x300,
    SP: 0x0ffe,
    FLAGS: 0,
  });
  cpu.run(4);
  return { error: cpu.state.error, halted: cpu.state.halted };
}

describe("every table instruction is one the CPU can run", () => {
  it("has table entries to check", () => {
    expect(INSTRUCTION_TABLE.length).toBeGreaterThan(200);
  });

  it.each(INSTRUCTION_TABLE.map((def) => [title(def), def] as const))(
    "executes %s",
    (name, def) => {
      const reason = NOT_ASSEMBLABLE[name];
      if (reason !== undefined) {
        // Listed as a known gap, not silently passed over. The assembler is
        // checked here only to confirm the reason still holds: if this ever
        // assembles, the exception is stale and should be deleted.
        const assembled = assemble(sourceFor(def), { origin: ORIGIN });
        expect(
          assembled.errors.map((d) => d.message).join("; "),
          `${name} now assembles, so it is no longer a known gap`,
        ).not.toEqual("");
        return;
      }
      const { error } = execute(sourceFor(def));
      expect(error ?? "").not.toMatch(/unimplemented instruction/);
    },
  );

  it("lists only entries that exist", () => {
    // A typo in an exception would otherwise quietly stop covering a real
    // instruction, which is the one failure this file cannot be allowed to have.
    const names = new Set(INSTRUCTION_TABLE.map(title));
    for (const listed of Object.keys(NOT_ASSEMBLABLE)) {
      expect(names, `${listed} is listed as a known gap but is not in the table`).toContain(listed);
    }
  });
});

/** A readable name for one table entry, used as the test title. */
function title(def: InsnDef): string {
  const bytes = def.bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  const ops = def.ops.join(", ");
  return `${def.mnem}${ops ? ` ${ops}` : ""} (${bytes})`;
}
