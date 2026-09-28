/**
 * engine/assembler/layout.ts — segment buffers and the final memory layout.
 *
 * A buffer is a sparse view over segment offsets 0..64K. `origin` is the
 * offset that offset 0 of the stored array represents, which is what makes
 * `ORG` work without padding the whole segment from zero.
 */

export type SegmentClass = "CODE" | "DATA" | "STACK" | "UNKNOWN";

export class SegmentBuffer {
  /** Contiguous storage; index `i` holds segment offset `origin + i`. */
  bytes = new Uint8Array(0);
  /** Segment offset represented by `bytes[0]`. */
  origin = 0;
  /** Highest segment offset written so far, exclusive. */
  private high = 0;
  /** Offsets that were written in the first pass, for the second pass. */
  private readonly written = new Set<number>();

  constructor(
    readonly name: string,
    public cls: SegmentClass = "UNKNOWN",
    /**
     * Segment offset that `bytes[0]` represents. A .COM program that loads at
     * 0x100 has origin 0x100, so `image()` returns just the bytes that were
     * emitted rather than 256 bytes of padding, and `reset()` puts the second
     * pass back at the right place.
     */
    origin = 0,
  ) {
    this.origin = origin;
    this.high = origin;
  }

  /** The location counter. */
  get counter(): number {
    return this.origin + this.bytes.length;
  }

  get end(): number {
    return this.origin + this.bytes.length;
  }

  /** Grow the buffer so that `offset` is addressable. */
  private growTo(offset: number): void {
    if (offset < this.origin) throw new RangeError("cannot write below the segment origin");
    if (offset > 0x10000) throw new RangeError("segment overflow");
    const needed = offset - this.origin;
    if (needed <= this.bytes.length) return;
    const grown = new Uint8Array(needed);
    grown.set(this.bytes);
    this.bytes = grown;
  }

  /** Emit one byte at the location counter. */
  putByte(value: number): number {
    const offset = this.end;
    this.growTo(offset + 1);
    this.bytes[offset - this.origin] = value & 0xff;
    this.high = Math.max(this.high, offset + 1);
    this.written.add(offset);
    return offset;
  }

  /** Reserve `size` bytes without writing them. */
  reserve(size: number): void {
    for (let i = 0; i < size; i++) this.putByte(0);
  }

  /** Write `values` at an explicit offset, used for back-patching. */
  patch(offset: number, values: ArrayLike<number>): void {
    this.growTo(offset + values.length);
    for (let i = 0; i < values.length; i++) {
      this.bytes[offset - this.origin + i] = values[i] & 0xff;
      this.high = Math.max(this.high, offset + i + 1);
      this.written.add(offset + i);
    }
  }

  readByte(offset: number): number {
    const index = offset - this.origin;
    if (index < 0 || index >= this.bytes.length) return 0;
    return this.bytes[index];
  }

  readWord(offset: number): number {
    return this.readByte(offset) | (this.readByte(offset + 1) << 8);
  }

  /** Change the location counter; used by `ORG`. */
  seek(offset: number): void {
    if (offset < this.origin) throw new RangeError("ORG cannot move the counter backwards");
    if (offset > 0x10000) throw new RangeError("ORG exceeds the segment size");
    this.growTo(offset);
    this.high = Math.max(this.high, offset);
  }

  /** Bytes actually emitted, from `origin` to the high-water mark. */
  get usedSize(): number {
    return Math.max(this.high - this.origin, 0);
  }

  /** Final image, trimmed to the region actually used. */
  image(): Uint8Array {
    const length = Math.max(this.high - this.origin, 1);
    return this.bytes.subarray(0, length).slice();
  }

  /** Discard everything, for the second pass. */
  reset(): void {
    this.bytes = new Uint8Array(0);
    this.high = this.origin;
    this.written.clear();
  }
}

export interface SegmentImage {
  name: string;
  cls: SegmentClass;
  /** Paragraph-aligned load address. */
  base: number;
  /** Offset within the segment where execution begins. */
  entryOffset: number;
  bytes: Uint8Array;
  /** Segment offset that `bytes[0]` represents. */
  origin: number;
}

export interface EntryPoint {
  codeSegment: string;
  codeBase: number;
  ip: number;
  dataSegment: string;
  dataBase: number;
  stackSegment: string;
  stackBase: number;
  sp: number;
  extraSegment: string;
  extraBase: number;
}

export interface ResolvedLayout {
  segments: SegmentImage[];
  entry: EntryPoint;
  /** Non-overlapping "is this offset live in the image" ranges, by segment. */
  ranges: Map<string, Array<[number, number]>>;
}

export interface LayoutRequest {
  /** Set when the source used `.MODEL`. */
  hasModel: boolean;
  /** `SP` initial value from `.STACK`, when declared. */
  stackSize?: number;
  /** Names present in the source, in the order first seen. */
  names: string[];
}
