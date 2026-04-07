import { useState, useRef, useEffect, useCallback } from "react";
import StoryStructurePanel from "./StoryStructurePanel";
import StoryContentPanel from "./StoryContentPanel";
import StoryChatPanel from "./StoryChatPanel";

// ── Types ────────────────────────────────────────────────

interface SceneData {
  num: number;
  description: string;
  text: string;
  status: "pending" | "generating" | "done" | "modified";
}

interface ChatSuggestion {
  text: string;
  target: "outline" | "scene";
  scene_num: number | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestion?: ChatSuggestion;
}

type Phase = "input" | "outline" | "generating" | "review";

interface StoryState {
  phase: Phase;
  genre: string;
  topic: string;
  model: string;
  numScenes: number;
  outline: string;
  scenes: SceneData[];
  selectedScene: number | null;
  chatMessages: ChatMessage[];
}

interface Props {
  addLog: (level: "info" | "warn" | "error" | "success", msg: string) => void;
}

// ── Helpers ──────────────────────────────────────────────

function parseOutline(text: string): { num: number; description: string }[] {
  const scenes: { num: number; description: string }[] = [];

  // Pattern 1: "장면 N/T (position): description"
  const p1 = /장면\s*(\d+)\s*[\/of]\s*(\d+)\s*\([^)]*\)\s*[:：]\s*(.+)/g;
  let m;
  while ((m = p1.exec(text)) !== null) {
    scenes.push({ num: parseInt(m[1]), description: m[3].trim().slice(0, 80) });
  }
  if (scenes.length > 0) return scenes;

  // Pattern 2: "장면 N: description" or "N. description"
  const p2 = /(?:장면\s*)?(\d+)\s*[.:：]\s*(.+)/g;
  while ((m = p2.exec(text)) !== null) {
    const num = parseInt(m[1]);
    const desc = m[2].trim();
    // Filter out lines that are clearly not scene descriptions
    if (num > 0 && num <= 30 && desc.length > 5 && !desc.startsWith("감정") && !desc.startsWith("떡밥")) {
      scenes.push({ num, description: desc.slice(0, 80) });
    }
  }
  if (scenes.length > 0) return scenes;

  // Pattern 3: Lines starting with "-" or "•" (bullet points)
  const lines = text.split("\n");
  let sceneNum = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^[-•*]\s+/) && trimmed.length > 10) {
      sceneNum++;
      scenes.push({ num: sceneNum, description: trimmed.replace(/^[-•*]\s+/, "").slice(0, 80) });
    }
  }

  return scenes;
}

const initialState: StoryState = {
  phase: "input",
  genre: "",
  topic: "",
  model: "",
  numScenes: 12,
  outline: "",
  scenes: [],
  selectedScene: null,
  chatMessages: [],
};

// ── Component ────────────────────────────────────────────

export default function StoryEditor({ addLog }: Props) {
  const [state, setState] = useState<StoryState>(initialState);
  const [models, setModels] = useState<string[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatStreamContent, setChatStreamContent] = useState("");
  const [generatingSceneNum, setGeneratingSceneNum] = useState<number | null>(null);
  const [generatingSceneText, setGeneratingSceneText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Fetch models on mount
  useEffect(() => {
    fetch("/api/generate/models")
      .then((r) => r.json())
      .then((data) => {
        const raw = Array.isArray(data?.models) ? data.models : [];
        const names = raw.map((m: any) => m.name || m.model || '') .filter(Boolean) as string[];
        setModels(names);
        if (names.length > 0) {
          setState((s) => ({ ...s, model: s.model || names[0] }));
        }
      })
      .catch(() => {});
  }, []);

  // ── State updaters ──

  const update = useCallback((patch: Partial<StoryState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const updateScene = useCallback((num: number, patch: Partial<SceneData>) => {
    setState((s) => ({
      ...s,
      scenes: s.scenes.map((sc) => (sc.num === num ? { ...sc, ...patch } : sc)),
    }));
  }, []);

  // ── API: Generate outline ──

  const generateOutline = useCallback(async () => {
    if (!state.genre.trim() || !state.topic.trim() || !state.model) return;
    setOutlineLoading(true);
    try {
      const resp = await fetch("/api/generate/story/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: state.model,
          genre: state.genre.trim(),
          topic: state.topic.trim(),
          num_scenes: state.numScenes,
          temperature: 0.7,
          max_tokens: 4096,
        }),
      });
      const data = await resp.json();
      if (data.outline) {
        update({ outline: data.outline, phase: "outline" });
        addLog("success", "\uC544\uC6C3\uB77C\uC778 \uC0DD\uC131 \uC644\uB8CC");
      } else {
        addLog("error", "\uC544\uC6C3\uB77C\uC778 \uC0DD\uC131 \uC2E4\uD328");
      }
    } catch (err: any) {
      addLog("error", `\uC544\uC6C3\uB77C\uC778 \uC0DD\uC131 \uC624\uB958: ${err.message}`);
    } finally {
      setOutlineLoading(false);
    }
  }, [state.genre, state.topic, state.model, state.numScenes, update, addLog]);

  // ── API: Approve outline + start scene generation ──

  const approveOutline = useCallback(async () => {
    const parsed = parseOutline(state.outline);
    if (parsed.length === 0) {
      addLog("error", "\uC544\uC6C3\uB77C\uC778\uC744 \uD30C\uC2F1\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4");
      return;
    }

    const newScenes: SceneData[] = parsed.map((p) => ({
      num: p.num,
      description: p.description,
      text: "",
      status: "pending" as const,
    }));

    update({ phase: "generating", scenes: newScenes, selectedScene: null });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/generate/story/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: state.model,
          genre: state.genre.trim(),
          topic: state.topic.trim(),
          outline: state.outline,
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
              const sceneNum = event.scene_num || 0;
              // Mark completed
              setGeneratingSceneNum(null);
              setGeneratingSceneText("");
              setState((s) => ({
                ...s,
                scenes: s.scenes.map((sc) =>
                  sc.num === sceneNum
                    ? { ...sc, text: event.content || "", status: "done" as const }
                    : sc
                ),
              }));
              // Mark next scene as generating
              const nextNum = sceneNum + 1;
              setState((s) => ({
                ...s,
                scenes: s.scenes.map((sc) =>
                  sc.num === nextNum && sc.status === "pending"
                    ? { ...sc, status: "generating" as const }
                    : sc
                ),
              }));
              if (nextNum <= parsed.length) {
                setGeneratingSceneNum(nextNum);
                setGeneratingSceneText("");
              }
            } else if (event.step === "token" && event.scene_num) {
              setGeneratingSceneNum(event.scene_num);
              setGeneratingSceneText((prev) => prev + (event.content || ""));
            } else if (event.step === "scene_start" && event.scene_num) {
              const sn = event.scene_num;
              setGeneratingSceneNum(sn);
              setGeneratingSceneText("");
              setState((s) => ({
                ...s,
                scenes: s.scenes.map((sc) =>
                  sc.num === sn ? { ...sc, status: "generating" as const } : sc
                ),
              }));
            } else if (event.step === "error") {
              const errNum = event.scene_num;
              if (errNum) {
                setState((s) => ({
                  ...s,
                  scenes: s.scenes.map((sc) =>
                    sc.num === errNum ? { ...sc, status: "pending" as const } : sc
                  ),
                }));
              }
              addLog("error", `\uC7A5\uBA74 ${errNum}: ${event.error}`);
            } else if (event.step === "done") {
              setGeneratingSceneNum(null);
              setGeneratingSceneText("");
              update({ phase: "review" });
              addLog("success", "\uC2A4\uD06C\uB9BD\uD2B8 \uC0DD\uC131 \uC644\uB8CC");
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        addLog("error", `\uC0DD\uC131 \uC624\uB958: ${err.message}`);
      }
    } finally {
      // If generation ended without a "done" event, go to review anyway
      setState((s) => {
        if (s.phase === "generating") {
          const allDone = s.scenes.every((sc) => sc.status === "done" || sc.status === "modified");
          if (allDone) {
            return { ...s, phase: "review" };
          }
        }
        return s;
      });
      setGeneratingSceneNum(null);
      setGeneratingSceneText("");
    }
  }, [state.model, state.genre, state.topic, state.outline, update, addLog]);

  // ── API: Regenerate single scene ──

  const regenerateScene = useCallback(async (sceneNum: number) => {
    updateScene(sceneNum, { status: "generating" });
    setGeneratingSceneNum(sceneNum);
    setGeneratingSceneText("");

    try {
      const sceneData = state.scenes.find((s) => s.num === sceneNum);
      const prevScenes = state.scenes
        .filter((s) => s.num < sceneNum && (s.status === "done" || s.status === "modified"))
        .map((s) => s.text);

      const resp = await fetch("/api/generate/story/regenerate-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: state.model,
          genre: state.genre.trim(),
          topic: state.topic.trim(),
          outline: state.outline,
          scene_num: sceneNum,
          scene_description: sceneData?.description || "",
          prev_scenes: prevScenes,
          temperature: 0.8,
        }),
      });
      const data = await resp.json();
      if (data.scene_text) {
        updateScene(sceneNum, { text: data.scene_text, status: "done" });
        addLog("success", `\uC7A5\uBA74 ${sceneNum} \uC7AC\uC0DD\uC131 \uC644\uB8CC`);
      } else {
        updateScene(sceneNum, { status: "done" });
        addLog("error", `\uC7A5\uBA74 ${sceneNum} \uC7AC\uC0DD\uC131 \uC2E4\uD328`);
      }
    } catch (err: any) {
      updateScene(sceneNum, { status: "done" });
      addLog("error", `\uC7AC\uC0DD\uC131 \uC624\uB958: ${err.message}`);
    } finally {
      setGeneratingSceneNum(null);
      setGeneratingSceneText("");
    }
  }, [state.scenes, state.model, state.genre, state.topic, state.outline, updateScene, addLog]);

  // ── API: Chat ──

  const sendChatMessage = useCallback(async (message: string) => {
    const userMsg: ChatMessage = { role: "user", content: message };
    setState((s) => ({ ...s, chatMessages: [...s.chatMessages, userMsg] }));

    setChatStreaming(true);
    setChatStreamContent("");

    // Build history (exclude suggestions for API)
    const history = state.chatMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Build context
    const selectedSceneData = state.selectedScene !== null
      ? state.scenes.find((s) => s.num === state.selectedScene)
      : null;

    const context = {
      phase: state.phase === "input" ? "outline" : state.phase,
      outline: state.outline,
      selected_scene: state.selectedScene,
      selected_text: selectedSceneData?.text || null,
      genre: state.genre,
      topic: state.topic,
    };

    let fullContent = "";
    let suggestion: ChatSuggestion | undefined;

    try {
      const resp = await fetch("/api/generate/story/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: state.model,
          message,
          history,
          context,
          temperature: 0.7,
        }),
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
            if (event.type === "token") {
              fullContent += event.content;
              setChatStreamContent(fullContent);
            } else if (event.type === "done") {
              fullContent = event.full_content || fullContent;
            } else if (event.type === "suggestion") {
              suggestion = {
                text: event.text,
                target: event.target,
                scene_num: event.scene_num ?? null,
              };
            } else if (event.type === "error") {
              addLog("error", `\uCC44\uD305 \uC624\uB958: ${event.error}`);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err: any) {
      addLog("error", `\uCC44\uD305 \uC624\uB958: ${err.message}`);
    }

    // Remove suggestion block from displayed content
    let displayContent = fullContent;
    displayContent = displayContent.replace(/```suggestion\s*\n[\s\S]*?```/g, "").trim();

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: displayContent,
      suggestion,
    };

    setState((s) => ({ ...s, chatMessages: [...s.chatMessages, assistantMsg] }));
    setChatStreaming(false);
    setChatStreamContent("");
  }, [state, addLog]);

  // ── Apply suggestion ──

  const applySuggestion = useCallback((suggestion: ChatSuggestion) => {
    if (suggestion.target === "outline") {
      update({ outline: suggestion.text });
      addLog("success", "\uC544\uC6C3\uB77C\uC778 \uC218\uC815 \uC801\uC6A9\uB428");
    } else if (suggestion.target === "scene" && suggestion.scene_num !== null) {
      updateScene(suggestion.scene_num, { text: suggestion.text, status: "modified" });
      addLog("success", `\uC7A5\uBA74 ${suggestion.scene_num} \uC218\uC815 \uC801\uC6A9\uB428`);
    }
  }, [update, updateScene, addLog]);

  // ── Scene text change ──

  const handleSceneTextChange = useCallback((num: number, text: string) => {
    updateScene(num, { text, status: "modified" });
  }, [updateScene]);

  // ── Reset / Back ──

  const resetAll = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setState({ ...initialState, model: state.model });
    setGeneratingSceneNum(null);
    setGeneratingSceneText("");
    setChatStreaming(false);
    setChatStreamContent("");
  }, [state.model]);

  const backToOutline = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setGeneratingSceneNum(null);
    setGeneratingSceneText("");
    update({ phase: "outline" });
  }, [update]);

  const resumeToReview = useCallback(() => {
    update({ phase: "review" });
  }, [update]);

  // ── Export ──

  const exportScript = useCallback(() => {
    const text = state.scenes
      .filter((s) => s.text)
      .map((s) => s.text)
      .join("\n\n---\n\n");
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.genre}_${state.topic}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("success", "\uC2A4\uD06C\uB9BD\uD2B8 \uB0B4\uBCF4\uB0B4\uAE30 \uC644\uB8CC");
  }, [state.scenes, state.genre, state.topic, addLog]);

  // ── Render ──

  return (
    <div className="flex h-full">
      <StoryStructurePanel
        phase={state.phase}
        scenes={state.scenes}
        selectedScene={state.selectedScene}
        onSelectScene={(num) => update({ selectedScene: num })}
        onExport={exportScript}
        onReset={resetAll}
        onBackToOutline={backToOutline}
        model={state.model}
        models={models}
        onModelChange={(m) => update({ model: m })}
        numScenes={state.numScenes}
        onNumScenesChange={(n) => update({ numScenes: n })}
      />
      <StoryContentPanel
        phase={state.phase}
        genre={state.genre}
        topic={state.topic}
        onGenreChange={(g) => update({ genre: g })}
        onTopicChange={(t) => update({ topic: t })}
        outline={state.outline}
        onOutlineChange={(o) => update({ outline: o })}
        scenes={state.scenes}
        selectedScene={state.selectedScene}
        onSceneTextChange={handleSceneTextChange}
        onGenerateOutline={generateOutline}
        onApproveOutline={approveOutline}
        onResumeToReview={resumeToReview}
        onRegenerateScene={regenerateScene}
        outlineLoading={outlineLoading}
        generatingSceneNum={generatingSceneNum}
        generatingSceneText={generatingSceneText}
        addLog={addLog}
      />
      <StoryChatPanel
        phase={state.phase}
        messages={state.chatMessages}
        onSendMessage={sendChatMessage}
        onApplySuggestion={applySuggestion}
        streaming={chatStreaming}
        streamContent={chatStreamContent}
      />
    </div>
  );
}
