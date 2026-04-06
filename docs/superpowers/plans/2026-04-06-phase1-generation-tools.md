# Phase 1: 생성 도구 고도화 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정제 탭 v2 데이터 표시 + 학습 관리(LoRA 버전/비교) 구현

**Architecture:** 기존 정제/학습 탭 프론트엔드 컴포넌트 수정 + 백엔드 API 추가

**Tech Stack:** FastAPI, React/TypeScript, Tailwind CSS

**참고:** 3패널 스크립트 에디터는 별도 계획 → `docs/superpowers/plans/2026-04-06-story-editor.md`

---

## Task 1: 정제 탭 — analysis 필드 표시

**Files:**
- Modify: `frontend/src/components/refine/` 내 청크 표시 컴포넌트

- [ ] **Step 1: 기존 정제 탭 구조 파악**

```bash
ls frontend/src/components/refine/
```

청크 목록/상세 표시 컴포넌트를 찾아서 구조 확인.

- [ ] **Step 2: ChunkDetail 컴포넌트 수정**

기존 `tags` (genre/topic/mood/scene_type) 4개만 보여주던 것을 `analysis` 8개 필드로 교체:

```typescript
interface ChunkAnalysis {
  genre: string;
  core_event: string;
  characters: string[];
  emotional_arc: string;
  hook: string;
  summary: string;
  narrative_technique: string;
  is_content: boolean;
}

// 표시:
// 장르: 불륜미스터리
// 핵심사건: 사진관 벽 뒤에서 사진 발견
// 등장인물: 아내(화자), 남편(사진작가)
// 감정흐름: 공허함 → 충격 → 배신감
// 떡밥: 사진 속 여자의 정체는?
// 서사기법: 복선, 클리프행어
// [비내용] 표시 (is_content=false면)
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 정제 탭 — analysis 8개 필드 표시"
```

---

## Task 2: 정제 탭 — 교정 전후 비교

**Files:**
- Modify: `frontend/src/components/refine/` 내 청크 상세 컴포넌트

- [ ] **Step 1: 교정 비교 뷰 추가**

청크 상세에서 "원문/교정" 탭 전환:

```typescript
const [showCorrected, setShowCorrected] = useState(true);

// 토글 버튼
<button onClick={() => setShowCorrected(!showCorrected)}>
  {showCorrected ? "원문 보기" : "교정본 보기"}
</button>

// 또는 나란히 diff 뷰
<div className="grid grid-cols-2">
  <div>원문: {chunk.text}</div>
  <div>교정: {chunk.corrected_text}</div>
</div>
```

교정된 부분을 하이라이트하면 좋지만, 간단하게 토글만으로도 충분.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: 정제 탭 — 교정 전후 비교 토글"
```

---

## Task 3: 정제 탭 — 아웃라인 표시

**Files:**
- Modify: `frontend/src/components/refine/` 또는 `RefineTab.tsx`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: outlines.json 로드 API**

```python
# backend/routers/refine.py에 추가
@router.get("/outlines/{project_id}")
async def get_outlines(project_id: str):
    proj_dir = _project_dir(project_id)
    outlines_path = proj_dir / "outlines.json"
    if not outlines_path.exists():
        return {"outlines": []}
    with open(outlines_path, "r", encoding="utf-8") as f:
        return {"outlines": json.load(f)}
```

- [ ] **Step 2: 프론트엔드에서 아웃라인 표시**

정제 탭 하단 또는 별도 섹션에 에피소드별 아웃라인 표시:

```
에피소드 1: 남편의 사진관... [14장면]
  장면 1 (도입): 폐업하는 사진관 벽 뒤에서 사진 발견
    감정: 공허함 → 충격
    떡밥: 사진작가로서의 꿈...
  장면 2 (도입): ...
  ...

에피소드 2: 상견례 다음날... [13장면]
  ...
```

접기/펼치기(details) 사용.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 정제 탭 — 에피소드별 아웃라인 표시"
```

---

## Task 4: 정제 탭 — is_content 필터 + 통계

**Files:**
- Modify: `frontend/src/components/refine/`

- [ ] **Step 1: 비내용 청크 시각적 구분**

청크 목록에서 `is_content === false`인 항목:
- 회색 배경 + 취소선 + "비내용" 배지
- 필터 토글: "비내용 숨기기" 체크박스

- [ ] **Step 2: dataset.jsonl 통계 표시**

정제 완료 후 통계 카드:

```
학습 데이터 생성 완료
━━━━━━━━━━━━━━━━━━━━
총 420줄
  Task 1 (아웃라인): 10
  Task 2 (장면확장): 130
  Task 3 (연속집필): 130
  Task 4 (스타일): 150

에피소드: 10개
유효 청크: 140개 (비내용 6개 제외)
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 정제 탭 — 비내용 필터 + dataset 통계 표시"
```

---

## Task 5: 학습 관리 — LoRA 버전 관리

**Files:**
- Modify: `backend/scripts/train_lora.py`
- Modify: `backend/services/train_service.py`
- Modify: `backend/routers/train.py`

- [ ] **Step 1: 학습 완료 시 버전 번호 자동 부여**

```
data/{project_id}/adapters/
  v1/          ← 첫 학습
    lora/
    *.gguf
    Modelfile
    train_config.json   ← 학습 시 사용한 설정 복사
    train_result.json   ← 최종 loss, 학습 시간, 데이터 수 등
  v2/          ← 재학습
    ...
```

Ollama 등록: `storyforge-{project}-v1`, `storyforge-{project}-v2`

- [ ] **Step 2: 학습 히스토리 API**

```python
@router.get("/history/{project_id}")
async def train_history(project_id: str):
    """Return list of completed training versions."""
    adapters_dir = _DATA_DIR / project_id / "adapters"
    if not adapters_dir.exists():
        return {"versions": []}
    versions = []
    for d in sorted(adapters_dir.iterdir()):
        if d.is_dir() and d.name.startswith("v"):
            result_file = d / "train_result.json"
            if result_file.exists():
                result = json.loads(result_file.read_text(encoding="utf-8"))
                versions.append({"version": d.name, **result})
    return {"versions": versions}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: LoRA 버전 관리 — 자동 버전 번호 + 히스토리 API"
```

---

## Task 6: 학습 관리 — 히스토리 UI

**Files:**
- Modify: `frontend/src/components/train/TrainTab.tsx`

- [ ] **Step 1: 학습 히스토리 목록 표시**

학습 탭 하단에 이전 학습 목록:

```
학습 히스토리
━━━━━━━━━━━━━━━━━━━━
v1  Gemma4 8B  loss: 0.42  2026-04-06  420개 데이터
v2  Gemma4 8B  loss: 0.38  2026-04-07  50,000개 데이터  ← 현재 Ollama 등록됨
```

각 버전:
- 사용한 모델/설정 표시
- "이 버전 등록" 버튼 (Ollama에 다시 등록)
- "삭제" 버튼

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: 학습 히스토리 UI — 버전 목록 + 등록/삭제"
```

---

## Task 7: 학습 관리 — LoRA 비교 생성

**Files:**
- Create: `frontend/src/components/generate/LoraCompare.tsx`
- Modify: `frontend/src/components/generate/GenerateTab.tsx`

- [ ] **Step 1: 비교 생성 UI**

생성 탭에 "비교" 모드 추가:
- 같은 프롬프트를 2개 모델(LoRA 버전)에 동시 전송
- 결과를 나란히 표시

```
[모델 A: storyforge-v1]     [모델 B: storyforge-v2]
━━━━━━━━━━━━━━━━━━━━━━━     ━━━━━━━━━━━━━━━━━━━━━━━
남편의 사진관이 폐업...      남편의 사진관이 문을 닫게...
```

- [ ] **Step 2: 백엔드는 기존 /chat API 2번 호출로 충분 (신규 API 불필요)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: LoRA 비교 생성 — 같은 프롬프트로 2개 모델 결과 비교"
```
