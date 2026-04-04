@echo off
chcp 65001 >nul
title StoryForge - 로컬 AI 파인튜닝 파이프라인

echo.
echo  ╔══════════════════════════════════════╗
echo  ║  StoryForge v0.3                     ║
echo  ║  로컬 AI 파인튜닝 파이프라인          ║
echo  ╚══════════════════════════════════════╝
echo.

set "ROOT=%~dp0"
set "PYTHON=%ROOT%python-embedded\python.exe"

:: --- Python 확인 ---
echo [1/5] Python 확인 중...
if exist "%PYTHON%" (
    echo   [OK] 내장 Python 사용
) else (
    where python >nul 2>&1
    if %errorlevel% neq 0 (
        echo   [ERROR] Python이 없습니다. python-embedded 폴더를 확인하세요.
        pause
        exit /b 1
    )
    set "PYTHON=python"
    echo   [OK] 시스템 Python 사용
)

:: --- GPU 확인 ---
echo [2/5] GPU 확인 중...
nvidia-smi >nul 2>&1
if %errorlevel% neq 0 (
    echo   [WARN] NVIDIA GPU 미감지. 수집/정제/생성은 가능하지만 학습은 불가합니다.
) else (
    echo   [OK] GPU 확인 완료
)

:: --- Ollama 확인/설치 ---
echo [3/5] Ollama 확인 중...
where ollama >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%ROOT%setup\ollama-installer.exe" (
        echo   [INFO] Ollama 설치 중...
        "%ROOT%setup\ollama-installer.exe" /VERYSILENT /NORESTART
    ) else (
        echo   [INFO] Ollama 자동 설치 중... (winget)
        winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements -s winget
    )
    if %errorlevel% neq 0 (
        echo   [ERROR] Ollama 설치 실패. https://ollama.com 에서 직접 설치해주세요.
        pause
        exit /b 1
    )
    echo   [OK] Ollama 설치 완료. 이 창을 닫고 다시 실행해주세요.
    pause
    exit /b 0
)
echo   [OK] Ollama 확인 완료

:: --- Ollama 서버 시작 ---
echo [4/5] Ollama 서버 시작 중...
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | findstr /I "ollama.exe" >nul 2>&1
if %errorlevel% neq 0 (
    start /B "" ollama serve >nul 2>&1
    timeout /t 3 /nobreak >nul
)

:: Gemma4 모델 확인
ollama list 2>nul | findstr /I "gemma4" >nul 2>&1
if %errorlevel% neq 0 (
    echo   [INFO] Gemma 4 모델 다운로드 중... (약 9.6GB, 10~15분 소요)
    ollama pull gemma4
    if %errorlevel% neq 0 (
        echo   [ERROR] 모델 다운로드 실패. 인터넷 연결을 확인해주세요.
        pause
        exit /b 1
    )
)
echo   [OK] Ollama 서버 + 모델 준비 완료

:: --- 백엔드 시작 ---
echo [5/5] StoryForge 시작 중...
cd /d "%ROOT%backend"
"%PYTHON%" -m pip install -r requirements.txt -q 2>nul
start /B "" "%PYTHON%" main.py >nul 2>&1
timeout /t 3 /nobreak >nul

:: --- 브라우저 열기 ---
echo.
echo  ╔══════════════════════════════════════╗
echo  ║  StoryForge 시작 완료!               ║
echo  ║  브라우저에서 자동으로 열립니다.       ║
echo  ║  이 창을 닫으면 서버가 종료됩니다.     ║
echo  ╚══════════════════════════════════════╝
echo.
start http://127.0.0.1:8000
echo 서버 실행 중... (이 창을 닫으면 종료됩니다)
pause >nul
