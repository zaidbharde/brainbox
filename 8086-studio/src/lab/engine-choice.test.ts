/**
 * How the engine is chosen, and what happens when the browser will not cooperate.
 *
 * The rules are three lines of code and a list of ways to get them wrong, so the
 * list is what this is for: each of the failure modes below is something that
 * happens in a real browser rather than something invented for the test.
 */

import { describe, expect, it } from 'vitest';
import {
  ENGINE_STORAGE_KEY,
  engineUrl,
  readStoredEngine,
  resolveEngine,
  writeStoredEngine,
} from '@/lab/engine-choice';

/** A `localStorage` that holds what it is told, and nothing surprising. */
function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    get size() {
      return map.size;
    },
  };
}

/** Storage that throws on every operation, the way a blocked browser does. */
function hostileStorage() {
  const boom = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

describe('the engine is resolved from the URL, then the saved choice, then the default', () => {
  it('uses the URL when it names an engine', () => {
    expect(resolveEngine('?engine=v2', memoryStorage())).toBe('v2');
    expect(resolveEngine('?engine=legacy', memoryStorage())).toBe('legacy');
  });

  it('uses the saved choice when the URL says nothing', () => {
    const storage = memoryStorage({ [ENGINE_STORAGE_KEY]: 'v2' });
    expect(resolveEngine('', storage)).toBe('v2');
    expect(resolveEngine('?other=1', storage)).toBe('v2');
  });

  it('lets the URL win over the saved choice', () => {
    // A link is a statement of intent, so it outranks a remembered preference. The
    // reverse pairing is the one that matters in practice: someone who picked v2
    // once and then follows a link to the default must get the default.
    const savedV2 = memoryStorage({ [ENGINE_STORAGE_KEY]: 'v2' });
    expect(resolveEngine('?engine=legacy', savedV2)).toBe('legacy');

    const savedLegacy = memoryStorage({ [ENGINE_STORAGE_KEY]: 'legacy' });
    expect(resolveEngine('?engine=v2', savedLegacy)).toBe('v2');
  });

  it('falls back to the legacy engine when nothing says otherwise', () => {
    expect(resolveEngine('', memoryStorage())).toBe('legacy');
    expect(resolveEngine('', null)).toBe('legacy');
    expect(resolveEngine('')).toBe('legacy');
  });

  it('falls back to the legacy engine for a value it does not recognise', () => {
    // Not to the saved choice, and not to a guess. `?engine=v3` from a link to a
    // build that does not exist should behave exactly as it did before this
    // existed, which is to say run the legacy engine.
    expect(resolveEngine('?engine=v3', memoryStorage())).toBe('legacy');
    expect(resolveEngine('?engine=V2', memoryStorage({ [ENGINE_STORAGE_KEY]: 'v2' }))).toBe('legacy');
    expect(resolveEngine('?engine=', memoryStorage())).toBe('legacy');
  });

  it('ignores a saved value it does not recognise', () => {
    // The stored string is not trustworthy either: it can be left behind by an older
    // build, or typed into devtools. Neither should be able to put the lab on an
    // engine that does not exist.
    expect(resolveEngine('', memoryStorage({ [ENGINE_STORAGE_KEY]: 'v3' }))).toBe('legacy');
    expect(resolveEngine('', memoryStorage({ [ENGINE_STORAGE_KEY]: '' }))).toBe('legacy');
  });
});

describe('a browser that will not let the lab remember anything', () => {
  it('runs on the default rather than crashing', () => {
    // Site data blocked, private window, or a full quota. All of them throw on
    // `getItem` rather than returning null, and the lab has to open anyway.
    expect(resolveEngine('', hostileStorage())).toBe('legacy');
    expect(resolveEngine('?engine=v2', hostileStorage())).toBe('v2');
  });

  it('reports no saved choice instead of throwing', () => {
    expect(readStoredEngine(hostileStorage())).toBeNull();
    expect(readStoredEngine(null)).toBeNull();
  });

  it('does not let a failed save interrupt the choice being made', () => {
    // The URL is updated as well, so the choice holds for the session even when it
    // cannot be remembered. Nothing here should throw.
    expect(() => writeStoredEngine('v2', hostileStorage())).not.toThrow();
    expect(() => writeStoredEngine('v2', null)).not.toThrow();
  });
});

describe('choosing an engine is remembered', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    writeStoredEngine('v2', storage);
    expect(resolveEngine('', storage)).toBe('v2');
    writeStoredEngine('legacy', storage);
    expect(resolveEngine('', storage)).toBe('legacy');
  });

  it('keeps the rest of the URL when the engine changes', () => {
    // The studio is opened with other parameters in some setups, and dropping one
    // because the engine changed would be a surprise.
    expect(engineUrl('?engine=v2&foo=bar', 'legacy')).toBe('?foo=bar');
    expect(engineUrl('?foo=bar', 'v2')).toBe('?foo=bar&engine=v2');
  });

  it('leaves the URL bare when the default is chosen and there is nothing else in it', () => {
    expect(engineUrl('?engine=v2', 'legacy')).toBe('');
    expect(engineUrl('', 'legacy')).toBe('');
    expect(engineUrl('', 'v2')).toBe('?engine=v2');
  });
});
