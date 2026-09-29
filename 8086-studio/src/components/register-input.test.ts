import { describe, it, expect } from 'vitest';
import { parseRegisterInput } from '@/components/RegisterDisplay';

describe('parseRegisterInput', () => {
  it('reads the four hex digits it displays', () => {
    expect(parseRegisterInput('00FF')).toBe(0x00ff);
    expect(parseRegisterInput('FFFF')).toBe(0xffff);
    expect(parseRegisterInput('BEEF')).toBe(0xbeef);
  });

  it('reads an h suffix, which is how the lab spells hex in source', () => {
    expect(parseRegisterInput('BEEFh')).toBe(0xbeef);
    expect(parseRegisterInput('0h')).toBe(0);
  });

  it('reads a 0x prefix', () => {
    expect(parseRegisterInput('0xbeef')).toBe(0xbeef);
    expect(parseRegisterInput('0XBEEF')).toBe(0xbeef);
  });

  it('reads bare digits as hex, so a value typed back in is the value shown', () => {
    // The rule the field depends on. It displays `00FF`; if `FF` came back as
    // two hundred and fifty-five, then opening a register and pressing Enter
    // without touching it would change it.
    expect(parseRegisterInput('FF')).toBe(0xff);
    expect(parseRegisterInput('10')).toBe(0x10);
    expect(parseRegisterInput('1234')).toBe(0x1234);
    expect(parseRegisterInput('10h')).toBe(0x10);
  });

  it('refuses what is not a number rather than guessing', () => {
    // `1e4` and `12.5` are hex here, not notation: the lab shows hex and has no
    // floats, so `1e4` is four hundred and eighty-four rather than a guess.
    for (const raw of ['', '   ', 'GHIJ', '0x', 'h', '-1', '12.5', 'BEEFh2', '0xZZ', '0b1010']) {
      expect(parseRegisterInput(raw), `"${raw}"`).toBeNull();
    }
  });

  it('refuses a value too big for the register rather than truncating it', () => {
    // More than four hex digits cannot be a 16-bit register. Writing the low
    // 16 bits of a typo would be a register the person never asked for.
    expect(parseRegisterInput('12345')).toBeNull();
    expect(parseRegisterInput('12345h')).toBeNull();
    expect(parseRegisterInput('0x12345')).toBeNull();
  });
});
