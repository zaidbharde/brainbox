export interface ByteRange {
  start: number;
  end: number;
}

export function parseByteRange(header: string, size: number): ByteRange | null {
  if (!Number.isInteger(size) || size < 0) throw new RangeError("invalid size");
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (!startText && !endText) return null;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: Math.max(0, size - 1) };
  }
  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) return null;
  if (start < 0 || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, Math.max(0, size - 1)) };
}

export function rangeLength(range: ByteRange): number {
  return range.end >= range.start ? range.end - range.start + 1 : 0;
}
