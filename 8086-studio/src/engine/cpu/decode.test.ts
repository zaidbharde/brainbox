/**
 * Round-trip test: every byte sequence the GNU-as fixture generator produced
 * must decode back to the instruction it was assembled from.
 *
 * This is the test that makes the shared table pay off. The encoder and the
 * decoder read the same `InsnDef` objects, so a table entry that describes an
 * encoding wrongly is wrong in both directions at once and the two agree with
 * each other while disagreeing with the hardware. Comparing against the
 * independent gas output is what catches that.
 */

import { describe, expect, it } from "vitest";
import { decode } from "./decode";
import { assemble } from "../assembler/assemble";
import fixtures from "../../../test/fixtures/encoder-bytes.json";

interface Fixture {
  [source: string]: number[];
}

const CASES: ReadonlyArray<[string, number[]]> = Object.entries(fixtures as Fixture);

/**
 * Fixtures that are not 8086 instructions. The generator is GNU as, which will
 * happily emit 386+ encodings for syntax an 8086 assembler would reject, so
 * these are decided exclusions rather than gaps:
 *
 *   - `0F 8x` is the 386 near-Jcc. An 8086 conditional jump is `7x`/`8x rel16`
 *     only, and this engine spends 0x0F as a private extension escape, so it
 *     cannot also mean "near Jcc" without ambiguity.
 *
 * `PUSH ES` (06) and `POP DS` (1F) used to be excluded here on the belief that
 * they were 386 additions. They are not: they are the 8086 segment `PUSH`/`POP`
 * forms, and gas's own bytes for them are the single-byte opcodes. They are now
 * covered by this test like any other fixture.
 */
const NOT_8086 = new Set<string>([
  "JO NEAR .L+200",
  "JNB NEAR .L+200",
  "JZ NEAR .L+200",
  "JGE NEAR .L+200",
  "LEAVE",
  "ENTER 8,0",
]);

describe("decode", () => {
  it("has fixtures to check", () => {
    expect(CASES.length).toBeGreaterThan(200);
  });

  it.each(CASES)("decodes %s", (source, bytes) => {
    const result = decode(new Uint8Array(bytes));
    if (NOT_8086.has(source)) {
      expect(result.ok, `${source} should be rejected as not-8086`).toBe(false);
      return;
    }
    expect(result.error, `${source} -> ${result.text}`).toBeUndefined();
    expect(result.ok, `${source} -> ${result.text} (${result.error})`).toBe(true);
    // Re-assembling the decoded text must produce the same bytes, which is the
    // strongest statement available: it means the decoder recovered the operand
    // *kinds* the encoder was given, not just the mnemonic.
    const reassembled = assemble(result.text, { origin: 0 });
    expect(reassembled.errors.map((e) => e.message)).toEqual([]);
    expect(Array.from(reassembled.image), `${source} -> ${result.text}`).toEqual(bytes);
  });

  it("reports the length of each instruction", () => {
    for (const [source, bytes] of CASES) {
      const result = decode(new Uint8Array(bytes));
      if (!result.ok) continue;
      expect(result.length, `${source} is ${bytes.length} bytes`).toBe(bytes.length);
    }
  });
});

describe("decode: opcode register forms", () => {
  it("tells INC BX from INC SI", () => {
    // Both are register forms of the same group; the opcode's low three bits
    // are the register, and getting this wrong would report the wrong one.
    expect(decode(new Uint8Array([0x43])).text).toBe("INC BX");
    expect(decode(new Uint8Array([0x46])).text).toBe("INC SI");
  });

  it("tells every INC form apart", () => {
    for (const [code, name] of [
      [0x40, "AX"], [0x41, "CX"], [0x42, "DX"], [0x43, "BX"],
      [0x44, "SP"], [0x45, "BP"], [0x46, "SI"], [0x47, "DI"],
    ] as const) {
      expect(decode(new Uint8Array([code])).text).toBe(`INC ${name}`);
    }
  });

  it("tells PUSH and POP forms apart", () => {
    expect(decode(new Uint8Array([0x50])).text).toBe("PUSH AX");
    expect(decode(new Uint8Array([0x5b])).text).toBe("POP BX");
  });

  it("tells XCHG AX forms apart", () => {
    // 0x90 is the documented 8086 NOP; `XCHG AX, AX` is the same encoding, and
    // the table spells it the way the manual documents it.
    expect(decode(new Uint8Array([0x90])).text).toBe("NOP");
    expect(decode(new Uint8Array([0x91])).text).toBe("XCHG AX, CX");
  });

  it("tells MOV reg,imm forms apart", () => {
    expect(decode(new Uint8Array([0xb8, 0x34, 0x12])).text).toBe("MOV AX, 0x1234");
    expect(decode(new Uint8Array([0xbb, 0x34, 0x12])).text).toBe("MOV BX, 0x1234");
  });
});

describe("decode: segment overrides", () => {
  it("keeps an explicit override", () => {
    expect(decode(new Uint8Array([0x26, 0x8b, 0x05])).text).toBe("MOV AX, WORD PTR ES:[DI]");
  });

  it("records the override separately from the text", () => {
    expect(decode(new Uint8Array([0x3e, 0x8b, 0x06, 0x10])).segmentOverride).toBe("DS");
  });

  it("takes the last of several overrides", () => {
    expect(decode(new Uint8Array([0x26, 0x2e, 0x8b, 0x05])).segmentOverride).toBe("CS");
  });

  it("supplies the default segment when there is no override", () => {
    // [BP] is SS and [BX] is DS. Both decode to a memory operand; the segment
    // is what the CPU needs and what the text shows.
    const bp = decode(new Uint8Array([0x8b, 0x46, 0x00]));
    expect(bp.operands[1]).toEqual({ kind: "mem", address: { base: "BP", segment: "SS" }, width: 16 });
    const bx = decode(new Uint8Array([0x8b, 0x07]));
    expect(bx.operands[1]).toEqual({ kind: "mem", address: { base: "BX", segment: "DS" }, width: 16 });
  });

  it("uses DS for [BP+SI], because an index makes it not a base-only address", () => {
    // rm=010 with mod=00 is [BP+SI]; rm=000 would be [BX+SI], which is DS for a
    // different reason.
    const decoded = decode(new Uint8Array([0x8b, 0x02]));
    expect(decoded.operands[1]).toEqual({ kind: "mem", address: { base: "BP", index: "SI", segment: "DS" }, width: 16 });
  });
});

describe("decode: repeat prefixes", () => {
  it("keeps the prefix, and counts it in the length", () => {
    // The dangerous failure here is not a wrong decode but a dropped prefix:
    // `F3 A5` would still be a valid MOVSW, and a CPU that ignored `repeat`
    // would move exactly one word and never know it was wrong.
    const result = decode(new Uint8Array([0xf3, 0xa5]));
    expect(result.ok).toBe(true);
    expect(result.repeat).toBe("repe");
    expect(result.mnem).toBe("MOVSW");
    expect(result.length).toBe(2);
  });

  it("distinguishes REP/REPE from REPNE/REPNZ", () => {
    expect(decode(new Uint8Array([0xf2, 0xae])).repeat).toBe("repne");
    expect(decode(new Uint8Array([0xf3, 0xae])).repeat).toBe("repe");
  });

  it("reports no prefix when there is none", () => {
    expect(decode(new Uint8Array([0xa5])).repeat).toBe("none");
  });

  it("reads a segment override and a repeat prefix together", () => {
    // Real code does this: `REP MOVSB` on an overridden segment.
    const result = decode(new Uint8Array([0x26, 0xf3, 0xa4]));
    expect(result.repeat).toBe("repe");
    expect(result.segmentOverride).toBe("ES");
    expect(result.length).toBe(3);
  });

  it("round-trips the prefixed text back to the prefixed bytes", () => {
    const decoded = decode(new Uint8Array([0xf3, 0xab]));
    expect(decoded.ok).toBe(true);
    expect(decoded.text).toBe("REPE STOSW");
    const back = assemble(decoded.text, { origin: 0 });
    expect(Array.from(back.image)).toEqual([0xf3, 0xab]);
  });

  it("still reports truncation when only the prefix is present", () => {
    expect(decode(new Uint8Array([0xf3])).ok).toBe(false);
  });
});

describe("decode: extensions", () => {
  it("decodes a BrainBox extension", () => {
    const result = decode(new Uint8Array([0x0f, 0x05, 0xc3]));
    expect(result.ok).toBe(true);
    expect(result.extension).toBe(5);
    expect(result.mnem).toBe("OUT");
    expect(result.operands[0]).toEqual({ kind: "reg16", name: "BX", code: 3 });
  });

  it("does not confuse 0x0F with a prefix", () => {
    // On a 386+ 0x0F escapes a two-byte opcode. On an 8086 it is nothing, and
    // the BrainBox engine uses it as a private escape.
    const result = decode(new Uint8Array([0x0f, 0xfe]));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no BrainBox extension");
  });
});

describe("decode: the 8086 boundary", () => {
  it("rejects the 386 near-Jcc, because 0x0F is an extension escape here", () => {
    // 0F 80 is `JO NEAR` on a 386. Reusing 0x0F for that would collide with the
    // BrainBox extension space, so the decoder must refuse it rather than
    // guess between the two meanings.
    const result = decode(new Uint8Array([0x0f, 0x80, 0x00, 0x00]));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no BrainBox extension");
  });

  it("decodes 0x06 and 0x1F as the 8086 segment forms, not 386 additions", () => {
    // These two used to be asserted *undecodable*, on the claim that the 8086
    // left them undefined. It did not: 0x06 is `PUSH ES` and 0x1F is `POP DS`,
    // and the encoder fixtures carry gas's own bytes for both. Asserting the
    // opposite here is what kept the engine from accepting ordinary 8086 code.
    const push = decode(new Uint8Array([0x06]));
    expect(push.ok).toBe(true);
    expect(push.text).toBe("PUSH ES");
    const pop = decode(new Uint8Array([0x1f]));
    expect(pop.ok).toBe(true);
    expect(pop.text).toBe("POP DS");
  });

  it("leaves 0x0F to the extension escape rather than reading it as POP CS", () => {
    // POP CS is encodable on real hardware, but 0x0F is this engine's BrainBox
    // extension space. The byte can only mean one thing.
    const result = decode(new Uint8Array([0x0f, 0x00]));
    expect(result.mnem).not.toBe("POP");
  });
});

describe("decode: failure is total, not fatal", () => {
  it("reports an unknown opcode without throwing", () => {
    const result = decode(new Uint8Array([0x0f]));
    expect(result.ok).toBe(false);
    expect(result.length).toBeGreaterThan(0);
  });

  it("reports truncation rather than reading past the end", () => {
    // 0xB8 is `MOV AX, imm16` and only one byte is present.
    const result = decode(new Uint8Array([0xb8, 0x01]));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("past the end");
  });

  it("never throws on arbitrary bytes", () => {
    for (let value = 0; value < 256; value++) {
      for (const extra of [0, 1, 2, 3]) {
        const bytes = new Uint8Array(extra).fill(0x90);
        bytes[0] = value;
        expect(() => decode(bytes)).not.toThrow();
      }
    }
  });

  it("decodes a whole page of 0x90 without running off the end", () => {
    // A disassembler pointed at padding must be able to walk it.
    let offset = 0;
    const page = new Uint8Array(256).fill(0x90);
    let count = 0;
    while (offset < page.length) {
      const result = decode(page.subarray(offset));
      expect(result.length).toBeGreaterThan(0);
      offset += result.length;
      count++;
      if (count > 256) break;
    }
    expect(offset).toBe(page.length);
  });
});
