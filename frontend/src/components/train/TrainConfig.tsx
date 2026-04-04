import { Settings } from 'lucide-react';
import type { TrainConfig } from '../../types';

interface Props {
  config: TrainConfig;
  setConfig: (config: TrainConfig) => void;
  disabled?: boolean;
}

export default function TrainConfigForm({ config, setConfig, disabled }: Props) {
  const update = (partial: Partial<TrainConfig>) =>
    setConfig({ ...config, ...partial });

  return (
    <div className="card p-4 space-y-4">
      <div className="text-sm font-medium text-gray-300 flex items-center gap-2">
        <Settings size={14} className="text-blue-400" />
        QLoRA 설정
      </div>

      {/* Epochs slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-400">에포크 (Epochs)</label>
          <span className="text-sm font-mono text-blue-400">{config.num_epochs}</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          value={config.num_epochs}
          onChange={(e) => update({ num_epochs: Number(e.target.value) })}
          disabled={disabled}
          className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <div className="flex justify-between text-xs text-gray-600">
          <span>1</span>
          <span>5</span>
          <span>10</span>
        </div>
      </div>

      {/* Learning rate */}
      <div className="space-y-1.5">
        <label className="text-sm text-gray-400">학습률 (Learning Rate)</label>
        <input
          type="text"
          value={config.learning_rate}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) update({ learning_rate: val });
          }}
          className="input-field font-mono text-sm"
          placeholder="0.0002"
          disabled={disabled}
        />
      </div>

      {/* LoRA Rank */}
      <div className="space-y-1.5">
        <label className="text-sm text-gray-400">LoRA 랭크 (Rank)</label>
        <select
          value={config.lora_rank}
          onChange={(e) => update({ lora_rank: Number(e.target.value) })}
          className="input-field text-sm"
          disabled={disabled}
        >
          {[8, 16, 32, 64].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Batch size */}
      <div className="space-y-1.5">
        <label className="text-sm text-gray-400">배치 크기 (Batch Size)</label>
        <select
          value={config.batch_size}
          onChange={(e) => update({ batch_size: Number(e.target.value) })}
          className="input-field text-sm"
          disabled={disabled}
        >
          {[1, 2, 4, 8, 16].map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      {/* Max sequence length */}
      <div className="space-y-1.5">
        <label className="text-sm text-gray-400">최대 시퀀스 길이</label>
        <select
          value={config.max_seq_length}
          onChange={(e) => update({ max_seq_length: Number(e.target.value) })}
          className="input-field text-sm"
          disabled={disabled}
        >
          {[512, 1024, 2048, 4096].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
