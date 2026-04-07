import { TrendingDown, BarChart3 } from 'lucide-react';

interface Props {
  losses: number[];
  currentEpoch: number;
  totalEpochs: number;
  step: number;
  totalSteps: number;
  detail: string;
  isTraining: boolean;
}

export default function LossChart({
  losses,
  currentEpoch,
  totalEpochs,
  step,
  totalSteps,
  detail,
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

  // Only show last 50 data points to keep chart readable
  const displayLosses = losses.length > 50 ? losses.slice(-50) : losses;
  // Use recent values for scale (last 80%) to avoid early outliers crushing the chart
  const recentStart = Math.max(0, Math.floor(displayLosses.length * 0.2));
  const recentLosses = displayLosses.slice(recentStart);
  const minLoss = recentLosses.length > 0 ? Math.min(...recentLosses) : 0;
  const maxLoss = recentLosses.length > 0 ? Math.max(...recentLosses) : 1;
  // Add 10% padding
  const padding = (maxLoss - minLoss) * 0.1 || 0.1;
  const scaleMin = Math.max(0, minLoss - padding);
  const scaleMax = maxLoss + padding;

  return (
    <div className="card h-full flex flex-col">
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-400 flex items-center gap-2">
          <TrendingDown size={14} />
          학습 손실 (Loss)
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          {totalSteps > 0 && <span>Step: {step}/{totalSteps}</span>}
          <span>에포크: {currentEpoch}/{totalEpochs}</span>
        </div>
      </div>

      <div className="flex-1 p-4 flex flex-col min-h-0">
        {/* Chart */}
        <div className="flex-1 flex items-end gap-px min-h-[100px]">
          {displayLosses.map((loss, i) => {
            // Clamp to scale range, then normalize
            const clamped = Math.min(Math.max(loss, scaleMin), scaleMax);
            const normalized = (clamped - scaleMin) / (scaleMax - scaleMin);
            const height = Math.max(4, normalized * 100);
            // Color: green when low, blue when mid, red when high
            const hue = Math.max(0, 200 - normalized * 200); // 200(blue) → 0(red)
            return (
              <div
                key={i}
                className="flex-1 rounded-t transition-all duration-200 min-w-[2px]"
                style={{
                  height: `${height}%`,
                  background: `hsl(${hue}, 70%, 50%)`,
                }}
                title={`Step ${losses.length - displayLosses.length + i + 1}: ${loss.toFixed(4)}`}
              />
            );
          })}
          {losses.length === 0 && isTraining && (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                학습 준비 중...
              </div>
            </div>
          )}
        </div>

        {/* Y-axis labels */}
        {displayLosses.length > 0 && (
          <div className="flex justify-between text-[10px] text-gray-600 mt-1">
            <span>{scaleMin.toFixed(2)}</span>
            <span>최근 범위</span>
            <span>{scaleMax.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Bottom info */}
      {(losses.length > 0 || detail) && (
        <div className="px-4 py-2 border-t border-gray-800 flex items-center justify-between text-xs">
          {detail ? (
            <span className="text-gray-500 truncate flex-1">{detail}</span>
          ) : (
            <span className="text-gray-500">총 {losses.length}개 기록</span>
          )}
          {losses.length > 0 && (
            <span className="font-mono text-blue-400 ml-2">{losses[losses.length - 1].toFixed(4)}</span>
          )}
        </div>
      )}
    </div>
  );
}
