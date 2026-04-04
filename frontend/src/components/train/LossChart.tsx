import { TrendingDown, BarChart3 } from 'lucide-react';

interface Props {
  losses: number[];
  currentEpoch: number;
  totalEpochs: number;
  elapsedTime: string;
  isTraining: boolean;
}

export default function LossChart({
  losses,
  currentEpoch,
  totalEpochs,
  elapsedTime,
  isTraining,
}: Props) {
  if (!isTraining && losses.length === 0) {
    return (
      <div className="card h-full flex items-center justify-center text-gray-500 p-8">
        <div className="text-center">
          <BarChart3 size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">학습을 시작하면 로스 그래프가 여기에 표시됩니다</p>
        </div>
      </div>
    );
  }

  const maxLoss = Math.max(...losses, 0.01);

  return (
    <div className="card h-full flex flex-col">
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-400 flex items-center gap-2">
          <TrendingDown size={14} />
          학습 손실 (Loss)
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>에포크: {currentEpoch}/{totalEpochs}</span>
          <span>경과: {elapsedTime}</span>
        </div>
      </div>

      <div className="flex-1 p-4 flex flex-col">
        {/* Simple bar chart */}
        <div className="flex-1 flex items-end gap-1">
          {losses.map((loss, i) => {
            const height = (loss / maxLoss) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-gray-500 font-mono">{loss.toFixed(3)}</span>
                <div
                  className="w-full rounded-t transition-all duration-300"
                  style={{
                    height: `${height}%`,
                    minHeight: '4px',
                    background: `linear-gradient(to top, #2563eb, #3b82f6)`,
                  }}
                />
              </div>
            );
          })}
          {losses.length === 0 && isTraining && (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                데이터 수집 중...
              </div>
            </div>
          )}
        </div>
        {losses.length > 0 && (
          <div className="flex justify-between text-xs text-gray-600 mt-2 pt-2 border-t border-gray-800">
            <span>Step 1</span>
            <span>Step {losses.length}</span>
          </div>
        )}
      </div>

      {/* Latest loss */}
      {losses.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800 flex items-center justify-between text-xs">
          <span className="text-gray-500">현재 Loss</span>
          <span className="font-mono text-blue-400">{losses[losses.length - 1].toFixed(4)}</span>
        </div>
      )}
    </div>
  );
}
