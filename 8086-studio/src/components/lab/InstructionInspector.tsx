import { InstructionInspectorData } from '@/lab/types';

interface InstructionInspectorProps {
  data: InstructionInspectorData | null;
  instructionAddress: number | null;
}

function formatHex(value: number, width: number = 4): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

export function InstructionInspector({ data, instructionAddress }: InstructionInspectorProps) {
  if (!data) {
    return (
      <div className="text-xs text-gray-500">
        Select an instruction from the code list to inspect opcode behavior.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Instruction</div>
        <div className="font-mono text-[#f0b45b] text-lg">
          {data.opcode} {data.operands.join(', ')}
        </div>
        <div className="text-[11px] text-gray-500">
          Address: {instructionAddress !== null ? formatHex(instructionAddress) : 'N/A'} | Category: {data.category}
        </div>
      </div>

      <div className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-3 space-y-2">
        <div className="text-xs text-gray-400">{data.summary}</div>
        <div className="text-xs text-[#7adfb1]">{data.educationalNote}</div>
      </div>

      <div className="grid grid-cols-1 gap-2 text-xs">
        <InspectorRow label="Register Reads" value={data.registerReads.join(', ')} />
        <InspectorRow label="Register Writes" value={data.registerWrites.join(', ')} />
        <InspectorRow label="Flag Behavior" value={data.flagBehavior} />
      </div>

      <div className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-3 space-y-1">
        <div className="text-xs text-gray-500 uppercase tracking-wider">Virtual Encoding (Educational)</div>
        <div className="font-mono text-xs text-[#e0b56a]">{data.virtualEncodingHex}</div>
        <div className="font-mono text-[11px] text-gray-500 break-words">{data.virtualEncodingBinary}</div>
      </div>

      <div className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-3 text-xs">
        <div className="text-gray-500 uppercase tracking-wider mb-1">Last Observed Runtime Effects</div>
        {data.lastObservedEffects ? (
          <div className="space-y-1 text-gray-300">
            <div>Registers: {data.lastObservedEffects.changedRegisters.length > 0 ? data.lastObservedEffects.changedRegisters.join(', ') : '-'}</div>
            <div>Flags: {data.lastObservedEffects.changedFlags.length > 0 ? data.lastObservedEffects.changedFlags.join(', ') : '-'}</div>
            <div>Memory Words: {data.lastObservedEffects.changedMemoryWords.length > 0 ? data.lastObservedEffects.changedMemoryWords.map((address) => formatHex(address)).join(', ') : '-'}</div>
          </div>
        ) : (
          <div className="text-gray-500">Instruction not executed yet in current timeline.</div>
        )}
      </div>
    </div>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[#1f2b29] bg-[#0f1716] px-2 py-1.5">
      <span className="text-gray-500 mr-2">{label}:</span>
      <span className="text-gray-300">{value}</span>
    </div>
  );
}
