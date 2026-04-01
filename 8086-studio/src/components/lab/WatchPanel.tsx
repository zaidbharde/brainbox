import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { WatchValue } from '@/lab/types';

interface WatchPanelProps {
  watchValues: WatchValue[];
  onAddWatch: (expression: string) => void;
  onRemoveWatch: (id: string) => void;
}

export function WatchPanel({ watchValues, onAddWatch, onRemoveWatch }: WatchPanelProps) {
  const [expression, setExpression] = useState('');

  const submit = () => {
    const trimmed = expression.trim();
    if (!trimmed) return;
    onAddWatch(trimmed);
    setExpression('');
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit();
            }
          }}
          placeholder="AX, ZF, [0100h], [SI+2]"
          className="flex-1 bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1.5 text-xs text-gray-200"
        />
        <Button size="sm" variant="secondary" onClick={submit} icon={<Plus className="w-4 h-4" />}>
          Add
        </Button>
      </div>

      <div className="space-y-2 max-h-56 overflow-auto pr-1">
        {watchValues.length === 0 && (
          <div className="text-xs text-gray-500">No watch expressions added yet.</div>
        )}
        {watchValues.map((watch) => (
          <div key={watch.id} className="rounded border border-[#1f2b29] bg-[#0f1716] px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-[#e0b56a]">{watch.expression}</span>
              <button
                type="button"
                onClick={() => onRemoveWatch(watch.id)}
                className="text-gray-500 hover:text-[#f38b8b]"
                title="Remove watch"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {watch.ok ? (
              <div className="mt-1 text-xs">
                <span className={watch.changed ? 'text-[#f0b45b]' : 'text-gray-200'}>
                  {watch.hexValue} ({watch.value})
                </span>
              </div>
            ) : (
              <div className="mt-1 text-[11px] text-[#f38b8b]">{watch.error}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
