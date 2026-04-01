import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface ReplayPanelProps {
  onExport: () => string;
  onImport: (json: string) => string | null;
}

export function ReplayPanel({ onExport, onImport }: ReplayPanelProps) {
  const [payload, setPayload] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const exportSession = () => {
    const json = onExport();
    setPayload(json);
    setStatus('Replay exported to text box.');
  };

  const importSession = () => {
    const error = onImport(payload);
    setStatus(error ? `Import failed: ${error}` : 'Replay imported successfully.');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={exportSession} icon={<Download className="w-4 h-4" />}>
          Export Replay
        </Button>
        <Button size="sm" variant="secondary" onClick={importSession} icon={<Upload className="w-4 h-4" />}>
          Import Replay
        </Button>
      </div>

      <textarea
        value={payload}
        onChange={(event) => setPayload(event.target.value)}
        placeholder="Replay JSON appears here..."
        className="w-full min-h-28 bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-2 text-xs font-mono text-gray-200"
      />

      {status && <div className="text-xs text-gray-500">{status}</div>}
    </div>
  );
}
