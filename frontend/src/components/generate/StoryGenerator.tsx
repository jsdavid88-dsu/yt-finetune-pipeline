import { useState, useRef, useEffect } from "react";
import { Play, Square, RotateCcw, Download, ChevronDown, ChevronUp, Pencil } from "lucide-react";

interface GenerateModel {
  name: string;
  size?: string;
}

interface Props {
  addLog: (level: "info" | "warn" | "error" | "success", msg: string) => void;
}

type Phase = "input" | "outline" | "generating" | "done";

export default function StoryGenerator({ addLog }: Props) {
  const [genre, setGenre] = useState("");
  const [topic, setTopic] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<GenerateModel[]>([]);
  const [numScenes, setNumScenes] = useState(12);

  const [phase, setPhase] = useState<Phase>("input");
  const [outline, setOutline] = useState("");
  const [editingOutline, setEditingOutline] = useState(false);
  const [outlineLoading, setOutlineLoading] = useState(false);

  const [scenes, setScenes] = useState<string[]>([]);
  const [currentScene, setCurrentScene] = useState(0);
  const [totalScenes, setTotalScenes] = useState(0);
  const [fullText, setFullText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [regeneratingScene, setRegeneratingScene] = useState<number | null>(null);

  const [expandedScenes, setExpandedScenes] = useState<Set<number>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/generate/models")
      .then((r) => r.json())
      .then((data) => {
        const names = (data.models || []).map((m: any) => ({
          name: m.name || m.model,
          size: m.size,
        }));
        setModels(names);
        if (names.length > 0) setModel(names[0].name);
      })
      .catch(() => {});
  }, []);

  // Phase 1: Generate outline
  const generateOutline = async () => {
    if (!genre.trim() || !topic.trim() || !model) return;
    setOutlineLoading(true);
    setErrors([]);
    try {
      const resp = await fetch("/api/generate/story/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          genre: genre.trim(),
          topic: topic.trim(),
          num_scenes: numScenes,
          temperature: 0.7,
        }),
      });
      const data = await resp.json();
      if (data.outline) {
        setOutline(data.outline);
        setPhase("outline");
        addLog("success", "아웃라인 생성 완료");
      } else {
        addLog("error", "아웃라인 생성 실패");
      }
    } catch (err: any) {
      addLog("error", `아웃라인 생성 오류: ${err.message}`);
    } finally {
      setOutlineLoading(false);
    }
  };

  // Phase 2: Generate scenes from approved outline
  const startSceneGeneration = async () => {
    setPhase("generating");
    setScenes([]);
    setCurrentScene(0);
    setTotalScenes(0);
    setFullText("");
    setErrors([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/generate/story/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          genre: genre.trim(),
          topic: topic.trim(),
          outline,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.step === "scene") {
              setCurrentScene(event.scene_num || 0);
              setTotalScenes(event.total || 0);
              setScenes((prev) => [...prev, event.content || ""]);
              setExpandedScenes((prev) => new Set(prev).add((event.scene_num || 1) - 1));
            } else if (event.step === "error") {
              setErrors((prev) => [...prev, `장면 ${event.scene_num}: ${event.error}`]);
            } else if (event.step === "done") {
              setFullText(event.full_text || "");
              setPhase("done");
              addLog("success", "스크립트 생성 완료");
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setErrors((prev) => [...prev, err.message]);
      }
    } finally {
      if (phase !== "done") setPhase("done");
    }
  };

  // Regenerate single scene
  const handleRegenerateScene = async (sceneIndex: number) => {
    setRegeneratingScene(sceneIndex);
    try {
      const resp = await fetch("/api/generate/story/regenerate-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          genre: genre.trim(),
          topic: topic.trim(),
          outline,
          scene_num: sceneIndex + 1,
          scene_description: "",  // Will be parsed from outline server-side
          prev_scenes: scenes.slice(0, sceneIndex),
          temperature: 0.8,
        }),
      });
      const data = await resp.json();
      if (data.scene_text) {
        setScenes((prev) => {
          const updated = [...prev];
          updated[sceneIndex] = data.scene_text;
          return updated;
        });
        // Update full text
        setFullText(scenes.map((s, i) => i === sceneIndex ? data.scene_text : s).join("\n\n---\n\n"));
        addLog("success", `장면 ${sceneIndex + 1} 재생성 완료`);
      }
    } catch (err: any) {
      addLog("error", `재생성 오류: ${err.message}`);
    } finally {
      setRegeneratingScene(null);
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setPhase("done");
  };

  const reset = () => {
    setPhase("input");
    setOutline("");
    setScenes([]);
    setFullText("");
    setErrors([]);
    setCurrentScene(0);
    setTotalScenes(0);
    setExpandedScenes(new Set());
  };

  const exportText = () => {
    const text = fullText || scenes.join("\n\n---\n\n");
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${genre}_${topic}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleScene = (i: number) => {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">전체 스크립트 생성</h3>
        {phase !== "input" && (
          <button onClick={reset} className="btn-secondary text-sm flex items-center gap-1">
            <RotateCcw size={14} /> 처음부터
          </button>
        )}
      </div>

      {/* Phase: Input */}
      {phase === "input" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">장르</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
                placeholder="예: 막장드라마"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">주제</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
                placeholder="예: 재산다툼"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">모델</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">장면 수</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
                value={numScenes}
                onChange={(e) => setNumScenes(Number(e.target.value))}
                min={4}
                max={20}
              />
            </div>
          </div>
          <button
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium text-white disabled:opacity-50 flex items-center gap-2"
            onClick={generateOutline}
            disabled={!genre.trim() || !topic.trim() || !model || outlineLoading}
          >
            {outlineLoading ? (
              <>
                <span className="animate-spin">⏳</span> 아웃라인 생성 중...
              </>
            ) : (
              <>
                <Play size={14} /> 1단계: 아웃라인 생성
              </>
            )}
          </button>
        </div>
      )}

      {/* Phase: Outline review */}
      {phase === "outline" && (
        <div className="space-y-3">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-200">아웃라인 검토</h4>
              <button
                onClick={() => setEditingOutline(!editingOutline)}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Pencil size={12} /> {editingOutline ? "미리보기" : "편집"}
              </button>
            </div>
            {editingOutline ? (
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-sm text-gray-200 font-mono min-h-[300px]"
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
              />
            ) : (
              <pre className="text-sm text-gray-300 whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                {outline}
              </pre>
            )}
          </div>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium text-white flex items-center gap-2"
              onClick={startSceneGeneration}
            >
              <Play size={14} /> 2단계: 이 아웃라인으로 생성 시작
            </button>
            <button
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-200 flex items-center gap-2"
              onClick={generateOutline}
              disabled={outlineLoading}
            >
              <RotateCcw size={14} /> 아웃라인 다시 생성
            </button>
          </div>
        </div>
      )}

      {/* Phase: Generating / Done */}
      {(phase === "generating" || phase === "done") && (
        <div className="space-y-3">
          {/* Progress bar */}
          {phase === "generating" && totalScenes > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm text-gray-400">
                <span>장면 {currentScene}/{totalScenes} 생성 중...</span>
                <button
                  onClick={stopGeneration}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs text-white flex items-center gap-1"
                >
                  <Square size={12} /> 중지
                </button>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className="bg-blue-500 rounded-full h-2 transition-all duration-300"
                  style={{ width: `${(currentScene / totalScenes) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Outline (collapsed) */}
          {outline && (
            <details className="bg-gray-800 rounded-lg border border-gray-700">
              <summary className="px-4 py-2 text-sm font-medium text-gray-300 cursor-pointer">
                아웃라인
              </summary>
              <pre className="px-4 pb-3 text-xs text-gray-400 whitespace-pre-wrap">
                {outline}
              </pre>
            </details>
          )}

          {/* Scenes */}
          {scenes.length > 0 && (
            <div className="space-y-2">
              {scenes.map((s, i) => (
                <div key={i} className="bg-gray-800 rounded-lg border border-gray-700">
                  <div
                    className="flex items-center justify-between px-4 py-2 cursor-pointer"
                    onClick={() => toggleScene(i)}
                  >
                    <span className="text-sm font-medium text-gray-200">
                      장면 {i + 1}{totalScenes > 0 ? `/${totalScenes}` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      {phase === "done" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRegenerateScene(i);
                          }}
                          disabled={regeneratingScene === i}
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 disabled:opacity-50"
                        >
                          <RotateCcw size={12} className={regeneratingScene === i ? "animate-spin" : ""} />
                          {regeneratingScene === i ? "재생성 중..." : "다시 쓰기"}
                        </button>
                      )}
                      {expandedScenes.has(i) ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                    </div>
                  </div>
                  {expandedScenes.has(i) && (
                    <div className="px-4 pb-3 border-t border-gray-700">
                      <div className="text-sm text-gray-200 whitespace-pre-wrap pt-2">{s}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div className="text-sm text-red-400 space-y-1">
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {/* Done actions */}
          {phase === "done" && scenes.length > 0 && (
            <div className="flex gap-2">
              <button
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-200 flex items-center gap-2"
                onClick={exportText}
              >
                <Download size={14} /> 전체 내보내기 (.txt)
              </button>
              <span className="text-sm text-gray-500 self-center">
                {(fullText || scenes.join("")).length.toLocaleString()}자
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
