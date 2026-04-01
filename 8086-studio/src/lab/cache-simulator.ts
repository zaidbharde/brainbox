import { CacheConfig, CacheStats, TraceEntry } from '@/lab/types';

interface CacheLine {
  tag: number;
  valid: boolean;
  lastUsed: number;
}

interface AccessEvent {
  address: number;
  kind: 'read' | 'write';
}

function collectAccesses(trace: TraceEntry[]): AccessEvent[] {
  const accesses: AccessEvent[] = [];
  for (const entry of trace) {
    for (const address of entry.memoryReads) {
      accesses.push({ address, kind: 'read' });
    }
    for (const address of entry.memoryWrites) {
      accesses.push({ address, kind: 'write' });
    }
  }
  return accesses;
}

function createSets(config: CacheConfig): CacheLine[][] {
  const associativity = config.policy === 'set_associative_2way' ? 2 : 1;
  const setCount = Math.max(1, Math.floor(config.lineCount / associativity));
  return Array.from({ length: setCount }, () =>
    Array.from({ length: associativity }, () => ({ tag: 0, valid: false, lastUsed: 0 }))
  );
}

export function simulateCache(trace: TraceEntry[], config: CacheConfig): CacheStats {
  const accesses = collectAccesses(trace);
  if (accesses.length === 0) {
    return {
      accesses: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      missesByType: { read: 0, write: 0 },
    };
  }

  const lineSize = Math.max(2, config.lineSizeBytes);
  const sets = createSets(config);
  const setCount = sets.length;

  let hits = 0;
  let misses = 0;
  const missesByType = { read: 0, write: 0 };
  let tick = 0;

  for (const access of accesses) {
    tick++;
    const block = Math.floor(access.address / lineSize);
    const setIndex = block % setCount;
    const tag = Math.floor(block / setCount);
    const set = sets[setIndex];

    const hitLine = set.find((line) => line.valid && line.tag === tag);
    if (hitLine) {
      hits++;
      hitLine.lastUsed = tick;
      continue;
    }

    misses++;
    missesByType[access.kind]++;

    const empty = set.find((line) => !line.valid);
    if (empty) {
      empty.valid = true;
      empty.tag = tag;
      empty.lastUsed = tick;
      continue;
    }

    let lru = set[0];
    for (const line of set) {
      if (line.lastUsed < lru.lastUsed) {
        lru = line;
      }
    }
    lru.tag = tag;
    lru.valid = true;
    lru.lastUsed = tick;
  }

  return {
    accesses: accesses.length,
    hits,
    misses,
    hitRate: accesses.length === 0 ? 0 : Math.round((hits / accesses.length) * 1000) / 10,
    missesByType,
  };
}
