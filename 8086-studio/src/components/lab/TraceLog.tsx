import { TraceEntry } from '@/lab/types';
import { cn } from '@/utils/cn';

interface TraceLogProps {
  entries: TraceEntry[];
  maxEntries?: number;
}

function formatHex(value: number, width: number = 4): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

export function TraceLog({ entries, maxEntries = 80 }: TraceLogProps) {
  const visibleEntries = entries.slice(-maxEntries).reverse();

  return (
    <div className="space-y-2 max-h-72 overflow-auto pr-1">
      {visibleEntries.length === 0 && (
        <div className="text-xs text-gray-500">Trace is empty. Execute instructions to populate the log.</div>
      )}

      {visibleEntries.map((entry) => (
        <div key={`${entry.step}-${entry.timestampMs}`} className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-2">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-mono text-[#e0b56a]">#{entry.step} @ {formatHex(entry.instructionAddress)}</span>
            <span className="font-mono text-gray-500">{entry.cycles} cyc</span>
          </div>
          <div className="font-mono text-xs text-gray-200 mb-1">{entry.instructionText}</div>
          <div className="text-[11px] text-gray-500 mb-1">
            IP {formatHex(entry.ipBefore)} -&gt; {formatHex(entry.ipAfter)}
          </div>
          <div className="flex flex-wrap gap-1 text-[11px]">
            <SignalChip label="Reg" values={entry.changedRegisters} />
            <SignalChip label="Flags" values={entry.changedFlags} />
            <SignalChip
              label="Mem"
              values={entry.changedMemoryWords.map((address) => formatHex(address))}
              valueClassName="text-[#7ab6ff]"
            />
            <SignalChip
              label="Rd"
              values={entry.memoryReads.map((address) => formatHex(address))}
              valueClassName="text-[#7adfb1]"
            />
            <SignalChip
              label="Wr"
              values={entry.memoryWrites.map((address) => formatHex(address))}
              valueClassName="text-[#f0b45b]"
            />
          </div>
          {entry.output.length > 0 && (
            <div className="mt-1 text-[11px] text-[#5de6a0]">
              OUT: {entry.output.map((item) => item.type === 'char' ? `'${String.fromCharCode(item.value)}'` : item.value).join(', ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SignalChip({
  label,
  values,
  valueClassName,
}: {
  label: string;
  values: Array<string | number>;
  valueClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-[#1f2b29] bg-[#13201e] px-1.5 py-0.5">
      <span className="text-gray-500">{label}:</span>
      <span className={cn('font-mono text-[#e0b56a]', valueClassName)}>
        {values.length > 0 ? values.join(',') : '-'}
      </span>
    </span>
  );
}
