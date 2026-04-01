import { CPUState } from '@/types/cpu';

interface StackFramePanelProps {
  state: CPUState;
  programLength: number;
}

function formatHex(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

function readWord(memory: Uint8Array, address: number): number | null {
  if (address < 0 || address + 1 >= memory.length) return null;
  return memory[address] | (memory[address + 1] << 8);
}

export function StackFramePanel({ state, programLength }: StackFramePanelProps) {
  const rows = [];
  for (let offset = 0; offset < 20; offset += 2) {
    const address = state.registers.SP + offset;
    const value = readWord(state.memory, address);
    if (value === null) break;
    rows.push({
      address,
      value,
      isReturnAddress: value >= 0 && value < programLength,
    });
  }

  const estimatedCallDepth = rows.filter((row) => row.isReturnAddress).length;

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500 uppercase tracking-wider">
        Stack Frames (Estimated depth {estimatedCallDepth})
      </div>
      <div className="space-y-1 max-h-48 overflow-auto pr-1">
        {rows.length === 0 && <div className="text-xs text-gray-500">Stack is empty.</div>}
        {rows.map((row) => (
          <div
            key={row.address}
            className={`rounded border px-2 py-1 text-xs font-mono ${row.isReturnAddress ? 'border-[#e0b56a]/40 bg-[#e0b56a]/10 text-[#f0d08b]' : 'border-[#1f2b29] bg-[#0f1716] text-gray-300'}`}
          >
            {formatHex(row.address)} : {formatHex(row.value)}
            {row.isReturnAddress && <span className="text-[11px] text-gray-500">  (ret)</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
