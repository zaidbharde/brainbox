import { Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SavedSnapshot, SnapshotComparison } from '@/lab/types';

interface SnapshotManagerProps {
  snapshots: SavedSnapshot[];
  compareAId: string | null;
  compareBId: string | null;
  comparison: SnapshotComparison | null;
  onSaveCurrent: () => void;
  onRestoreSnapshot: (snapshotId: string) => void;
  onCompareAChange: (snapshotId: string | null) => void;
  onCompareBChange: (snapshotId: string | null) => void;
}

function formatHex(value: number, width: number = 4): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

export function SnapshotManager({
  snapshots,
  compareAId,
  compareBId,
  comparison,
  onSaveCurrent,
  onRestoreSnapshot,
  onCompareAChange,
  onCompareBChange,
}: SnapshotManagerProps) {
  return (
    <div className="space-y-4">
      <Button
        variant="secondary"
        size="sm"
        onClick={onSaveCurrent}
        className="w-full justify-center whitespace-normal text-center"
        icon={<Save className="w-4 h-4" />}
      >
        Save Current CPU Snapshot
      </Button>

      <div className="space-y-2 max-h-48 overflow-auto pr-1">
        {snapshots.length === 0 && (
          <div className="text-xs text-gray-500">No named snapshots yet.</div>
        )}
        {snapshots.map((snapshot) => (
          <div key={snapshot.id} className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="min-w-0 pr-2 text-xs font-semibold text-white truncate">{snapshot.label}</span>
              <span className="text-[11px] text-gray-500">
                {new Date(snapshot.createdAtMs).toLocaleTimeString()}
              </span>
            </div>
            <div className="text-[11px] text-gray-500 mb-2">
              Step {snapshot.step} | AX={formatHex(snapshot.state.registers.AX)} | IP={formatHex(snapshot.state.registers.IP)}
            </div>
            <Button size="sm" variant="secondary" onClick={() => onRestoreSnapshot(snapshot.id)}>
              Restore
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-3 space-y-2">
        <div className="text-xs text-gray-500 uppercase tracking-wider">Snapshot Comparison</div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={compareAId ?? ''}
            onChange={(event) => onCompareAChange(event.target.value || null)}
            className="bg-[#13201e] border border-[#1f2b29] rounded px-2 py-1 text-xs text-gray-200"
          >
            <option value="">Base Snapshot</option>
            {snapshots.map((snapshot) => (
              <option key={`a-${snapshot.id}`} value={snapshot.id}>
                {snapshot.label}
              </option>
            ))}
          </select>
          <select
            value={compareBId ?? ''}
            onChange={(event) => onCompareBChange(event.target.value || null)}
            className="bg-[#13201e] border border-[#1f2b29] rounded px-2 py-1 text-xs text-gray-200"
          >
            <option value="">Target Snapshot</option>
            {snapshots.map((snapshot) => (
              <option key={`b-${snapshot.id}`} value={snapshot.id}>
                {snapshot.label}
              </option>
            ))}
          </select>
        </div>

        {!comparison && (
          <div className="text-xs text-gray-500">Select two snapshots to compare state transitions.</div>
        )}

        {comparison && (
          <div className="space-y-2 text-[11px]">
            <div className="text-gray-400">
              Register diffs: <span className="text-[#e0b56a]">{comparison.registerDiffs.length}</span>
              {' '}| Flag diffs: <span className="text-[#e0b56a]">{comparison.flagDiffs.length}</span>
              {' '}| Memory word diffs: <span className="text-[#e0b56a]">{comparison.memoryDiffCount}</span>
            </div>
            {comparison.registerDiffs.length > 0 && (
              <div className="text-gray-500">
                Reg: {comparison.registerDiffs.slice(0, 8).map((item) => `${item.register}:${formatHex(item.before)}->${formatHex(item.after)}`).join(', ')}
              </div>
            )}
            {comparison.flagDiffs.length > 0 && (
              <div className="text-gray-500">
                Flags: {comparison.flagDiffs.map((item) => `${item.flag}:${item.before ? 1 : 0}->${item.after ? 1 : 0}`).join(', ')}
              </div>
            )}
            {comparison.memoryDiffSample.length > 0 && (
              <div className="text-gray-500">
                Mem sample: {comparison.memoryDiffSample.slice(0, 10).map((address) => formatHex(address)).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
