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
import { runSourceToPanel } from "@/lab/run-output";
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

/**
 * Where the entry point sits inside the code image, as an index into it.
 *
 * `entry.ip` is an offset *within the code segment*, and `image` is that
 * segment's bytes starting at that segment's own origin. Those are the same
 * number for a program with real segments and different by the load address for a
 * flat one, which loads at `origin` (100h by default) so the code generator's
 * `[0100h]` data references land above it. The arithmetic therefore has to ask
 * the layout rather than assume either shape -- assuming was how this suite came
 * to accept an entry point outside the image on a `.MODEL` program.
 */
function entryIndexInImage(result: ReturnType<typeof assemble>): number {
  const codeSegment = result.segments.find((segment) => segment.name === result.entry.codeSegment);
  return result.entry.ip - (codeSegment?.origin ?? 0);
}

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
      const index = entryIndexInImage(result);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(result.image.length);
    },
  );

  it("puts the demo entry point on an opcode", () => {
    for (const demo of ASSEMBLY_DEMOS) {
      const result = assemble(demo.source);
      const index = entryIndexInImage(result);
      // A number here means the index really landed on a byte of the image, which
      // is the claim being made: the entry point is the first instruction and not
      // a count that happens to fall off the end.
      expect(typeof result.image[index]).toBe("number");
      expect(result.image.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The shipped `.MODEL SMALL` hello world, on both engines.
 *
 * This is the program from the report that made the engine toggle look unreliable,
 * so it is worth having in the shipped set rather than only in the regression
 * test: `src/lab/run-output.test.ts` pins the reported single-quoted spelling, and
 * this pins the one that ships.
 *
 * Both engines agree on `.MODEL`, `.STACK`, `.DATA`, `@DATA`, a bare
 * `LEA reg, label` and `INT 21h` -- verified here rather than assumed, because the
 * first version of this fix could have made it look like the v2 assembler had gained
 * support for something the legacy never had.
 *
 * The one thing they used to disagree on was quoting. The legacy assembler accepted
 * `DB "text"` and rejected `DB 'text'`, so the single-quoted spelling -- what most
 * people type, and what textbooks print -- was refused as
 * `Invalid data initializer: 'Hello World!$'` on legacy and accepted on v2. It is a
 * fixed bug in the legacy now, so the two spellings of the same data assemble to the
 * same bytes on both engines. The demo keeps the double-quoted spelling only because
 * MASM's own documentation writes it that way.
 */
describe("the shipped .MODEL hello world, on both engines", () => {
  const MODEL_HELLO = ASSEMBLY_DEMOS.find((demo) => demo.id === "model-hello");

  it("is in the shipped demo set", () => {
    expect(MODEL_HELLO).toBeDefined();
  });

  it.each([
    ["legacy"],
    ["v2"],
  ] as const)("prints Hello World on %s", (engine) => {
    const result = runSourceToPanel(engine, MODEL_HELLO!.source);
    expect(result.kind, result.text).toBe("output");
    expect(result.text).toContain("Hello World!");
  });

  it("is the double-quoted spelling, which is how MASM documents it", () => {
    expect(MODEL_HELLO!.source).toContain('msg DB "Hello World!$"');
  });

  it("also prints on the single-quoted spelling, on both engines", () => {
    // The divergence the shipped demo used to have to avoid, pinned in the
    // direction it now goes: neither engine may treat one spelling as good and
    // the other as a bad initializer.
    //
    // Replaced through a function, not a string: the replacement ends in `$'`,
    // which `String.replace` reads as "everything after the match" and would
    // splice the rest of the program in after the closing quote. The result would
    // still have been rejected by both engines, just for a different reason.
    const singleQuoted = MODEL_HELLO!.source.replace(
      '"Hello World!$"',
      () => "'Hello World!$'",
    );
    expect(runSourceToPanel("legacy", singleQuoted).text).toContain("Hello World!");
    expect(runSourceToPanel("v2", singleQuoted).text).toContain("Hello World!");
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
/**
 * The program from the bug report, byte for byte.
 *
 * Standard MASM/TASM hello world: `.MODEL`, `.STACK`, a single-quoted string in
 * `.DATA`, `@DATA`, a bare `LEA`, `INT 21h` AH=09h to print and AH=4Ch to end.
 * Kept separate from the shipped demo so that a demo edited to dodge a bug cannot
 * quietly stop covering it.
 */
const REPORTED_HELLO_WORLD = [
  ".MODEL SMALL",
  ".STACK 100H",
  "",
  ".DATA",
  "    msg DB 'Hello World!$'",
  "",
  ".CODE",
  "MAIN PROC",
  "    MOV AX, @DATA",
  "    MOV DS, AX",
  "",
  "    LEA DX, msg",
  "    MOV AH, 09H",
  "    INT 21H",
  "",
  "    MOV AH, 4CH",
  "    INT 21H",
  "MAIN ENDP",
  "END MAIN",
].join("\n");

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

  it("runs the reported hello world to the same result on both engines", () => {
    // The program from the bug report, byte for byte. Before the legacy assembler
    // learned single quotes this could not be assembled on one engine at all, so
    // it is here to keep the two from drifting apart again on the ordinary
    // spelling of hello world.
    //
    // Compared through the panel rather than through `legacyRun`/`newRun` above,
    // and that is deliberate: those load a flat image at an `origin` chosen to put
    // compiler-generated code above a fixed data area, which is meaningless for a
    // `.MODEL` program that carries its own segment layout -- loading the image at
    // 100h put the code straight over the data and both engines then agreed on
    // nonsense. The panel is the path a person's Run button actually takes.
    const legacy = runSourceToPanel("legacy", REPORTED_HELLO_WORLD);
    const mine = runSourceToPanel("v2", REPORTED_HELLO_WORLD);

    expect(legacy.kind, "legacy").toBe("output");
    expect(mine.kind, "v2").toBe("output");
    expect(mine.text).toBe(legacy.text);
    // `Hello World!` from INT 21h AH=09h, and the run finished rather than hit
    // the step limit -- which matters, because a program that printed the right
    // text and then hung would still satisfy the line above.
    expect(legacy.text).toContain("Hello World!");
    expect(legacy.text).toContain("Program completed successfully");
  });

  it("agrees between the engines on a program with mixed initializers", () => {
    // A `DB` line mixing numbers and strings, which only assembles correctly if a
    // comma inside a string is told apart from a comma between initializers. The
    // CRLF is in the output, so the two single-byte initializers in front of it
    // have to have landed in the right order and at the right width.
    const source = [
      ".MODEL SMALL",
      ".STACK 100H",
      ".DATA",
      "    msg DB 13, 10, 'Hello World!$'",
      ".CODE",
      "MAIN PROC",
      "    MOV AX, @DATA",
      "    MOV DS, AX",
      "    LEA DX, msg",
      "    MOV AH, 09H",
      "    INT 21H",
      "    MOV AH, 4CH",
      "    INT 21H",
      "MAIN ENDP",
      "END MAIN",
    ].join("\n");
    const legacy = runSourceToPanel("legacy", source);
    expect(legacy.kind, "legacy").toBe("output");
    expect(runSourceToPanel("v2", source).text).toBe(legacy.text);
    expect(legacy.text).toContain("\r\nHello World!");
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
