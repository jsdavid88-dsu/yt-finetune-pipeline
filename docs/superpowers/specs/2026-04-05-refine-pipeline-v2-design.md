# 정제 파이프라인 v2 + 연쇄 생성 설계

## 개요

기존 정제 로직을 개선하여 4-Task 학습 데이터를 생성하고, 학습된 모델로 긴 스토리를 자동 생성하는 연쇄 파이프라인을 구현한다.

## 현재 상태

- 정제: 청킹 → 태깅(genre/topic/mood/scene_type) → 단일 형태 JSONL
- 생성: 단건 채팅, 배치 생성만 지원
- 문제: 모델이 ~1,500자 청크만 학습 → 긴 스토리 구조를 모름

## 변경 사항

### 1. 정제 파이프라인 v2

#### Pass 1: STT 오타 교정

프리셋의 `tag_model`(기본 gemma4)로 청크 텍스트를 교정 요청.
Ollama 호출 시 `format: "json"` **사용하지 않음** — 자유 텍스트 출력.

프롬프트 핵심:
- STT 오류 유형 예시 제공 (동음이의어, 받침 탈락 등)
- "확신 없으면 원문 그대로 둬" 명시
- 출력: 교정된 텍스트 (줄바꿈 유지)

#### Pass 2: 상세 분석 (JSON)

교정된 텍스트로 8-key 분석 요청 (`format: "json"` 사용):

```json
{
  "genre": "불륜미스터리",
  "core_event": "사진관 벽 뒤에서 몰래 찍은 사진 발견",
  "characters": ["아내(화자)", "남편(사진작가)"],
  "emotional_arc": "공허함 → 충격 → 배신감",
  "hook": "사진 속 여자의 정체는?",
  "summary": "폐업하는 사진관을 정리하던 아내가 벽 뒤에서...",
  "narrative_technique": "복선, 클리프행어",
  "is_content": true
}
```

`is_content: false`인 청크(방송 인트로/아웃트로/광고/구독유도)는 학습 데이터에서 제외.

#### 저장 구조

```
data/{project_id}/
  ├── raw.txt              ← 원본 (변경 없음)
  ├── videos.json          ← 영상 메타 (변경 없음)
  ├── chunks.json          ← 교정+분석 결과 포함으로 확장
  │   [{
  │     index, text,              ← 원본 텍스트
  │     corrected_text,           ← 교정된 텍스트 (신규)
  │     analysis: {               ← 상세 분석 (신규, 기존 tags 대체)
  │       genre, core_event, characters, emotional_arc,
  │       hook, summary, narrative_technique, is_content
  │     },
  │     episode
  │   }]
  ├── outlines.json        ← 에피소드별 아웃라인 (신규, 코드 조립)
  │   [{
  │     episode: "에피소드 제목",
  │     genre: "장르",
  │     scenes: [{
  │       index: 1, position: "도입",
  │       core_event, emotional_arc, hook, summary
  │     }, ...]
  │   }]
  └── dataset.jsonl        ← 4-Task 학습 데이터 (신규 구조)
```

#### 4-Task 학습 데이터 생성

**Task 1 — 아웃라인 기획서** (에피소드당 1개)

```json
{
  "instruction": "장르: 불륜미스터리 / 제목: 남편의 사진관...\n1시간 분량 스크립트의 전체 아웃라인을 작성해줘",
  "input": "",
  "output": "장면 1/15 (도입): 폐업하는 사진관 벽 뒤에서 사진 발견\n  감정: 공허함 → 충격\n  떡밥: ...\n\n장면 2/15 (도입): ..."
}
```

아웃라인은 각 청크의 `analysis.core_event` + `analysis.emotional_arc` + `analysis.hook`을 코드로 조립. Ollama 추가 호출 없음.

**Task 2 — 장면 확장 + 맥락** (청크당 1개)

"이전 흐름"은 이전 청크들의 `analysis.core_event`를 `→`로 연결하여 구성.
`input`은 직전 청크의 마지막 500자 (청크가 500자 미만이면 전체).

```json
{
  "instruction": "장르: 불륜미스터리\n에피소드: 남편의 사진관...\n장면 5/15\n현재 장면: 남편이 흥신소 아르바이트 고백\n이전 흐름: [1] 사진 발견 → [2] 식탁 대치 → ...\n이 장면을 써줘",
  "input": "[직전 장면 마지막 500자]",
  "output": "[교정된 청크 텍스트]"
}
```

**Task 3 — 연속 집필** (인접 청크 쌍, 청크수-1개)

```json
{
  "instruction": "장르: 불륜미스터리\n에피소드: 남편의 사진관...\n장면 위치: 5/15\n감정 흐름: 냉전 → 충격\n이어서 써줘",
  "input": "[직전 장면 마지막 500자]",
  "output": "[교정된 청크 텍스트]"
}
```

**Task 4 — 스타일** (청크당 1개)

```json
{
  "instruction": "장르: 불륜미스터리 / 핵심사건: 흥신소 고백 / 감정: 냉전→충격 / 기법: 클리프행어\n이 장면을 써줘",
  "input": "",
  "output": "[교정된 청크 텍스트]"
}
```

`is_content: false`인 청크는 Task 2/3/4에서 제외. Task 3는 유효 청크만 연속으로 취급 — 비내용 청크로 중간에 끊기면 그 앞뒤를 직접 연결하지 않고 건너뜀.

#### 예상 수량

에피소드당 15청크 중 ~13개 유효(2개 인트로/아웃트로 필터) 기준:
- Task 1: 1, Task 2: 13, Task 3: 12, Task 4: 13 = **~39개/에피소드**
- 1440 에피소드 × 39 = **~56,000개 학습 데이터**

#### 성능

- Pass 1(교정) + Pass 2(분석) = 청크당 ~5초
- 에피소드당 ~75초
- 1440 에피소드 = **~30시간** (1회 실행, 백그라운드)

---

### 2. 연쇄 생성 파이프라인

#### 목적

학습된 모델(LoRA 파인튜닝)로 1시간 분량의 완전한 스토리를 자동 생성.

#### 생성 흐름

```
사용자 입력: 장르 + 주제 (예: "막장드라마, 재산다툼")
    ↓
Step 1: 아웃라인 생성 (Task 1 능력)
    모델에게: "장르: 막장드라마 / 주제: 재산다툼
              1시간 분량 스크립트의 전체 아웃라인을 작성해줘"
    → 장면 10~15개짜리 아웃라인
    ↓
Step 2: 아웃라인 파싱
    정규식으로 파싱: "장면 {N}/{total} ({position}): {description}"
    파싱 실패 시 줄 단위로 fallback 분리
    ↓
Step 3: 장면별 순차 생성 (Task 2 능력)
    장면 1 생성:
      instruction: "장르/에피소드/장면1/현재장면설명/이전흐름:없음"
      input: ""
      → 장면 1 텍스트 (~1,500자)
    
    장면 2 생성:
      instruction: "장르/에피소드/장면2/현재장면설명/이전흐름:[1]요약"
      input: "[장면1 마지막 500자]"
      → 장면 2 텍스트
    
    ... 반복 ...
    ↓
Step 4: 전체 이어붙이기
    → 완성된 스크립트 (~20,000자)
```

#### 백엔드 API

```
POST /api/generate/story
{
  "model": "storyforge-막장스토리",
  "genre": "막장드라마",
  "topic": "재산다툼",
  "num_scenes": 12,          // optional, 기본 12
  "temperature": 0.7
}
```

응답: SSE 스트리밍
- 아웃라인 생성 중 → `{"step": "outline", "content": "..."}`
- 장면 N 생성 중 → `{"step": "scene", "scene_num": 3, "total": 12, "content": "..."}`
- 에러 → `{"step": "error", "scene_num": 3, "error": "timeout"}` (해당 장면 재시도 1회, 실패 시 스킵 후 다음 장면)
- 완료 → `{"step": "done", "full_text": "..."}`

#### 프론트엔드 UI

생성 탭에 "전체 스크립트 생성" 모드 추가:
- 장르/주제 입력
- "스크립트 생성" 버튼
- 실시간 표시: 아웃라인 → 장면 1/12 생성 중... → 장면 2/12...
- 완료 시 전체 스크립트 표시 + 내보내기(txt/md)

---

### 3. 기존 코드 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/refine_service.py` | 2-pass 정제(교정+분석), 4-Task JSONL 생성, is_content 필터 |
| `routers/refine.py` | 새 정제 흐름 호출, outlines.json 저장 |
| `models/schemas.py` | 분석 결과 스키마, 스토리 생성 요청 스키마 추가 |
| `routers/generate.py` | `/story` 연쇄 생성 엔드포인트 추가 |
| `services/story_service.py` | 연쇄 생성 로직 (아웃라인 파싱, 순차 생성, 맥락 조립) — 신규 |
| `services/ollama.py` | 변경 없음 (기존 generate/stream 사용) |
| `frontend/src/components/GenerateTab.tsx` | 스토리 생성 UI 추가 |

### 4. 구현하지 않는 것

- 에피소드 간 메타 구조 분석 (1400개 데이터로 자연 학습)
- 별도 LoRA adapter 분리 (단일 adapter로 충분)
- 교정 diff UI (교정은 best-effort, 원본은 raw.txt에 보존)
- 기존 프로젝트 데이터 마이그레이션 (새 프로젝트에서 v2 정제 실행하면 됨)

### 5. 토큰 예산

학습 시 `max_seq_length: 4096`으로 설정 (기존 2048에서 상향).

| Task | instruction 예상 | input | output | 합계 (한국어 토큰) |
|------|-----------------|-------|--------|-------------------|
| Task 1 | ~50 | 0 | ~1,000 | ~1,050 |
| Task 2 (최대, 장면15) | ~400 (이전흐름 14개) | ~200 | ~500 | ~1,100 |
| Task 3 | ~100 | ~200 | ~500 | ~800 |
| Task 4 | ~100 | 0 | ~500 | ~600 |

4096 토큰 안에 모두 여유있게 들어감. Task 2의 이전흐름이 너무 길면 최근 5개까지만 포함하고 나머지는 생략.
