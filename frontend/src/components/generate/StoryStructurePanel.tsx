import { Download, Eye, Settings, RotateCcw, ArrowLeft } from "lucide-react";

interface SceneData {
  num: number;
  description: string;
  text: string;
  status: "pending" | "generating" | "done" | "modified";
}

interface Props {
  phase: "input" | "outline" | "generating" | "review";
  scenes: SceneData[];
  selectedScene: number | null;
  onSelectScene: (num: number | null) => void;
  onExport: () => void;
  onReset: () => void;
  onBackToOutline: () => void;
  model: string;
  models: string[];
  onModelChange: (m: string) => void;
  numScenes: number;
  onNumScenesChange: (n: number) => void;
}

const STATUS_ICON: Record<string, string> = {
  pending: "\u2B1C",
  generating: "\uD83D\uDD04",
  done: "\u2705",
  modified: "\u26A0\uFE0F",
};

const PHASE_LABELS = [
  { key: "input", label: "\uC785\uB825" },
  { key: "outline", label: "\uC544\uC6C3\uB77C\uC778" },
  { key: "generating", label: "\uC0DD\uC131" },
  { key: "review", label: "\uAC80\uC218" },
];

export default function StoryStructurePanel({
  phase, scenes, selectedScene, onSelectScene,
  onExport, onReset, onBackToOutline, model, models, onModelChange,
  numScenes, onNumScenesChange,
}: Props) {
  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-700 w-[200px] min-w-[200px]">
      {/* Phase indicator */}
      <div className="p-3 border-b border-gray-700">
        <div className="text-xs text-gray-500 mb-2">Phase</div>
        <div className="space-y-1">
          {PHASE_LABELS.map((p, i) => {
            const isCurrent = p.key === phase;
            const isPast = PHASE_LABELS.findIndex(x => x.key === phase) > i;
            return (
              <div key={p.key} className={`text-xs px-2 py-1 rounded ${
                isCurrent ? "bg-blue-600/20 text-blue-400 font-medium" :
                isPast ? "text-green-400" : "text-gray-600"
              }`}>
                {isPast ? "\u2713" : isCurrent ? "\u25CF" : "\u25CB"} {p.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Settings */}
      <div className="p-3 border-b border-gray-700 space-y-2">
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <Settings size={10} /> 설정
        </div>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
          disabled={phase !== "input"}
        >
          {(Array.isArray(models) ? models : []).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">장면</span>
          <input
            type="number" min={4} max={20}
            value={numScenes}
            onChange={(e) => onNumScenesChange(Number(e.target.value))}
            className="w-12 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-300"
            disabled={phase !== "input"}
          />
        </div>
      </div>

      {/* Scene list */}
      {scenes.length > 0 && (
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <button
            onClick={() => onSelectScene(null)}
            className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-1 ${
              selectedScene === null ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"
            }`}
          >
            <Eye size={10} /> 전체 보기
          </button>
          {scenes.map((s) => (
            <button
              key={s.num}
              onClick={() => onSelectScene(s.num)}
              className={`w-full text-left text-xs px-2 py-1.5 rounded truncate ${
                selectedScene === s.num ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"
              }`}
            >
              {STATUS_ICON[s.status]} {s.num}. {s.description.slice(0, 20)}
            </button>
          ))}
        </div>
      )}

      {scenes.length === 0 && <div className="flex-1" />}

      {/* Actions */}
      <div className="p-3 border-t border-gray-700 space-y-1.5">
        {(phase === "generating" || phase === "review") && (
          <button
            onClick={onBackToOutline}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-3 py-1.5 text-xs flex items-center justify-center gap-1"
          >
            <ArrowLeft size={12} /> 아웃라인으로
          </button>
        )}
        {phase === "review" && (
          <button onClick={onExport} className="w-full bg-gray-700 hover:bg-gray-600 text-gray-200 rounded px-3 py-1.5 text-xs flex items-center justify-center gap-1">
            <Download size={12} /> 내보내기
          </button>
        )}
        {phase !== "input" && (
          <button
            onClick={onReset}
            className="w-full bg-gray-800 hover:bg-red-900/30 text-gray-500 hover:text-red-400 rounded px-3 py-1.5 text-xs flex items-center justify-center gap-1"
          >
            <RotateCcw size={12} /> 처음부터
          </button>
        )}
      </div>
    </div>
  );
}
