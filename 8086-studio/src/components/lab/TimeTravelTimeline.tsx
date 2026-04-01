import { ExecutionSnapshot, TraceEntry } from '@/lab/types';
import { cn } from '@/utils/cn';

interface TimeTravelTimelineProps {
  snapshots: ExecutionSnapshot[];
  trace: TraceEntry[];
  activeIndex: number;
  onSeek: (index: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function TimeTravelTimeline({
  snapshots,
  trace,
  activeIndex,
  onSeek,
}: TimeTravelTimelineProps) {
  const maxIndex = Math.max(0, snapshots.length - 1);
  const safeIndex = clamp(activeIndex, 0, maxIndex);
  const activeTraceEntry = safeIndex > 0 ? trace[safeIndex - 1] : null;

  const denseBars = trace.slice(-60);
  const maxCycles = Math.max(1, ...denseBars.map((entry) => entry.cycles));
  const activeGlobalStep = safeIndex > 0 ? trace[safeIndex - 1]?.step ?? 0 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 uppercase tracking-wider">Time-Travel Timeline</span>
        <span className="font-mono text-[#7adfb1]">Step {safeIndex}/{maxIndex}</span>
      </div>

      <input
        type="range"
        min={0}
        max={maxIndex}
        step={1}
        value={safeIndex}
        onChange={(event) => onSeek(Number(event.target.value))}
        className="w-full accent-[#45d1a3]"
      />

      <div className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-2">
        {denseBars.length === 0 ? (
          <p className="text-xs text-gray-500">Execute at least one instruction to populate timeline.</p>
        ) : (
          <div className="flex items-end gap-1 h-16">
            {denseBars.map((entry) => {
              const isActive = entry.step === activeGlobalStep;
              const height = Math.max(8, Math.round((entry.cycles / maxCycles) * 56));
              return (
                <button
                  key={entry.step}
                  type="button"
                  onClick={() => onSeek(entry.step)}
                  title={`Step ${entry.step} | ${entry.instructionText} | ${entry.cycles} cycles`}
                  className={cn(
                    'flex-1 rounded-sm transition-colors',
                    isActive ? 'bg-[#e0b56a]' : 'bg-[#45d1a3]/40 hover:bg-[#45d1a3]/70'
                  )}
                  style={{ height }}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="text-[11px] text-gray-500">
        {activeTraceEntry
          ? `Focused step: ${activeTraceEntry.instructionText} (${activeTraceEntry.cycles} cycles)`
          : 'Focused step: Initial CPU reset state'}
      </div>
    </div>
  );
}
