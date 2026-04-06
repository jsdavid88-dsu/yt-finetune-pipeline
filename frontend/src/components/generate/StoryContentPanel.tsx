import { useState } from "react";
import { Play, Pencil, Eye, RotateCcw } from "lucide-react";

interface SceneData {
  num: number;
  description: string;
  text: string;
  status: "pending" | "generating" | "done" | "modified";
}

interface Props {
  phase: "input" | "outline" | "generating" | "review";
  genre: string;
  topic: string;
  onGenreChange: (g: string) => void;
  onTopicChange: (t: string) => void;
  outline: string;
  onOutlineChange: (o: string) => void;
  scenes: SceneData[];
  selectedScene: number | null;
  onSceneTextChange: (num: number, text: string) => void;
  onGenerateOutline: () => void;
  onApproveOutline: () => void;
  onRegenerateScene: (num: number) => void;
  outlineLoading: boolean;
  generatingSceneNum: number | null;
  generatingSceneText: string;
}

export default function StoryContentPanel({
  phase, genre, topic, onGenreChange, onTopicChange,
  outline, onOutlineChange, scenes, selectedScene,
  onSceneTextChange, onGenerateOutline, onApproveOutline,
  onRegenerateScene, outlineLoading,
  generatingSceneNum, generatingSceneText,
}: Props) {
  const [editing, setEditing] = useState(false);

  // Phase: input
  if (phase === "input") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md">
          <h2 className="text-lg font-semibold text-gray-200 text-center">{"\uC0C8 \uC2A4\uD06C\uB9BD\uD2B8"}</h2>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{"\uC7A5\uB974"}</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
              placeholder={"\uC608: \uB9C9\uC7A5\uB4DC\uB77C\uB9C8"}
              value={genre}
              onChange={(e) => onGenreChange(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{"\uC8FC\uC81C"}</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
              placeholder={"\uC608: \uC7AC\uC0B0\uB2E4\uD234"}
              value={topic}
              onChange={(e) => onTopicChange(e.target.value)}
            />
          </div>
          <button
            onClick={onGenerateOutline}
            disabled={!genre.trim() || !topic.trim() || outlineLoading}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {outlineLoading ? (
              <><span className="animate-spin">{"\u23F3"}</span> {"\uC0DD\uC131 \uC911..."}</>
            ) : (
              <><Play size={14} /> {"\uC544\uC6C3\uB77C\uC778 \uC0DD\uC131"}</>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Phase: outline
  if (phase === "outline") {
    return (
      <div className="flex-1 flex flex-col p-4 space-y-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">{"\uC544\uC6C3\uB77C\uC778"}</h3>
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            {editing ? <><Eye size={12} /> {"\uBBF8\uB9AC\uBCF4\uAE30"}</> : <><Pencil size={12} /> {"\uD3B8\uC9D1"}</>}
          </button>
        </div>
        {editing ? (
          <textarea
            value={outline}
            onChange={(e) => onOutlineChange(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded p-3 text-sm text-gray-200 font-mono resize-none min-h-[300px]"
          />
        ) : (
          <pre className="flex-1 text-sm text-gray-300 whitespace-pre-wrap overflow-y-auto">{outline}</pre>
        )}
        <div className="flex gap-2">
          <button
            onClick={onApproveOutline}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium text-white flex items-center gap-2"
          >
            <Play size={14} /> {"\uC0DD\uC131 \uC2DC\uC791"}
          </button>
          <button
            onClick={onGenerateOutline}
            disabled={outlineLoading}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-200 flex items-center gap-2"
          >
            <RotateCcw size={14} /> {"\uB2E4\uC2DC \uC0DD\uC131"}
          </button>
        </div>
      </div>
    );
  }

  // Phase: generating / review
  const selectedSceneData = selectedScene !== null
    ? scenes.find(s => s.num === selectedScene)
    : null;

  // Full script view
  if (selectedScene === null) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-200">{"\uC804\uCCB4 \uC2A4\uD06C\uB9BD\uD2B8"}</h3>
        {scenes.map((s) => {
          const isCurrentlyGenerating = s.status === "generating" && s.num === generatingSceneNum;
          return (
            <div key={s.num} className="border-b border-gray-700 pb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">{"\uC7A5\uBA74"} {s.num} — {s.description.slice(0, 40)}</span>
                {phase === "review" && s.status !== "pending" && (
                  <button
                    onClick={() => onRegenerateScene(s.num)}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    <RotateCcw size={10} /> {"\uC7AC\uC0DD\uC131"}
                  </button>
                )}
              </div>
              {isCurrentlyGenerating ? (
                <div className="text-sm text-gray-300 whitespace-pre-wrap">
                  {generatingSceneText}<span className="animate-pulse">{"\u258A"}</span>
                </div>
              ) : s.status === "generating" || s.status === "pending" ? (
                <div className="text-sm text-gray-600">{s.status === "generating" ? "\uC0DD\uC131 \uB300\uAE30 \uC911..." : "\uB300\uAE30 \uC911"}</div>
              ) : (
                <textarea
                  value={s.text}
                  onChange={(e) => onSceneTextChange(s.num, e.target.value)}
                  className="w-full bg-transparent border border-transparent hover:border-gray-700 focus:border-gray-600 focus:bg-gray-800/50 rounded p-1 text-sm text-gray-200 whitespace-pre-wrap resize-none min-h-[60px]"
                  readOnly={phase === "generating" && s.status !== "done" && s.status !== "modified"}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Single scene view
  const isCurrentlyGenerating = selectedSceneData?.status === "generating" && selectedSceneData.num === generatingSceneNum;

  return (
    <div className="flex-1 flex flex-col p-4 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">
          {"\uC7A5\uBA74"} {selectedSceneData?.num} — {selectedSceneData?.description.slice(0, 40)}
        </h3>
        {(phase === "review" || (phase === "generating" && selectedSceneData?.status === "done")) && (
          <button
            onClick={() => selectedSceneData && onRegenerateScene(selectedSceneData.num)}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            <RotateCcw size={12} /> {"\uC7AC\uC0DD\uC131"}
          </button>
        )}
      </div>
      {isCurrentlyGenerating ? (
        <div className="flex-1 text-sm text-gray-300 whitespace-pre-wrap bg-gray-800 border border-gray-700 rounded p-3">
          {generatingSceneText}<span className="animate-pulse">{"\u258A"}</span>
        </div>
      ) : selectedSceneData?.status === "pending" ? (
        <div className="text-sm text-gray-600">{"\uB300\uAE30 \uC911"}</div>
      ) : (
        <textarea
          value={selectedSceneData?.text || ""}
          onChange={(e) => selectedSceneData && onSceneTextChange(selectedSceneData.num, e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded p-3 text-sm text-gray-200 resize-none min-h-[300px]"
          readOnly={phase === "generating" && selectedSceneData?.status !== "done" && selectedSceneData?.status !== "modified"}
        />
      )}
    </div>
  );
}
