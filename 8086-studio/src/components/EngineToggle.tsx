/**
 * The Legacy / v2 control.
 *
 * A person should not have to know that the lab has two engines, let alone that
 * the way to choose between them used to be editing a query string. So the choice
 * is a control, in the top bar of every view that runs a program -- including the
 * Assembly Editor, which is where hand-written programs are typed and therefore
 * where the difference between a strict assembler and a lenient one is felt
 * first.
 *
 * Both buttons carry the same tooltip, because the question a person actually has
 * is "what am I switching to" and that depends on which of the two they are
 * looking at. The per-engine detail is on each button.
 */

import { ENGINE_CHOICES, ENGINE_DESCRIPTIONS, ENGINE_LABELS, ENGINE_TOGGLE_TITLE } from '@/lab/engine-choice';
import type { EngineId } from '@/lab/execution-engine';
import { cn } from '@/utils/cn';

interface EngineToggleProps {
  /** The engine in use. */
  engine: EngineId;
  /** Called with the engine to switch to. Not called when it is already in use. */
  onChange: (engine: EngineId) => void;
  /** Set when the engine cannot be changed right now, with the reason to show. */
  disabledReason?: string | null;
}

export function EngineToggle({ engine, onChange, disabledReason = null }: EngineToggleProps) {
  const disabled = disabledReason !== null;

  return (
    <div
      className={cn(
        'flex items-center rounded-xl border border-[#365079]/70 p-0.5',
        'bg-[linear-gradient(160deg,rgba(22,35,57,0.95),rgba(17,28,45,0.85))]',
        disabled && 'opacity-50',
      )}
      role="group"
      aria-label="Engine"
      title={disabled ? disabledReason : ENGINE_TOGGLE_TITLE}
    >
      {ENGINE_CHOICES.map((choice) => {
        const active = choice === engine;
        return (
          <button
            key={choice}
            type="button"
            onClick={() => {
              if (!active && !disabled) {
                onChange(choice);
              }
            }}
            disabled={disabled}
            aria-pressed={active}
            title={ENGINE_DESCRIPTIONS[choice]}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-lg transition-all duration-200',
              'focus:outline-none focus:ring-2 focus:ring-[#4ed8c9]/45',
              'disabled:cursor-not-allowed',
              active
                ? 'bg-[linear-gradient(90deg,rgba(78,216,201,0.28),rgba(116,178,255,0.24))] text-white shadow-[inset_0_0_0_1px_rgba(120,200,230,0.35)]'
                : 'text-[#b9c9e5] hover:text-white hover:bg-[#ffffff0e]',
            )}
          >
            {ENGINE_LABELS[choice]}
          </button>
        );
      })}
    </div>
  );
}
