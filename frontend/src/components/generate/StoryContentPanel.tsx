import { useState } from "react";
import { Play, Pencil, Eye, RotateCcw, ArrowRight } from "lucide-react";

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
  onResumeToReview: () => void;
  onRegenerateScene: (num: number) => void;
  outlineLoading: boolean;
  generatingSceneNum: number | null;
  generatingSceneText: string;
  addLog: (level: "info" | "warn" | "error" | "success", msg: string) => void;
}

export default function StoryContentPanel({
  phase, genre, topic, onGenreChange, onTopicChange,
  outline, onOutlineChange, scenes, selectedScene,
  onSceneTextChange, onGenerateOutline, onApproveOutline,
  onResumeToReview, onRegenerateScene, outlineLoading,
  generatingSceneNum, generatingSceneText, addLog,
}: Props) {
  const [editing, setEditing] = useState(false);

  const hasExistingScenes = scenes.some(s => s.status === "done" || s.status === "modified");

  // Phase: input
  if (phase === "input") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md">
          <h2 className="text-lg font-semibold text-gray-200 text-center">새 스크립트</h2>
          <div>
            <label className="block text-sm text-gray-400 mb-1">장르</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
              placeholder="예: 막장드라마"
              value={genre}
              onChange={(e) => onGenreChange(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">주제</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
              placeholder="예: 재산다툼"
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
              <><span className="animate-spin">{"\u23F3"}</span> 생성 중...</>
            ) : (
              <><Play size={14} /> 아웃라인 생성</>
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
          <h3 className="text-sm font-semibold text-gray-200">아웃라인</h3>
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            {editing ? <><Eye size={12} /> 미리보기</> : <><Pencil size={12} /> 편집</>}
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
        <div className="flex gap-2 flex-wrap">
          {hasExistingScenes ? (
            <>
              <button
                onClick={onResumeToReview}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium text-white flex items-center gap-2"
              >
                <ArrowRight size={14} /> 기존 장면으로 돌아가기
              </button>
              <button
                onClick={onApproveOutline}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm font-medium text-white flex items-center gap-2"
              >
                <Play size={14} /> 전체 새로 생성
              </button>
            </>
          ) : (
            <button
              onClick={onApproveOutline}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium text-white flex items-center gap-2"
            >
              <Play size={14} /> 장면 생성 시작
            </button>
          )}
          <button
            onClick={onGenerateOutline}
            disabled={outlineLoading}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-200 flex items-center gap-2"
          >
            <RotateCcw size={14} /> 아웃라인 다시 생성
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
        <h3 className="text-sm font-semibold text-gray-200">전체 스크립트</h3>
        {scenes.map((s) => (
          <div key={s.num} className="border-b border-gray-700 pb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">장면 {s.num} — {s.description.slice(0, 40)}</span>
              {(phase === "review" || s.status === "done" || s.status === "modified") && (
                <button
                  onClick={() => onRegenerateScene(s.num)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <RotateCcw size={10} /> 재생성
                </button>
              )}
            </div>
            {s.num === generatingSceneNum ? (
              <div className="text-sm text-gray-300 whitespace-pre-wrap animate-pulse">
                {generatingSceneText || "생성 중..."}
              </div>
            ) : s.status === "pending" ? (
              <div className="text-sm text-gray-600">대기 중</div>
            ) : (
              <div
                contentEditable={phase === "review"}
                suppressContentEditableWarning
                onBlur={(e) => {
                  const newText = e.currentTarget.textContent || "";
                  if (newText !== s.text) onSceneTextChange(s.num, newText);
                }}
                className="text-sm text-gray-200 whitespace-pre-wrap outline-none focus:bg-gray-800/50 rounded p-1 -m-1"
              >
                {s.text}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Single scene view
  return (
    <div className="flex-1 flex flex-col p-4 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">
          장면 {selectedSceneData?.num} — {selectedSceneData?.description?.slice(0, 40)}
        </h3>
        {(phase === "review" || selectedSceneData?.status === "done" || selectedSceneData?.status === "modified") && (
          <button
            onClick={() => selectedSceneData && onRegenerateScene(selectedSceneData.num)}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            <RotateCcw size={12} /> 재생성
          </button>
        )}
      </div>
      {selectedSceneData?.num === generatingSceneNum ? (
        <div className="flex-1 text-sm text-gray-300 whitespace-pre-wrap animate-pulse p-3 bg-gray-800 rounded">
          {generatingSceneText || "생성 중..."}
        </div>
      ) : selectedSceneData?.status === "pending" ? (
        <div className="text-sm text-gray-600">대기 중</div>
      ) : (
        <textarea
          value={selectedSceneData?.text || ""}
          onChange={(e) => selectedSceneData && onSceneTextChange(selectedSceneData.num, e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded p-3 text-sm text-gray-200 resize-none min-h-[300px]"
        />
      )}
    </div>
  );
}
