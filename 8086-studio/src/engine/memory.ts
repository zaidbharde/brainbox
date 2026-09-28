/**
 * engine/memory.ts — 1 MB physical memory with segment:offset addressing.
 *
 * Pure TypeScript, no UI imports. This is the only place that knows how a
 * 20-bit physical address is derived from a 16-bit segment and a 16-bit
 * offset, so the CPU, the debugger and the disassembler can never disagree.
 *
 * 8086 rules implemented here:
 *   physical = (segment * 16 + offset) & 0xFFFFF   (20-bit wrap)
 *   16-bit words are little-endian
 *   SP grows *downward*: the word at SP is read, the word at SP-2 is written
 *   SS:SP is the only stack pair; (SS << 4) + SP may cross the 0xFFFF boundary
 *   only via SP underflow, which wraps like any other 16-bit addition
 */

/** Size of the 8086 address space: 2^20 = 1 MB. */
export const MEMORY_SIZE = 0x100000;

/** Highest physical address in the 8086's 20-bit address bus. */
export const MAX_PHYSICAL = MEMORY_SIZE - 1;

/**
 * Wrap a 16-bit offset. Segment arithmetic and offsets stay 16-bit even when
 * a real 8086 would carry into the upper address bits (e.g. `SS:FFFF + 2`).
 */
export function wrap16(value: number): number {
  return value & 0xffff;
}
/**
 * Compute the 20-bit physical address for a segment:offset pair.
 *
 * Both inputs are wrapped to 16 bits first, because on a real 8086 they come
 * from 16-bit registers. This makes `SS:FFFF + 2` (a word push that underflows
 * the stack pointer) wrap the offset to `0001` rather than escape the
 * segment, which is what the hardware does.
 */
export function physicalAddress(segment: number, offset: number): number {
  return ((wrap16(segment) << 4) + wrap16(offset)) & MAX_PHYSICAL;
}

/**
 * A memory-mapped I/O handler. `read` returns the byte presented on the data
 * bus; returning `undefined` means "not handled, fall through to RAM".
 */
export interface MmioRegion {
  readonly start: number;
  readonly end: number;
  read?(physical: number): number | undefined;
  write?(physical: number, value: number): void;
}

/**
 * Optional write/read observer used by the debugger to build a dirty-page log
 * without rescanning the whole address space every step.
 */
export type MemoryWatcher = (physical: number, value: number) => void;

export class Memory {
  /** Flat physical memory. Exactly 1 MB. */
  readonly bytes: Uint8Array;

  private readonly mmio: MmioRegion[] = [];
  private watchers: MemoryWatcher[] = [];

  /** Total bytes written through the CPU-visible write path. */
  writeCount = 0;

  constructor(size: number = MEMORY_SIZE) {
    if (size <= 0 || size > MEMORY_SIZE) {
      throw new Error(`Memory size must be 1..${MEMORY_SIZE}, got ${size}`);
    }
    this.bytes = new Uint8Array(size);
  }

  // ---------------------------------------------------------------- MMIO ---

  /**
   * Register a memory-mapped I/O region. Regions are consulted in registration
   * order; the first region whose [start, end] range contains the physical
   * address and which actually implements the hook wins.
   */
  mapRegion(region: MmioRegion): void {
    this.mmio.push(region);
  }

  /** Remove every registered MMIO region (used when the CPU is reset). */
  clearRegions(): void {
    this.mmio.length = 0;
  }

  /**
   * Observe writes. Used by the debugger to produce a dirty-page set; the
   * 1 MB address space makes a full diff per step too slow.
   */
  addWatcher(watcher: MemoryWatcher): void {
    this.watchers.push(watcher);
  }

  clearWatchers(): void {
    this.watchers.length = 0;
  }

  private regionFor(physical: number): MmioRegion | undefined {
    for (const region of this.mmio) {
      if (physical >= region.start && physical <= region.end) return region;
    }
    return undefined;
  }

  // ------------------------------------------------------------ raw RAM ---

  /** Unconditional raw byte read with no MMIO consultation (loader/IVR use). */
  getRaw(physical: number): number {
    return this.bytes[physical & MAX_PHYSICAL];
  }

  /** Unconditional raw byte write with no MMIO consultation. */
  setRaw(physical: number, value: number): void {
    this.bytes[physical & MAX_PHYSICAL] = value & 0xff;
  }

  // ------------------------------------------------------ CPU byte access ---

  /** Read one byte at a physical address, honouring MMIO. */
  readByte(physical: number): number {
    const addr = physical & MAX_PHYSICAL;
    const region = this.regionFor(addr);
    if (region?.read) {
      const value = region.read(addr);
      if (value !== undefined) return value & 0xff;
    }
    return this.bytes[addr];
  }

  /** Write one byte at a physical address, honouring MMIO. */
  writeByte(physical: number, value: number): void {
    const addr = physical & MAX_PHYSICAL;
    const region = this.regionFor(addr);
    if (region?.write) {
      region.write(addr, value & 0xff);
      this.notify(addr, value & 0xff);
      return;
    }
    this.bytes[addr] = value & 0xff;
    this.notify(addr, value & 0xff);
  }

  private notify(physical: number, value: number): void {
    for (const watcher of this.watchers) watcher(physical, value);
  }

  // -------------------------------------------------- segment:offset I/O ---

  /**
   * Read/write a byte through segment:offset. Callers must already have
   * applied the correct default segment rule (DS, or SS for BP-based operands).
   */
  read8(segment: number, offset: number): number {
    return this.readByte(physicalAddress(segment, offset));
  }

  write8(segment: number, offset: number, value: number): void {
    this.writeByte(physicalAddress(segment, offset), value);
    this.writeCount++;
  }

  /** Read a little-endian 16-bit word. */
  read16(segment: number, offset: number): number {
    const low = this.read8(segment, offset);
    const high = this.read8(segment, offset + 1);
    return low | (high << 8);
  }

  /** Write a little-endian 16-bit word. */
  write16(segment: number, offset: number, value: number): void {
    this.write8(segment, offset, value & 0xff);
    this.write8(segment, offset + 1, (value >> 8) & 0xff);
  }

  // ------------------------------------------------------------- helpers ---

  /**
   * Read `length` bytes starting at a physical address into a new array.
   * Used by the debugger for dumps; wraps at the top of the address space.
   */
  readBlock(physical: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = this.readByte((physical + i) & MAX_PHYSICAL);
    }
    return out;
  }

  writeBlock(physical: number, data: Uint8Array | number[]): void {
    for (let i = 0; i < data.length; i++) {
      this.writeByte((physical + i) & MAX_PHYSICAL, data[i]);
    }
  }

  /** Hex dump helper for the debugger/console. */
  hexDump(segment: number, offset: number, length: number): string {
    const rows: string[] = [];
    for (let i = 0; i < length; i += 16) {
      const addr = wrap16(offset + i);
      const phys = physicalAddress(segment, addr);
      const bytes: string[] = [];
      for (let j = 0; j < 16 && i + j < length; j++) {
        const b = this.readByte((phys + j) & MAX_PHYSICAL);
        bytes.push(b.toString(16).padStart(2, "0").toUpperCase());
      }
      const ascii = Array.from(bytes)
        .map((b) => {
          const v = parseInt(b, 16);
          return v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : ".";
        })
        .join("");
      rows.push(
        `${addr.toString(16).padStart(4, "0").toUpperCase()}  ${bytes
          .map((b) => b.toLowerCase())
          .join(" ")}  |${ascii}|`,
      );
    }
    return rows.join("\n");
  }

  /** Copy the entire address space (used for snapshots). */
  snapshot(): Uint8Array {
    return this.bytes.slice();
  }

  restore(data: Uint8Array): void {
    this.bytes.set(data.subarray(0, this.bytes.length));
  }
}
