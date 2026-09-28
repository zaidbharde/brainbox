import { describe, expect, it } from "vitest";
import {
  MAX_PHYSICAL,
  MEMORY_SIZE,
  Memory,
  physicalAddress,
  wrap16,
} from "./memory";

describe("physicalAddress", () => {
  it("computes seg*16 + off", () => {
    expect(physicalAddress(0x1000, 0x0000)).toBe(0x10000);
    expect(physicalAddress(0x0000, 0x0100)).toBe(0x0100);
    expect(physicalAddress(0x07c0, 0x0100)).toBe(0x07d00);
  });

  it("wraps at 20 bits", () => {
    // The classic 8086 wrap: 0xFFFF:0x0010 + 0x100 exceeds 1 MB and wraps.
    expect(physicalAddress(0xffff, 0x0010)).toBe(0x00000);
    expect(physicalAddress(0xffff, 0x0020)).toBe(0x00010);
    // 0xF000:0xFFFF is exactly the top of the address space: no wrap yet.
    expect(physicalAddress(0xf000, 0xffff)).toBe(0xfffff);
    // Highest in-range address.
    expect(physicalAddress(0xffff, 0x000f)).toBe(MAX_PHYSICAL);
  });

  it("wraps segment and offset to 16 bits first", () => {
    // A word access at SS:FFFF underflows the 16-bit offset register and
    // wraps to SS:0001 — the hardware does not leave the segment.
    expect(physicalAddress(0x1000, 0x1_0000)).toBe(physicalAddress(0x1000, 0));
    expect(physicalAddress(0x1_0000, 0)).toBe(physicalAddress(0x0000, 0));
  });
});

describe("wrap16", () => {
  it("keeps offsets 16-bit", () => {
    expect(wrap16(0x10000)).toBe(0);
    expect(wrap16(-1)).toBe(0xffff);
    expect(wrap16(0x1ffff)).toBe(0xffff);
  });
});

describe("Memory", () => {
  it("allocates 1 MB by default", () => {
    const mem = new Memory();
    expect(mem.bytes.length).toBe(MEMORY_SIZE);
    expect(MEMORY_SIZE).toBe(0x100000);
  });

  it("rejects out-of-range sizes", () => {
    expect(() => new Memory(0)).toThrow();
    expect(() => new Memory(MEMORY_SIZE + 1)).toThrow();
  });

  it("stores little-endian words", () => {
    const mem = new Memory();
    mem.write16(0x1000, 0x0010, 0x1234);
    expect(mem.getRaw(0x10000 + 0x10)).toBe(0x34);
    expect(mem.getRaw(0x10000 + 0x11)).toBe(0x12);
    expect(mem.read16(0x1000, 0x0010)).toBe(0x1234);
  });

  it("reads back the high byte first", () => {
    const mem = new Memory();
    mem.write8(0, 0x2000, 0xaa);
    mem.write8(0, 0x2001, 0xbb);
    expect(mem.read16(0, 0x2000)).toBe(0xbbaa);
  });

  it("respects the 20-bit wrap on read and write", () => {
    const mem = new Memory();
    // 0xFFFF:0x0010 == physical 0x00000 after wrap
    mem.write8(0xffff, 0x0010, 0x5a);
    expect(mem.getRaw(0x00000)).toBe(0x5a);
    expect(mem.read8(0xffff, 0x0010)).toBe(0x5a);
  });

  it("wraps offsets but not physical addresses", () => {
    const mem = new Memory();
    // offset 0x1_0000 wraps to 0 inside segment 0x1000
    mem.write8(0x1000, 0x10000, 0x77);
    expect(mem.getRaw(0x10000)).toBe(0x77);
  });

  describe("MMIO", () => {
    it("routes reads and writes to a registered region", () => {
      const mem = new Memory();
      const seen: Array<[number, number]> = [];
      mem.mapRegion({
        start: 0xfff0,
        end: 0xffff,
        read: () => 0x42,
        write: (address, v) => seen.push([address, v]),
      });

      expect(mem.readByte(0xfff5)).toBe(0x42);
      mem.writeByte(0xfff5, 0x99);
      expect(seen).toEqual([[0xfff5, 0x99]]);
      // RAM untouched
      expect(mem.getRaw(0xfff5)).toBe(0x00);
    });

    it("falls through to RAM when the hook declines (returns undefined)", () => {
      const mem = new Memory();
      mem.setRaw(0xfff5, 0x33);
      mem.mapRegion({ start: 0xfff0, end: 0xffff, read: () => undefined });
      expect(mem.readByte(0xfff5)).toBe(0x33);
    });

    it("prefers the first matching region", () => {
      const mem = new Memory();
      mem.mapRegion({ start: 0, end: 0xffff, read: () => 0x11 });
      mem.mapRegion({ start: 0, end: 0xffff, read: () => 0x22 });
      expect(mem.readByte(0)).toBe(0x11);
    });

    it("clears regions", () => {
      const mem = new Memory();
      mem.mapRegion({ start: 0, end: 0xffff, read: () => 0x11 });
      mem.clearRegions();
      expect(mem.readByte(0)).toBe(0x00);
    });
  });

  describe("watchers", () => {
    it("notifies on every write", () => {
      const mem = new Memory();
      const log: Array<[number, number]> = [];
      mem.addWatcher((p, v) => log.push([p, v]));
      mem.write8(0x1000, 0x20, 0xab);
      mem.write8(0x1000, 0x20, 0xcd);
      expect(log).toEqual([
        [0x10020, 0xab],
        [0x10020, 0xcd],
      ]);
    });

    it("clears watchers", () => {
      const mem = new Memory();
      let n = 0;
      mem.addWatcher(() => n++);
      mem.clearWatchers();
      mem.write8(0, 0, 1);
      expect(n).toBe(0);
    });
  });

  it("counts writes", () => {
    const mem = new Memory();
    mem.write8(0, 0x10, 1);
    mem.write16(0, 0x20, 0x1234); // two bytes
    expect(mem.writeCount).toBe(3);
  });

  it("reads/writes blocks", () => {
    const mem = new Memory();
    mem.writeBlock(0x200, [1, 2, 3, 4]);
    expect(Array.from(mem.readBlock(0x200, 4))).toEqual([1, 2, 3, 4]);
  });

  it("blocks wrap at the top of memory", () => {
    const mem = new Memory();
    mem.setRaw(MAX_PHYSICAL, 0xab);
    expect(Array.from(mem.readBlock(MAX_PHYSICAL, 2))).toEqual([0xab, 0x00]);
  });

  it("snapshot and restore", () => {
    const mem = new Memory();
    mem.write8(0, 0x40, 0x5a);
    const snap = mem.snapshot();
    mem.write8(0, 0x40, 0x11);
    mem.restore(snap);
    expect(mem.getRaw(0x40)).toBe(0x5a);
  });

  it("hexDump renders bytes and ascii", () => {
    const mem = new Memory();
    mem.writeBlock(0, [0x48, 0x69, 0x00]);
    const dump = mem.hexDump(0, 0, 4);
    expect(dump).toContain("0000");
    expect(dump).toContain("48 69 00 00");
    expect(dump).toContain("|Hi..|");
  });
});
