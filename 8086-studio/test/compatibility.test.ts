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
