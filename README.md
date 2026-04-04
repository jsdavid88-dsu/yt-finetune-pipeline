# 🎬 YouTube → LoRA Fine-tune Pipeline

유튜브 영상에서 텍스트를 자동 추출하고, 로컬 LLM을 LoRA 파인튜닝하는 원스톱 GUI 도구.

## 구조

```
backend/          # FastAPI 서버 (Python)
  ├── main.py          # 엔트리포인트
  ├── routers/         # API 라우터 (collect, refine, train, generate)
  ├── services/        # 핵심 서비스 (youtube, ocr, ollama)
  ├── models/          # Pydantic 스키마
  └── requirements.txt
frontend/         # React + Vite + Tailwind (TypeScript)
  └── src/
      └── components/  # 탭별 컴포넌트 (collect, refine, train, generate)
```

## 설치 & 실행

### 사전 요구사항
- Python 3.10+
- Node.js 18+
- ffmpeg (PATH에 있어야 함)
- Ollama (localhost:11434에서 실행 중)

### Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
# → http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000 (API는 자동으로 backend:8000으로 프록시)
```

### 빌드된 프론트엔드 사용

```bash
cd frontend
npm run build
# dist/ 폴더의 정적 파일을 서빙
```

## 기능

| 탭 | 기능 | 상태 |
|---|---|---|
| 📥 수집 | 유튜브 URL/재생목록 → 자막 추출 or OCR | ✅ 동작 |
| 📝 정제 | 중복 제거, JSONL 변환, 수동 편집 | 🔧 UI 완성 |
| 🧠 학습 | 모델 선택, QLoRA 설정, 학습 시작 | 🔧 UI 프레임 |
| ✍️ 생성 | Ollama 채팅 테스트, 배치 생성 | ✅ 동작 |

## 기술 스택

- **Backend**: FastAPI, yt-dlp, ffmpeg, httpx
- **Frontend**: React 18, Vite, Tailwind CSS, TypeScript
- **LLM**: Ollama API (localhost:11434)
- **학습**: Unsloth + QLoRA (추후 연동)
