/**
 * Which engine the lab is using, and how that is decided.
 *
 * The engine used to come from one place only: a `?engine=v2` in the URL. That
 * works when the studio is opened on its own and it is the only thing that works
 * when the studio is opened on its own, but a person arriving through BrainBox
 * has no reason to know they can edit a query string to change which instructions
 * their program is assembled by. So the choice lives here, and it is resolved from
 * three sources in a fixed order:
 *
 *   1. `?engine=` in the URL, if the parameter is present at all.
 *   2. The saved choice in `localStorage`.
 *   3. The legacy engine.
 *
 * The URL is first so that a link can still decide, and so that a person who
 * arrived at `?engine=v2` sees the new engine no matter what this browser
 * remembers. A link is a stronger statement of intent than a remembered
 * preference, and a stale preference should not be able to overrule one.
 *
 * A parameter that is present but unrecognised resolves to the legacy engine
 * rather than falling through to the saved choice. That is the behaviour
 * `engineFromQuery` has always had -- a mistyped parameter must not silently
 * change which instructions run -- and keeping it means a link that says
 * `?engine=v3` behaves the same way here as it did before, rather than picking up
 * whatever the browser last saw.
 */

import type { EngineId } from '@/lab/execution-engine';
import { DEFAULT_ENGINE } from '@/lab/execution-engine';

/** Where the choice is remembered between visits. */
export const ENGINE_STORAGE_KEY = 'x86-studio:engine';

/** The two engines, in the order the toggle shows them. */
export const ENGINE_CHOICES: readonly EngineId[] = ['legacy', 'v2'];

/** The label each button carries. */
export const ENGINE_LABELS: Record<EngineId, string> = {
  legacy: 'Legacy',
  v2: 'v2',
};

/**
 * What each engine is, and what picking it costs you. Shown as the tooltip on both
 * buttons, because the difference is not a matter of taste and picking wrong is
 * confusing: the two engines disagree about flags, about addresses, and about
 * which instructions they will assemble at all.
 */
export const ENGINE_DESCRIPTIONS: Record<EngineId, string> = {
  legacy: 'v1 — the original engine. Its flags are not 8086-accurate, addresses are offsets rather than physical addresses, and its assembler accepts source the hardware would not.',
  v2: 'v2 — 8086-accurate flags and real addresses, and a strict assembler that rejects what the hardware would reject. Programs that assembled under Legacy may not assemble here, and that is the point.',
};

/** The single tooltip agreed for the control. */
export const ENGINE_TOGGLE_TITLE =
  'v2 = 8086-accurate flags and real addresses; v1 differs in flags, addressing, and how strict the assembler is';

/** Is this a name the lab knows? */
function asEngineId(value: string | null | undefined): EngineId | null {
  return value === 'v2' || value === 'legacy' ? value : null;
}

/**
 * The saved choice, or `null` if there is not one to be had.
 *
 * `localStorage` throws rather than returning null in more situations than people
 * expect: a browser with site data blocked, a private window in some
 * configurations, a quota that is already full, and a document that is not allowed
 * to store anything at all. All of those mean the same thing here, which is that
 * there is no saved choice, so they are caught together and the caller falls
 * through to the default.
 */
export function readStoredEngine(storage: Pick<Storage, 'getItem'> | null | undefined): EngineId | null {
  if (!storage) {
    return null;
  }
  try {
    return asEngineId(storage.getItem(ENGINE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Remember the choice. Failing to is not worth interrupting anyone over: the URL
 * is updated as well, so the choice still holds for the session either way.
 */
export function writeStoredEngine(
  engine: EngineId,
  storage: Pick<Storage, 'setItem'> | null | undefined,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(ENGINE_STORAGE_KEY, engine);
  } catch {
    // Nothing to do: see `readStoredEngine`.
  }
}

/**
 * The engine to use, from a query string and a storage.
 *
 * Both are passed in rather than read from `window` so the order can be tested
 * without a browser, and so a caller that has already read them does not read
 * them twice.
 */
export function resolveEngine(
  search: string,
  storage?: Pick<Storage, 'getItem'> | null,
): EngineId {
  const fromQuery = new URLSearchParams(search).get('engine');
  if (fromQuery !== null) {
    // Present but unrecognised falls back to the default rather than to the saved
    // choice; see the note at the top of this file.
    return asEngineId(fromQuery) ?? DEFAULT_ENGINE;
  }
  return readStoredEngine(storage) ?? DEFAULT_ENGINE;
}

/**
 * The URL for a choice, leaving every other parameter alone.
 *
 * The legacy engine is the default, so choosing it clears the parameter rather
 * than writing `?engine=legacy`: a link to the default should look like a link to
 * the default.
 */
export function engineUrl(search: string, engine: EngineId): string {
  const params = new URLSearchParams(search);
  if (engine === 'v2') {
    params.set('engine', 'v2');
  } else {
    params.delete('engine');
  }
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}
