import { Settings, FolderOutput } from 'lucide-react';

interface Props {
  epochs: number;
  setEpochs: (v: number) => void;
  learningRate: string;
  setLearningRate: (v: string) => void;
  loraRank: number;
  setLoraRank: (v: number) => void;
  batchSize: number;
  setBatchSize: (v: number) => void;
  outputPath: string;
  setOutputPath: (v: string) => void;
  disabled?: boolean;
}

export default function TrainConfig({
  epochs,
  setEpochs,
  learningRate,
  setLearningRate,
  loraRank,
  setLoraRank,
  batchSize,
  setBatchSize,
  outputPath,
  setOutputPath,
  disabled,
}: Props) {
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
          <span className="text-sm font-mono text-blue-400">{epochs}</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          value={epochs}
          onChange={(e) => setEpochs(Number(e.target.value))}
          disabled={disabled}
          className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer
                     accent-blue-500"
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
          value={learningRate}
          onChange={(e) => setLearningRate(e.target.value)}
          className="input-field font-mono text-sm"
          placeholder="2e-4"
          disabled={disabled}
        />
      </div>

      {/* LoRA Rank */}
      <div className="space-y-1.5">
        <label className="text-sm text-gray-400">LoRA 랭크 (Rank)</label>
        <select
          value={loraRank}
          onChange={(e) => setLoraRank(Number(e.target.value))}
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
          value={batchSize}
          onChange={(e) => setBatchSize(Number(e.target.value))}
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

      {/* Output path */}
      <div className="space-y-1.5">
        <label className="text-sm text-gray-400 flex items-center gap-2">
          <FolderOutput size={12} />
          어댑터 저장 경로
        </label>
        <input
          type="text"
          value={outputPath}
          onChange={(e) => setOutputPath(e.target.value)}
          className="input-field text-sm font-mono"
          placeholder="./output/lora-adapter"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
