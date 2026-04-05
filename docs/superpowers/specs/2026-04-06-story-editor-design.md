# 스크립트 생성 에디터 설계

## 개요

생성 탭의 스크립트 모드를 3패널 에디터로 개편. 아웃라인 → 장면 생성 → 검수까지 대화형 수정 + 직접 편집을 모두 지원.

## 현재 상태

- 아웃라인 생성 → 텍스트 편집 → 승인 후 자동 생성
- 개별 장면 "다시 쓰기" 가능
- 부족한 것: 대화형 수정, 진행 체크, 인라인 편집, 장면 선택 편집

## 3패널 레이아웃

```
[패널 1: 구조]        [패널 2: 에디터]       [패널 3: 채팅]
 Phase 상태            선택한 항목 상세        모델과 대화
 장면 목록             텍스트 보기/편집        맥락 인식
 진행 체크             적용 버튼
```

최소 뷰포트: 1200px. 패널 1 ~200px, 패널 3 ~350px, 패널 2 나머지.

### 패널 1: 구조 (왼쪽 사이드바, ~200px)

- **Phase 표시**: 입력 → 아웃라인 → 생성 → 검수 상태 표시
  - `input` 상태에서는 패널 2에 장르/주제 입력 폼, 패널 3은 비활성
- **장면 목록**: 아웃라인 확정 후 장면별 리스트
  - 상태 아이콘: ⬜ 대기, 🔄 생성중, ✅ 완료, ⚠ 수정됨
  - 클릭하면 패널 2에 해당 장면 표시
- **전체 보기 버튼**: 패널 2에 통합 뷰 표시
- **내보내기 버튼**: 검수 Phase에서 활성화
- **설정**: 모델 선택, 장면 수 (numScenes, 기본 12, 4-20)

### 패널 2: 에디터 (중앙, 유동)

Phase별 내용:

**input (입력)**:
- 장르/주제 입력 폼
- "아웃라인 생성" 버튼

**outline (아웃라인)**:
- 아웃라인 전체 텍스트 표시
- 직접 편집 가능 (textarea)
- 채팅에서 수정 제안 오면 "적용" 버튼으로 교체
- "승인 → 생성 시작" 버튼

**generating (장면 생성)**:
- 선택한 장면의 텍스트 표시
- 완료된 장면은 직접 편집 가능
- 생성 중인 장면은 실시간 스트리밍 표시
- 채팅에서 수정 제안 오면 "적용" 버튼
- **주의**: 이미 생성 완료된 장면만 편집 가능. 편집해도 이후 장면 재생성은 하지 않음 (검수 Phase에서 처리)

**review (검수)**:
- 전체 통합 뷰 (장면 구분선 포함) 또는 개별 장면 뷰
- 인라인 편집 가능
- 채팅에서 수정 제안 오면 해당 장면에 "적용" 버튼

### 패널 3: 채팅 (오른쪽, ~350px)

- 일반적인 채팅 인터페이스 (입력 + 메시지 목록)
- `input` Phase에서는 비활성 (회색 처리, "아웃라인을 먼저 생성하세요")
- **맥락 인식**: 현재 Phase + 선택된 장면 정보를 system prompt에 포함
  - outline: 아웃라인 전체를 맥락으로
  - generating/review: 선택된 장면 텍스트 + 아웃라인을 맥락으로
- **수정 제안**: 백엔드가 모델에게 구조화된 출력을 지시하고, 응답을 파싱하여 suggestion 이벤트로 전달
  - 적용 시 패널 2의 해당 내용 교체
- **명령 처리 예시**:
  - "3,4,5번 합쳐줘" → 아웃라인 수정 제안
  - "이 장면 더 긴장감 있게" → 장면 텍스트 재생성 제안
  - "대사 추가해줘" → 수정된 장면 제안
  - "2번이랑 3번 사이 전환 어색해" → 전환 문장 제안

## 백엔드 API

### 기존 유지
- `POST /api/generate/story/outline` — 아웃라인 생성
- `POST /api/generate/story/generate` — 장면별 SSE 생성
- `POST /api/generate/story/regenerate-scene` — 장면 재생성

### 신규: 맥락 인식 채팅

`POST /api/generate/story/chat`

```python
class StoryChatContext(BaseModel):
    phase: str                         # "outline" | "generating" | "review"
    outline: str = ""
    selected_scene: Optional[int] = None
    selected_text: Optional[str] = None
    genre: str = ""
    topic: str = ""

class StoryChatRequest(BaseModel):
    model: str
    message: str
    history: list[dict[str, str]] = []  # [{"role": "user", "content": "..."}, ...]
    context: StoryChatContext
    temperature: float = 0.7
```

**백엔드 처리**:
1. context + history + message로 system prompt 조립
2. system prompt에 "수정이 필요하면 ```suggestion 블록으로 감싸서 출력해" 지시
3. 모델 응답을 토큰 단위로 스트리밍
4. 스트리밍 완료 후, 응답 전체에서 ```suggestion 블록을 파싱
5. 파싱 결과가 있으면 마지막에 suggestion 이벤트 전송

**응답 (SSE)**:
```
data: {"type": "token", "content": "네, "}
data: {"type": "token", "content": "3,4,5번을 "}
data: {"type": "token", "content": "합쳐볼게요..."}
...
data: {"type": "done", "full_content": "네, 3,4,5번을 합쳐볼게요.\n\n```suggestion\n장면 3/10 (전개): ...\n```"}
data: {"type": "suggestion", "text": "장면 3/10 (전개): ...", "target": "outline", "scene_num": null}
data: [DONE]
```

- `target`: `"outline"` (아웃라인 전체 교체) | `"scene"` (특정 장면 교체)
- `scene_num`: target이 "scene"일 때 대상 장면 번호 (context.selected_scene에서 자동 설정)

`scene_insert` 타입은 제거 — 복잡도 대비 가치 낮음. 장면 추가/삭제는 아웃라인 편집에서 처리.

## 데이터 흐름

```
사용자: 장르+주제 입력 → [아웃라인 생성]
    ↓
Phase outline: 아웃라인 수정 (채팅/직접편집)
    ↓ [승인]
Phase generating: 장면별 생성 (자동, 완료된 장면은 편집 가능)
    ↓ 전부 완료
Phase review: 검수 (채팅/직접편집, 개별 재생성)
    ↓ [내보내기]
```

### 장면 description 추출

아웃라인 승인 시 **프론트엔드에서** 정규식으로 파싱:
```
"장면 {N}/{total} ({position}): {description}"
```
파싱 실패 시 줄 단위로 fallback. 기존 `story_service.py`의 `parse_outline()`과 동일한 로직을 프론트에도 구현.

## 상태 관리

```typescript
interface SceneData {
  num: number;
  description: string;     // 아웃라인에서 정규식 추출
  text: string;            // 생성된 장면 텍스트
  status: "pending" | "generating" | "done" | "modified";
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestion?: {
    text: string;
    target: "outline" | "scene";
    scene_num: number | null;
  };
}

interface StoryState {
  phase: "input" | "outline" | "generating" | "review";
  genre: string;
  topic: string;
  model: string;
  numScenes: number;
  outline: string;
  scenes: SceneData[];
  selectedScene: number | null;  // null = 전체 보기
  chatMessages: ChatMessage[];
}
```

## 프론트엔드 컴포넌트 구조

```
StoryEditor (메인 3패널 레이아웃)
├── StoryStructurePanel (패널 1)
│   ├── PhaseIndicator
│   ├── SceneList (클릭 → selectedScene 변경)
│   └── ActionButtons (생성시작/내보내기)
├── StoryContentPanel (패널 2)
│   ├── InputForm (phase=input)
│   ├── OutlineEditor (phase=outline)
│   ├── SceneEditor (phase=generating/review)
│   └── FullScriptView (phase=review, selectedScene=null)
└── StoryChatPanel (패널 3)
    ├── ChatMessages (suggestion 있으면 "적용" 버튼 포함)
    └── ChatInput

props: addLog 함수는 StoryEditor → 각 하위 컴포넌트로 전달
```

기존 `StoryGenerator.tsx`를 `StoryEditor.tsx`로 교체.

## 변경 범위

| 파일 | 변경 |
|------|------|
| `services/story_service.py` | `chat_with_context()` 함수 추가 — system prompt 조립 + suggestion 파싱 |
| `routers/generate.py` | `/story/chat` SSE 엔드포인트 추가 |
| `models/schemas.py` | `StoryChatContext`, `StoryChatRequest` 스키마 추가 |
| `frontend/src/components/generate/StoryEditor.tsx` | 신규 — 3패널 레이아웃 + 상태 관리 |
| `frontend/src/components/generate/StoryStructurePanel.tsx` | 신규 |
| `frontend/src/components/generate/StoryContentPanel.tsx` | 신규 |
| `frontend/src/components/generate/StoryChatPanel.tsx` | 신규 |
| `frontend/src/components/generate/GenerateTab.tsx` | StoryGenerator → StoryEditor 교체 |
| `frontend/src/components/generate/StoryGenerator.tsx` | 삭제 (StoryEditor로 대체) |

## 에러 처리

- 채팅 API 실패: 채팅 패널에 에러 메시지 표시, 재시도 버튼
- 장면 생성 실패: 해당 장면 status를 "pending"으로, 패널 1에 경고 표시, 재생성 가능
- 모델 연결 끊김: 전역 에러 배너 + addLog("error", ...)

## 구현하지 않는 것

- 버전 히스토리 / undo
- 여러 사용자 동시 편집
- 이미지/삽화 생성
- 장면 삽입 (아웃라인 편집에서 대체)
- 생성 중 편집 시 이후 장면 재생성 (검수 Phase에서 수동 재생성)

## 내보내기

기존과 동일하게 클라이언트 사이드 Blob 다운로드. 전체 장면을 `\n\n---\n\n`으로 연결하여 .txt 또는 .md로 저장.
