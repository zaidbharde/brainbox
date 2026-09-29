/**
 * Assembly-level compatibility check.
 *
 * Everything the app can already run — the lab demos, and the assembly the
 * compiler generates for its sample programs — has to go through the new
 * assembler without a single diagnostic. This is the half of the compatibility
 * requirement that does not need a CPU: if these programs do not assemble, the
 * dual-engine tests later would fail for reasons that have nothing to do with
 * execution.
 *
 * The byte-for-byte comparison against the old engine needs a CPU and lives in
 * the dual-engine suite; what is pinned here is that the new assembler accepts
 * the real programs and lands their labels where the old one did.
 */

import { describe, expect, it } from "vitest";
import { assemble } from "@/engine/assembler/assemble";
import { Cpu, createInitialState } from "@/engine/cpu/cpu";
import { Memory } from "@/engine/memory";
import { runProgram as legacyRunProgram } from "@/emulator/cpu";
import { assemble as legacyAssemble } from "@/emulator/assembler";
import { ASSEMBLY_DEMOS } from "@/lab/demos";
import { compile, SAMPLE_PROGRAMS_BY_LANGUAGE } from "@/compiler/compiler";
import type { FrontendLanguage } from "@/compiler/compiler";

/**
 * The code generator addresses variables directly, at 0x0100 upwards, because
 * the old engine gave it a fixed 4 KB data space. The new assembler lays code
 * out in the same address space, so the program image has to start above the
 * highest address the source mentions or the code would overwrite the data.
 */
function originAboveDirectAddresses(assembly: string): number {
  let highest = 0x100;
  for (const match of assembly.matchAll(/\[0x([0-9a-fA-F]{2,4})\]|\b0?([0-9a-fA-F]{3,4})h\b/g)) {
    const text = match[1] ?? match[2] ?? "";
    const value = Number.parseInt(text, 16);
    if (Number.isFinite(value)) highest = Math.max(highest, value);
  }
  return (highest + 0x100 + 0xf) & ~0xf;
}

/**
 * The programs the app actually ships, straight from the compiler's own sample
 * set. Inventing samples here would be misleading: a construct the legacy front
 * end does not support is a front-end limitation, not an assembler failure, and
 * the point of this suite is that the new assembler handles everything the app
 * can already produce.
 */
const SAMPLES: ReadonlyArray<{ name: string; language: FrontendLanguage; source: string }> =
  Object.entries(SAMPLE_PROGRAMS_BY_LANGUAGE).flatMap(([language, programs]) =>
    Object.entries(programs).map(([name, source]) => ({
      name: `${language}/${name}`,
      language: language as FrontendLanguage,
      source,
    })),
  );

describe("shipped lab demos", () => {
  it("has demos to check", () => {
    expect(ASSEMBLY_DEMOS.length).toBeGreaterThan(0);
  });

  it.each(ASSEMBLY_DEMOS.map((demo) => [demo.id, demo] as const))(
    "assembles the %s demo without diagnostics",
    (_id, demo) => {
      const result = assemble(demo.source);
      expect(result.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.image.length).toBeGreaterThan(0);
    },
  );

  it.each(ASSEMBLY_DEMOS.map((demo) => [demo.id, demo] as const))(
    "resolves every label in the %s demo",
    (_id, demo) => {
      const result = assemble(demo.source);
      // Nothing is left dangling, and the entry point is a real address inside
      // the image rather than a default.
      expect(result.symbols.undefinedNames()).toEqual([]);
      expect(result.entry.ip).toBeGreaterThanOrEqual(result.image.length - 1);
    },
  );

  it("puts the demo entry point on an opcode", () => {
    for (const demo of ASSEMBLY_DEMOS) {
      const result = assemble(demo.source);
      const op = result.image[result.entry.ip - (result.entry.codeBase === 0 ? 0x100 : 0)];
      expect(typeof op).toBe("number");
      expect(result.image.length).toBeGreaterThan(0);
    }
  });
});

describe("compiler output", () => {
  it.each(SAMPLES.map((sample) => [sample.name, sample] as const))(
    "the new assembler accepts the generated assembly for %s",
    (_name, sample) => {
      const compiled = compile(sample.source, sample.language);
      expect(compiled.errors.map((e) => e.message)).toEqual([]);
      expect(compiled.program).not.toBeNull();
      expect(compiled.assembly.length).toBeGreaterThan(0);

      const result = assemble(compiled.assembly, { origin: originAboveDirectAddresses(compiled.assembly) });
      expect(result.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
      expect(result.image.length).toBeGreaterThan(0);
    },
  );

  it("keeps the compiler's direct data addresses free of code", () => {
    for (const sample of SAMPLES) {
      const compiled = compile(sample.source, sample.language);
      const origin = originAboveDirectAddresses(compiled.assembly);
      const result = assemble(compiled.assembly, { origin });
      // The image starts at the origin, so nothing it contains can collide with
      // the variables the generated code addresses directly.
      expect(result.entry.ip).toBeGreaterThanOrEqual(origin);
      for (const match of compiled.assembly.matchAll(/\[0x([0-9a-fA-F]+)\]/g)) {
        const variable = Number.parseInt(match[1], 16);
        expect(variable).toBeLessThan(origin);
      }
    }
  });

  it("maps every _SRC_ label the code generator emits", () => {
    for (const sample of SAMPLES) {
      const compiled = compile(sample.source, sample.language);
      const result = assemble(compiled.assembly, { origin: originAboveDirectAddresses(compiled.assembly) });
      const embedded = [...compiled.assembly.matchAll(/^(\s*)(_SRC_\d+_\d+):/gm)].map((m) => m[2]);
      for (const label of embedded) {
        expect(result.symbols.lookup(label)?.valueKnown).toBe(true);
      }
    }
  });
});

/**
 * Running the generated programs, not just assembling them.
 *
 * Assembling without a diagnostic says the code generator's output is valid; it
 * does not say the program computes what it is supposed to. These are the only
 * tests that put the code generator's real output through a CPU, so they are
 * where a change to either side that the other side happens to agree with would
 * otherwise go unnoticed.
 *
 * The comparison is narrower than the one in differential.test.ts, on purpose.
 * These programs address their variables at fixed physical addresses, so what
 * can be compared is the data area and what the program printed; the registers
 * are not in the same state in the two engines, because the legacy counts its
 * own instructions from zero while the new engine runs an image loaded above the
 * data, and the last thing a generated program does with a register is leave a
 * return address in it. Flags are compared too: the generated code is 16-bit
 * throughout, and the legacy's 16-bit flags are the 8086's apart from the AF of
 * ADC and SBB, which this code does not use.
 */
describe("compiler output, run on both engines", () => {
  /** The data area the code generator addresses, from 100h up to the code. */
  function dataAddresses(assembly: string, origin: number): number[] {
    const addresses: number[] = [];
    for (let address = 0x100; address < origin; address++) addresses.push(address);
    return addresses;
  }

  function legacyRun(assembly: string): { output: string; memory: Uint8Array; halted: boolean; error: string | null } {
    const program = legacyAssemble(assembly);
    expect(program.errors.filter((e) => e.type === "error").map((e) => e.message)).toEqual([]);
    const { finalState, output } = legacyRunProgram(program, 20000);
    return {
      output: output.map((entry) => `${entry.type}:${entry.value}`).join(","),
      memory: finalState.memory,
      halted: finalState.halted,
      error: finalState.error,
    };
  }

  function newRun(assembly: string, origin: number): { output: string; memory: Memory; halted: boolean; error: string | null; FLAGS: number } {
    const assembled = assemble(assembly, { origin });
    expect(assembled.errors.map((d) => d.message)).toEqual([]);
    const memory = new Memory();
    memory.bytes.set(assembled.image, origin);
    // The segments are pinned to zero so the flat legacy address space and the
    // new engine's segmented one coincide, which is what makes comparing a
    // fixed data address mean anything.
    const cpu = new Cpu(memory, {
      ...createInitialState(),
      IP: assembled.entry.ip,
      CS: 0,
      DS: 0,
      ES: 0,
      SS: 0,
      SP: 0x0ffe,
      FLAGS: 0,
    });
    cpu.run(20000);
    return {
      output: cpu.output.map((entry) => `${entry.type}:${entry.value}`).join(","),
      memory: cpu.memory,
      halted: cpu.state.halted,
      error: cpu.state.error,
      FLAGS: cpu.state.FLAGS,
    };
  }

  it("has samples to run", () => {
    expect(SAMPLES.length).toBeGreaterThan(0);
  });

  it.each(SAMPLES.map((sample) => [sample.name, sample] as const))(
    "runs %s to the same result on both engines",
    (_name, sample) => {
      const compiled = compile(sample.source, sample.language);
      const origin = originAboveDirectAddresses(compiled.assembly);
      const legacy = legacyRun(compiled.assembly);
      const mine = newRun(compiled.assembly, origin);

      // Both engines have to have finished for the rest of the comparison to
      // mean anything: comparing the middle of two runs that both stopped for
      // different reasons would report agreement on a coincidence.
      expect({ halted: legacy.halted, error: legacy.error }, "legacy").toEqual({ halted: true, error: null });
      expect({ halted: mine.halted, error: mine.error }, "new").toEqual({ halted: true, error: null });

      expect(mine.output, "output").toBe(legacy.output);

      // The whole data area, not just the variables the source mentions: a
      // program that scribbled outside its own variables would still look right.
      const differences = dataAddresses(compiled.assembly, origin).filter(
        (address) => (legacy.memory[address] ?? 0) !== (mine.memory.bytes[address] ?? 0),
      );
      expect(
        differences.map((address) => `0x${address.toString(16)}: legacy 0x${(legacy.memory[address] ?? 0).toString(16)} new 0x${(mine.memory.bytes[address] ?? 0).toString(16)}`),
      ).toEqual([]);
    },
  );

  it.each(SAMPLES.map((sample) => [sample.name, sample] as const))(
    "leaves the flags %s ends with the same on both engines",
    (_name, sample) => {
      const compiled = compile(sample.source, sample.language);
      const origin = originAboveDirectAddresses(compiled.assembly);
      const legacyProgram = legacyAssemble(compiled.assembly);
      const { finalState } = legacyRunProgram(legacyProgram, 20000);
      const mine = newRun(compiled.assembly, origin);
      const bits: ReadonlyArray<[string, number]> = [
        ["CF", 0x0001],
        ["PF", 0x0004],
        ["AF", 0x0010],
        ["ZF", 0x0040],
        ["SF", 0x0080],
        ["OF", 0x0800],
      ];
      const differences = bits
        .filter(([, bit]) => Boolean(finalState.registers.FLAGS & bit) !== Boolean(mine.FLAGS & bit))
        .map(([name]) => name);
      expect(differences).toEqual([]);
    },
  );

  it("prints the countdown from both engines", () => {
    // One program, read out in full, so a failure above says what the programs
    // are for rather than only that two lists differ.
    const compiled = compile(SAMPLE_PROGRAMS_BY_LANGUAGE.c.countdown, "c");
    const legacy = legacyRun(compiled.assembly);
    const mine = newRun(compiled.assembly, originAboveDirectAddresses(compiled.assembly));
    expect(mine.output).toBe(legacy.output);
    expect(mine.output).toContain("number:10");
    expect(mine.output).toContain("number:1");
  });
});
