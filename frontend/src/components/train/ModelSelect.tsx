import { Box } from 'lucide-react';
import type { TrainModel } from '../../types';

interface Props {
  models: TrainModel[];
  selectedId: string;
  onChange: (id: string) => void;
  loading?: boolean;
}

export default function ModelSelect({ models, selectedId, onChange, loading }: Props) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
        <Box size={14} className="text-blue-400" />
        베이스 모델
      </label>
      <select
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
        className="input-field"
        disabled={loading}
      >
        <option value="">모델 선택...</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.size})
          </option>
        ))}
      </select>
    </div>
  );
}
