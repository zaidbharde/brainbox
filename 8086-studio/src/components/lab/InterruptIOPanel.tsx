import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CPUState } from '@/types/cpu';

interface InterruptIOPanelProps {
  state: CPUState;
  onTriggerInterrupt: (vector: number) => void;
}

const IO_PORT_BASE = 0x0300;

function readWord(memory: Uint8Array, address: number): number {
  return memory[address] | (memory[address + 1] << 8);
}

function formatHex(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

export function InterruptIOPanel({ state, onTriggerInterrupt }: InterruptIOPanelProps) {
  const [vectorInput, setVectorInput] = useState('1');
  const ports = Array.from({ length: 8 }, (_, i) => {
    const address = IO_PORT_BASE + i * 2;
    return {
      port: i,
      value: readWord(state.memory, address),
    };
  });

  const trigger = () => {
    const parsed = parseInt(vectorInput, 10);
    if (Number.isNaN(parsed) || parsed < 0) return;
    onTriggerInterrupt(parsed & 0xFF);
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500 uppercase tracking-wider">Interrupt + I/O Model</div>

      <div className="flex gap-2">
        <input
          value={vectorInput}
          onChange={(event) => setVectorInput(event.target.value)}
          className="w-20 bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1 text-xs text-gray-200"
          placeholder="INT #"
        />
        <Button size="sm" variant="secondary" onClick={trigger}>
          Trigger INT
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        {ports.map((port) => (
          <div key={port.port} className="rounded border border-[#1f2b29] bg-[#0f1716] px-2 py-1">
            P{port.port}: {formatHex(port.value)}
          </div>
        ))}
      </div>
    </div>
  );
}
