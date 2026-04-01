import { Challenge } from '@/lab/challenges';
import { Button } from '@/components/ui/Button';

interface ChallengePanelProps {
  challenges: Challenge[];
  selectedChallengeId: string | null;
  onSelectChallenge: (challengeId: string) => void;
  onLoadChallenge: () => void;
  onCheckChallenge: () => void;
  resultMessage: string | null;
}

export function ChallengePanel({
  challenges,
  selectedChallengeId,
  onSelectChallenge,
  onLoadChallenge,
  onCheckChallenge,
  resultMessage,
}: ChallengePanelProps) {
  const selected = challenges.find((item) => item.id === selectedChallengeId) ?? null;

  return (
    <div className="space-y-3">
      <select
        value={selectedChallengeId ?? ''}
        onChange={(event) => onSelectChallenge(event.target.value)}
        className="w-full bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1.5 text-xs text-gray-200"
      >
        <option value="">Select challenge...</option>
        {challenges.map((challenge) => (
          <option key={challenge.id} value={challenge.id}>
            {challenge.title}
          </option>
        ))}
      </select>

      {selected && (
        <div className="rounded border border-[#1f2b29] bg-[#0f1716] p-2 text-xs text-gray-400">
          {selected.description}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onLoadChallenge} disabled={!selected}>
          Load Challenge
        </Button>
        <Button size="sm" variant="success" onClick={onCheckChallenge} disabled={!selected}>
          Check Solution
        </Button>
      </div>

      {resultMessage && (
        <div className="text-xs text-[#e0b56a]">{resultMessage}</div>
      )}
    </div>
  );
}
