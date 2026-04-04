@echo off
chcp 65001 >nul
title 🎬 StoryForge - 로컬 AI 파인튜닝 파이프라인

echo.
echo  ╔══════════════════════════════════════╗
echo  ║  🎬 StoryForge v0.2                  ║
echo  ║  로컬 AI 파인튜닝 파이프라인          ║
echo  ╚══════════════════════════════════════╝
echo.

:: ─── GPU 드라이버 확인 ───
echo [1/5] GPU 확인 중...
nvidia-smi >nul 2>&1
if %errorlevel% neq 0 (
    echo  ⚠️  NVIDIA GPU 드라이버가 감지되지 않습니다.
    echo  ⚠️  GPU 없이도 실행 가능하지만 매우 느립니다.
    echo  ⚠️  https://www.nvidia.com/drivers 에서 드라이버를 설치하세요.
    echo.
    pause
)
echo  ✅ GPU 확인 완료

:: ─── Ollama 확인/설치 ───
echo [2/5] Ollama 확인 중...
where ollama >nul 2>&1
if %errorlevel% neq 0 (
    echo  📦 Ollama가 설치되어 있지 않습니다. 자동 설치 중...
    winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements -s winget
    if %errorlevel% neq 0 (
        echo  ❌ Ollama 자동 설치 실패. https://ollama.com 에서 직접 설치해주세요.
        pause
        exit /b 1
    )
    echo  ✅ Ollama 설치 완료. 재시작이 필요할 수 있습니다.
    echo  이 창을 닫고 다시 실행해주세요.
    pause
    exit /b 0
)
echo  ✅ Ollama 확인 완료

:: ─── Ollama 서버 시작 ───
echo [3/5] Ollama 서버 시작 중...
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | findstr /I "ollama.exe" >nul 2>&1
if %errorlevel% neq 0 (
    start /B "" ollama serve >nul 2>&1
    timeout /t 3 /nobreak >nul
)
echo  ✅ Ollama 서버 실행 중

:: ─── Gemma 4 모델 확인 ───
echo [4/5] Gemma 4 모델 확인 중...
ollama list 2>nul | findstr /I "gemma4" >nul 2>&1
if %errorlevel% neq 0 (
    echo  📦 Gemma 4 모델 다운로드 중... (약 9.6GB, 10~15분 소요)
    echo  ☕ 커피 한 잔 하고 오세요!
    echo.
    ollama pull gemma4
    if %errorlevel% neq 0 (
        echo  ❌ 모델 다운로드 실패. 인터넷 연결을 확인해주세요.
        pause
        exit /b 1
    )
)
echo  ✅ Gemma 4 모델 준비 완료

:: ─── 백엔드 시작 ───
echo [5/5] StoryForge 시작 중...
cd /d %~dp0backend
pip install -r requirements.txt -q 2>nul
start /B "" python main.py >nul 2>&1
timeout /t 3 /nobreak >nul

:: ─── 프론트엔드 시작 + 브라우저 열기 ───
cd /d %~dp0frontend
echo.
echo  ╔══════════════════════════════════════╗
echo  ║  🎉 StoryForge 시작 완료!            ║
echo  ║  브라우저에서 자동으로 열립니다.       ║
echo  ║  이 창을 닫으면 서버가 종료됩니다.     ║
echo  ╚══════════════════════════════════════╝
echo.
start http://127.0.0.1:4000
npm run dev
