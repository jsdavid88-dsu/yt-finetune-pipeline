# 3패널 스크립트 에디터 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 생성 탭의 스크립트 모드를 3패널 에디터(구조/에디터/채팅)로 교체하여 대화형 수정 + 직접 편집을 지원

**Architecture:** 기존 StoryGenerator를 3패널 StoryEditor로 교체. 백엔드에 맥락 인식 채팅 API 추가. 프론트는 StoryState로 phase/scenes/chat을 관리하고, 채팅의 suggestion을 에디터에 적용하는 구조.

**Tech Stack:** FastAPI, Ollama API (httpx), React 18, TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-06-story-editor-design.md`

---

## Chunk 1: 백엔드 — 채팅 API

### Task 1: StoryChatContext, StoryChatRequest 스키마

**Files:**
- Modify: `backend/models/schemas.py`

- [ ] **Step 1: 스키마 추가**

`schemas.py`의 `StoryGenerateRequest` 아래에 추가:

```python
class StoryChatContext(BaseModel):
    phase: str                             # "outline" | "generating" | "review"
    outline: str = ""
    selected_scene: Optional[int] = None   # 선택된 장면 번호
    selected_text: Optional[str] = None    # 선택된 장면 텍스트
    genre: str = ""
    topic: str = ""


class StoryChatRequest(BaseModel):
    model: str
    message: str
    history: list[dict[str, str]] = []     # [{"role": "user", "content": "..."}, ...]
    context: StoryChatContext
    temperature: float = 0.7
```

- [ ] **Step 2: Commit**

```bash
git add backend/models/schemas.py
git commit -m "feat: StoryChatContext, StoryChatRequest 스키마 추가"
```

---

### Task 2: story_service.py — chat_with_context

**Files:**
- Modify: `backend/services/story_service.py`

- [ ] **Step 1: chat_with_context 함수 추가**

`story_service.py` 끝에 추가:

```python
# ---------------------------------------------------------------------------
# Context-aware chat for story editing
# ---------------------------------------------------------------------------

_CHAT_SYSTEM_TEMPLATE = """당신은 {genre} 장르의 스토리 전문가입니다.
사용자가 스크립트를 작성/수정하고 있습니다.

현재 상태: {phase_desc}

{context_block}

사용자의 요청에 따라 도움을 주세요.
수정이 필요한 경우, 수정된 텍스트를 아래 형식으로 출력하세요:

```suggestion
(수정된 전체 텍스트)
```

수정이 불필요한 일반 대화는 그냥 답변하면 됩니다."""


def _build_system_prompt(context: dict) -> str:
    phase = context.get("phase", "outline")
    genre = context.get("genre", "")
    topic = context.get("topic", "")

    if phase == "outline":
        phase_desc = "아웃라인을 작성/수정 중"
        context_block = f"현재 아웃라인:\n{context.get('outline', '(없음)')}"
    else:
        phase_desc = "장면을 작성/수정 중" if phase == "generating" else "전체 스크립트를 검수 중"
        scene_num = context.get("selected_scene")
        scene_text = context.get("selected_text", "")
        outline = context.get("outline", "")
        context_block = f"전체 아웃라인:\n{outline}\n\n"
        if scene_num is not None and scene_text:
            context_block += f"현재 선택된 장면 ({scene_num}번):\n{scene_text}"
        else:
            context_block += "(전체 보기 모드)"

    return _CHAT_SYSTEM_TEMPLATE.format(
        genre=genre or "일반",
        phase_desc=phase_desc,
        context_block=context_block,
    )


def _parse_suggestion(full_text: str, context: dict) -> dict | None:
    """Parse ```suggestion blocks from model response."""
    pattern = re.compile(r"```suggestion\s*\n(.*?)```", re.DOTALL)
    m = pattern.search(full_text)
    if not m:
        return None

    suggestion_text = m.group(1).strip()
    phase = context.get("phase", "outline")

    if phase == "outline":
        return {"text": suggestion_text, "target": "outline", "scene_num": None}
    else:
        scene_num = context.get("selected_scene")
        return {"text": suggestion_text, "target": "scene", "scene_num": scene_num}


async def chat_with_context(
    model: str,
    message: str,
    history: list[dict[str, str]],
    context: dict,
    temperature: float = 0.7,
) -> AsyncIterator[dict]:
    """Context-aware chat for story editing. Yields SSE events.

    Events:
      {"type": "token", "content": "..."}
      {"type": "done", "full_content": "..."}
      {"type": "suggestion", "text": "...", "target": "...", "scene_num": N}
    """
    system = _build_system_prompt(context)

    # Build messages for Ollama chat API
    messages = [{"role": "system", "content": system}]
    messages.extend(history)
    messages.append({"role": "user", "content": message})

    # Stream response
    full_content = ""
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {"temperature": temperature, "num_predict": 4096},
    }

    try:
        async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
            async with client.stream("POST", "/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        full_content += token
                        yield {"type": "token", "content": token}
                    if chunk.get("done"):
                        break
    except Exception as exc:
        yield {"type": "error", "error": str(exc)}
        return

    yield {"type": "done", "full_content": full_content}

    # Parse suggestion
    suggestion = _parse_suggestion(full_content, context)
    if suggestion:
        yield {"type": "suggestion", **suggestion}
```

Note: `OLLAMA_BASE` and `TIMEOUT` are already imported at the top of story_service.py. Add missing imports:

```python
import json
# httpx is already imported via ollama_generate dependency — add direct import
import httpx

OLLAMA_BASE = "http://localhost:11434"
TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/story_service.py
git commit -m "feat: chat_with_context — 맥락 인식 스토리 채팅"
```

---

### Task 3: /story/chat 엔드포인트

**Files:**
- Modify: `backend/routers/generate.py`

- [ ] **Step 1: import 추가**

```python
from models.schemas import StoryChatRequest
from services.story_service import chat_with_context
```

- [ ] **Step 2: 엔드포인트 추가**

`story_regenerate_scene` 아래에 추가:

```python
@router.post("/story/chat")
async def story_chat(req: StoryChatRequest):
    """Context-aware chat for story editing. SSE streaming."""
    async def event_generator():
        try:
            async for event in chat_with_context(
                model=req.model,
                message=req.message,
                history=req.history,
                context=req.context.model_dump(),
                temperature=req.temperature,
            ):
                data = json.dumps(event, ensure_ascii=False)
                yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            error_data = json.dumps({"type": "error", "error": str(exc)})
            yield f"data: {error_data}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/generate.py
git commit -m "feat: /story/chat — 맥락 인식 채팅 SSE 엔드포인트"
```

---

## Chunk 2: 프론트엔드 — 3패널 에디터

### Task 4: StoryStructurePanel (패널 1)

**Files:**
- Create: `frontend/src/components/generate/StoryStructurePanel.tsx`

- [ ] **Step 1: 구조 패널 컴포넌트 작성**

Phase 표시, 장면 목록 (상태 아이콘), 전체보기/내보내기 버튼, 모델 선택.

```tsx
import { Download, Eye, Play, Settings } from "lucide-react";

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
  model: string;
  models: string[];
  onModelChange: (m: string) => void;
  numScenes: number;
  onNumScenesChange: (n: number) => void;
}

const STATUS_ICON: Record<string, string> = {
  pending: "⬜",
  generating: "🔄",
  done: "✅",
  modified: "⚠️",
};

const PHASE_LABELS = [
  { key: "input", label: "입력" },
  { key: "outline", label: "아웃라인" },
  { key: "generating", label: "생성" },
  { key: "review", label: "검수" },
];

export default function StoryStructurePanel({
  phase, scenes, selectedScene, onSelectScene,
  onExport, model, models, onModelChange,
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
                {isPast ? "✓" : isCurrent ? "●" : "○"} {p.label}
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
          {models.map(m => <option key={m} value={m}>{m}</option>)}
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

      {/* Actions */}
      <div className="p-3 border-t border-gray-700">
        {phase === "review" && (
          <button onClick={onExport} className="w-full btn-secondary text-xs flex items-center justify-center gap-1">
            <Download size={12} /> 내보내기
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/generate/StoryStructurePanel.tsx
git commit -m "feat: StoryStructurePanel — 구조 패널 (Phase/장면목록/설정)"
```

---

### Task 5: StoryChatPanel (패널 3)

**Files:**
- Create: `frontend/src/components/generate/StoryChatPanel.tsx`

- [ ] **Step 1: 채팅 패널 컴포넌트 작성**

채팅 메시지 표시, suggestion "적용" 버튼, 입력창. SSE 스트리밍 처리.

```tsx
import { useState, useRef, useEffect } from "react";
import { Send, Check } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestion?: {
    text: string;
    target: "outline" | "scene";
    scene_num: number | null;
  };
}

interface Props {
  phase: "input" | "outline" | "generating" | "review";
  messages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  onApplySuggestion: (suggestion: ChatMessage["suggestion"]) => void;
  streaming: boolean;
  streamContent: string;
}

export default function StoryChatPanel({
  phase, messages, onSendMessage, onApplySuggestion,
  streaming, streamContent,
}: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const disabled = phase === "input";

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-700 w-[350px] min-w-[350px]">
      <div className="p-3 border-b border-gray-700">
        <div className="text-sm font-medium text-gray-300">채팅</div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {disabled && (
          <div className="text-xs text-gray-600 text-center mt-8">
            아웃라인을 먼저 생성하세요
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`text-sm ${msg.role === "user" ? "text-blue-300" : "text-gray-300"}`}>
            <div className="text-xs text-gray-500 mb-0.5">
              {msg.role === "user" ? "나" : "AI"}
            </div>
            <div className="whitespace-pre-wrap">{msg.content}</div>
            {msg.suggestion && (
              <button
                onClick={() => onApplySuggestion(msg.suggestion!)}
                className="mt-1 px-2 py-1 bg-green-600/20 text-green-400 rounded text-xs flex items-center gap-1 hover:bg-green-600/30"
              >
                <Check size={12} /> 적용
              </button>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        {streaming && (
          <div className="text-sm text-gray-300">
            <div className="text-xs text-gray-500 mb-0.5">AI</div>
            <div className="whitespace-pre-wrap">{streamContent}<span className="animate-pulse">▊</span></div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={disabled ? "" : "수정 요청..."}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            disabled={disabled || streaming}
          />
          <button
            type="submit"
            disabled={disabled || streaming || !input.trim()}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/generate/StoryChatPanel.tsx
git commit -m "feat: StoryChatPanel — 채팅 패널 (suggestion 적용 포함)"
```

---

### Task 6: StoryContentPanel (패널 2)

**Files:**
- Create: `frontend/src/components/generate/StoryContentPanel.tsx`

- [ ] **Step 1: 콘텐츠 패널 컴포넌트 작성**

Phase별 뷰: InputForm / OutlineEditor / SceneEditor / FullScriptView

```tsx
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
  addLog: (level: "info" | "warn" | "error" | "success", msg: string) => void;
}

export default function StoryContentPanel({
  phase, genre, topic, onGenreChange, onTopicChange,
  outline, onOutlineChange, scenes, selectedScene,
  onSceneTextChange, onGenerateOutline, onApproveOutline,
  onRegenerateScene, outlineLoading, addLog,
}: Props) {
  const [editing, setEditing] = useState(false);

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
              <><span className="animate-spin">⏳</span> 생성 중...</>
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
        <div className="flex gap-2">
          <button
            onClick={onApproveOutline}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium text-white flex items-center gap-2"
          >
            <Play size={14} /> 생성 시작
          </button>
          <button
            onClick={onGenerateOutline}
            disabled={outlineLoading}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-200 flex items-center gap-2"
          >
            <RotateCcw size={14} /> 다시 생성
          </button>
        </div>
      </div>
    );
  }

  // Phase: generating / review — selected scene or full view
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
              {phase === "review" && s.status !== "pending" && (
                <button
                  onClick={() => onRegenerateScene(s.num)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <RotateCcw size={10} /> 재생성
                </button>
              )}
            </div>
            {s.status === "generating" ? (
              <div className="text-sm text-gray-400 animate-pulse">생성 중...</div>
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
          장면 {selectedSceneData?.num} — {selectedSceneData?.description.slice(0, 40)}
        </h3>
        {(phase === "review" || (phase === "generating" && selectedSceneData?.status === "done")) && (
          <button
            onClick={() => selectedSceneData && onRegenerateScene(selectedSceneData.num)}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            <RotateCcw size={12} /> 재생성
          </button>
        )}
      </div>
      {selectedSceneData?.status === "generating" ? (
        <div className="text-sm text-gray-400 animate-pulse">생성 중...</div>
      ) : selectedSceneData?.status === "pending" ? (
        <div className="text-sm text-gray-600">대기 중</div>
      ) : (
        <textarea
          value={selectedSceneData?.text || ""}
          onChange={(e) => selectedSceneData && onSceneTextChange(selectedSceneData.num, e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded p-3 text-sm text-gray-200 resize-none min-h-[300px]"
          readOnly={phase === "generating" && selectedSceneData?.status !== "done"}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/generate/StoryContentPanel.tsx
git commit -m "feat: StoryContentPanel — 에디터 패널 (입력/아웃라인/장면/전체보기)"
```

---

### Task 7: StoryEditor (메인 조립 + 상태 관리)

**Files:**
- Create: `frontend/src/components/generate/StoryEditor.tsx`

- [ ] **Step 1: 메인 에디터 컴포넌트 작성**

3패널 레이아웃, StoryState 관리, API 호출, suggestion 적용 로직.

핵심 기능:
- `generateOutline()` — `/story/outline` 호출
- `approveOutline()` — 아웃라인 파싱 → scenes 생성 → `/story/generate` SSE
- `sendChatMessage()` — `/story/chat` SSE, suggestion 파싱
- `applySuggestion()` — outline 또는 scene 텍스트 교체
- `regenerateScene()` — `/story/regenerate-scene` 호출
- `exportScript()` — Blob 다운로드

아웃라인 파싱은 프론트에서 정규식:
```typescript
function parseOutline(text: string): { num: number; description: string }[] {
  const pattern = /장면\s+(\d+)\/(\d+)\s*\(([^)]+)\)\s*:\s*(.+?)(?=\n\s*장면\s+\d+\/|\s*$)/gs;
  const scenes: { num: number; description: string }[] = [];
  let m;
  while ((m = pattern.exec(text)) !== null) {
    scenes.push({ num: parseInt(m[1]), description: m[4].split("\n")[0].trim() });
  }
  if (scenes.length === 0) {
    // Fallback: line-by-line
    text.split("\n").forEach((line, i) => {
      line = line.trim();
      if (line && !line.startsWith("감정:") && !line.startsWith("떡밥:")) {
        scenes.push({ num: i + 1, description: line.slice(0, 60) });
      }
    });
  }
  return scenes;
}
```

이 컴포넌트는 크므로 전체 코드는 구현 시 작성. 핵심 구조:

```tsx
export default function StoryEditor({ addLog }: Props) {
  // State
  const [state, setState] = useState<StoryState>(initialState);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatStreamContent, setChatStreamContent] = useState("");

  // Panel 1 callbacks
  // Panel 2 callbacks
  // Panel 3: sendChatMessage, applySuggestion
  // SSE handlers for /story/generate and /story/chat

  return (
    <div className="flex h-full">
      <StoryStructurePanel {...structureProps} />
      <StoryContentPanel {...contentProps} />
      <StoryChatPanel {...chatProps} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/generate/StoryEditor.tsx
git commit -m "feat: StoryEditor — 3패널 에디터 메인 컴포넌트"
```

---

### Task 8: GenerateTab 통합 + 빌드

**Files:**
- Modify: `frontend/src/components/generate/GenerateTab.tsx`
- Delete: `frontend/src/components/generate/StoryGenerator.tsx`

- [ ] **Step 1: StoryGenerator → StoryEditor 교체**

```tsx
// import StoryGenerator from "./StoryGenerator";
import StoryEditor from "./StoryEditor";

// In render, replace:
// <StoryGenerator addLog={addLog} />
// with:
// <StoryEditor addLog={addLog} />
```

- [ ] **Step 2: StoryGenerator.tsx 삭제**

```bash
rm frontend/src/components/generate/StoryGenerator.tsx
```

- [ ] **Step 3: 빌드**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/generate/
git commit -m "feat: GenerateTab에 3패널 StoryEditor 통합, StoryGenerator 제거"
```
