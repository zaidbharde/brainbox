import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { MemoryWatchpoint, WatchpointType } from '@/lab/types';

interface WatchpointPanelProps {
  watchpoints: MemoryWatchpoint[];
  onAddWatchpoint: (payload: { label: string; address: number; size: number; type: WatchpointType }) => void;
  onRemoveWatchpoint: (id: string) => void;
  onToggleWatchpoint: (id: string) => void;
}

function parseAddress(value: string): number | null {
  const trimmed = value.trim();
  if (/^0x[0-9A-Fa-f]+$/.test(trimmed)) return parseInt(trimmed.slice(2), 16);
  if (/^[0-9A-Fa-f]+h$/i.test(trimmed)) return parseInt(trimmed.slice(0, -1), 16);
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  return null;
}

function formatHex(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

export function WatchpointPanel({
  watchpoints,
  onAddWatchpoint,
  onRemoveWatchpoint,
  onToggleWatchpoint,
}: WatchpointPanelProps) {
  const [label, setLabel] = useState('');
  const [addressInput, setAddressInput] = useState('0100h');
  const [sizeInput, setSizeInput] = useState('2');
  const [type, setType] = useState<WatchpointType>('change');

  const submit = () => {
    const address = parseAddress(addressInput);
    const size = parseInt(sizeInput, 10);
    if (address === null || Number.isNaN(size) || size <= 0) {
      return;
    }
    onAddWatchpoint({
      label: label.trim() || `WP_${formatHex(address)}`,
      address,
      size,
      type,
    });
    setLabel('');
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label"
          className="bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1.5 text-xs text-gray-200"
        />
        <input
          value={addressInput}
          onChange={(event) => setAddressInput(event.target.value)}
          placeholder="Address"
          className="bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1.5 text-xs text-gray-200"
        />
        <input
          value={sizeInput}
          onChange={(event) => setSizeInput(event.target.value)}
          placeholder="Size"
          className="bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1.5 text-xs text-gray-200"
        />
        <select
          value={type}
          onChange={(event) => setType(event.target.value as WatchpointType)}
          className="bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1.5 text-xs text-gray-200"
        >
          <option value="read">Read</option>
          <option value="write">Write</option>
          <option value="change">Change</option>
        </select>
      </div>
      <Button size="sm" variant="secondary" onClick={submit} icon={<Plus className="w-4 h-4" />}>
        Add Watchpoint
      </Button>

      <div className="space-y-2 max-h-56 overflow-auto pr-1">
        {watchpoints.length === 0 && (
          <div className="text-xs text-gray-500">No memory watchpoints configured.</div>
        )}
        {watchpoints.map((watchpoint) => (
          <div key={watchpoint.id} className="rounded border border-[#1f2b29] bg-[#0f1716] px-2 py-1.5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => onToggleWatchpoint(watchpoint.id)}
                className={`text-xs font-semibold ${watchpoint.enabled ? 'text-[#7adfb1]' : 'text-gray-500'}`}
              >
                {watchpoint.enabled ? '[ON]' : '[OFF]'} {watchpoint.label}
              </button>
              <button
                type="button"
                onClick={() => onRemoveWatchpoint(watchpoint.id)}
                className="text-gray-500 hover:text-[#f38b8b]"
                title="Delete watchpoint"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              {watchpoint.type.toUpperCase()} @ {formatHex(watchpoint.address)} size {watchpoint.size}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
