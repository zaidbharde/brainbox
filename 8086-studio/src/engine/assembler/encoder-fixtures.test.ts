/**
 * The 203 encodings in `test/fixtures/encoder-bytes.json` were produced by GNU
 * as, not by this assembler, so they are an independent check on the shared ISA
 * table. See `test/fixtures/generate-encoder-fixtures.mjs` for how they are
 * regenerated.
 *
 * Two adjustments are made to the fixture source before assembling:
 *
 *  - Branch targets are written in gas syntax (`jmp .+2`, `jmp .+200`). gas
 *    spells the *assembler* input, not Intel syntax, so `SHORT`/`NEAR` are
 *    dropped and `.L` becomes the absolute offset gas was aiming at. The
 *    expected bytes still come from gas unchanged.
 *
 * `PUSH ES` and `POP DS` used to be excluded, on the claim that opcodes 0x06 and
 * 0x1F were x86-64/386 additions. They are original 8086 instructions -- the
 * segment PUSH/POP forms -- and gas's own bytes for them are exactly those
 * single-byte opcodes, so they are now assembled and compared like any other
 * fixture. Excluding them was the bug, not the fixture.
 */

import { describe, expect, it } from "vitest";
import fixtures from "../../../test/fixtures/encoder-bytes.json";
import { assemble } from "./assemble";

type FixtureMap = Record<string, number[]>;

const entries = Object.entries(fixtures as FixtureMap);

/**
 * `JMP NEAR .L+200` -> `JMP 200`, `JO SHORT .L` -> `JO 2`.
 *
 * The fixture generator emits `.<n>` meaning "n bytes past the start of this
 * instruction", and the segment origin is 0, so n is the absolute target.
 */
function toIntelSyntax(source: string): string {
  return source
    .replace(/\bSHORT\s+/i, "")
    .replace(/\bNEAR\s+/i, "")
    // A bare `.L` is the generator's shorthand for `.+2`.
    .replace(/\.L\+(\d+)/, "$1")
    .replace(/\.L\b/, "2");
}

const assemblable = entries;

/**
 * The four near `Jcc` forms that modern gas does not encode the 8086 way.
 *
 * On an 8086 a conditional jump has no two-byte escape: `0x70+cc rel8` and
 * `0x80+cc rel16`, and the `0x80-0x8F` range is shared with the arithmetic
 * group, so the decoder tells them apart by the ModR/M reg field. That makes
 * `jo .+200` three bytes: `80 C5 00`.
 *
 * gas targets the 386 and later, where `0F 80+cc rel16` is the ordinary near
 * conditional jump, so it emits four bytes instead. Encoding the 386 form in an
 * 8086 engine would make the output unrunnable, so these four cases assert the
 * 8086 bytes instead — and a test below proves they really do differ.
 */
const JCC_NEAR_8086: Readonly<Record<string, number[]>> = {
  "JO NEAR .L+200": [0x80, 0xc5, 0x00],
  "JNB NEAR .L+200": [0x83, 0xc5, 0x00],
  "JZ NEAR .L+200": [0x84, 0xc5, 0x00],
  "JGE NEAR .L+200": [0x8d, 0xc5, 0x00],
};

describe("encoder against GNU as fixtures", () => {
  it("covers the whole fixture set", () => {
    expect(assemblable.length).toBeGreaterThanOrEqual(200);
  });

  it("covers the 8086 segment PUSH/POP forms, which are 8086 after all", () => {
    // Kept as an explicit test rather than a silent removal: these two were
    // excluded on a false claim, and the claim is the kind of thing that comes
    // back if nothing says otherwise.
    expect(assemble("PUSH ES", { origin: 0 }).image[0]).toBe(0x06);
    expect(assemble("POP DS", { origin: 0 }).image[0]).toBe(0x1f);
    expect((fixtures as FixtureMap)["PUSH ES"]).toEqual([0x06]);
    expect((fixtures as FixtureMap)["POP DS"]).toEqual([0x1f]);
  });

  it("encodes near Jcc the 8086 way, not the 386 way", () => {
    for (const [source, expected] of Object.entries(JCC_NEAR_8086)) {
      const fromGas = (fixtures as FixtureMap)[source];
      // The override has to be load-bearing: if gas agreed, the override would
      // be hiding nothing and should be deleted.
      expect(fromGas).not.toEqual(expected);
      expect(fromGas[0]).toBe(0x0f);

      const result = assemble(toIntelSyntax(source), { origin: 0 });
      expect(result.errors).toEqual([]);
      expect(Array.from(result.image.subarray(0, expected.length))).toEqual(expected);
    }
  });

  it.each(assemblable.filter(([source]) => !(source in JCC_NEAR_8086)))(
    "%s",
    (source, expected) => {
      const result = assemble(toIntelSyntax(source), { origin: 0 });
      expect(result.errors.map((e) => `${e.line}:${e.column} ${e.message}`)).toEqual([]);
      // Each fixture is a single instruction assembled at the segment origin,
      // so the expected bytes start at offset 0 of the image.
      expect(Array.from(result.image.subarray(0, expected.length))).toEqual(expected);
    },
  );
});
