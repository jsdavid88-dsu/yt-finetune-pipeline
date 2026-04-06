#!/bin/bash
set -e

# StoryForge startup script for Linux/Mac

ROOT="$(cd "$(dirname "$0")" && pwd)"
PYTHON=""
SERVER_PID=""

cleanup() {
    echo ""
    echo "Shutting down..."
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    echo "Done."
    exit 0
}

trap cleanup SIGINT SIGTERM

echo ""
echo " === StoryForge v0.3 ==="
echo ""

# [1/5] Python
echo "[1/5] Python..."
if [ -x "$ROOT/python-embedded/python" ]; then
    PYTHON="$ROOT/python-embedded/python"
    echo "  OK - embedded"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON="python3"
    echo "  OK - system (python3)"
elif command -v python >/dev/null 2>&1; then
    PYTHON="python"
    echo "  OK - system (python)"
else
    echo "  ERROR - no python found"
    exit 1
fi

# [2/5] GPU
echo "[2/5] GPU..."
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    echo "  OK"
else
    echo "  WARN - no GPU detected (nvidia-smi not found or failed)"
fi

# [3/5] Ollama
echo "[3/5] Ollama..."
if ! command -v ollama >/dev/null 2>&1; then
    echo "  not found, installing..."
    curl -fsSL https://ollama.com/install.sh | sh
    if ! command -v ollama >/dev/null 2>&1; then
        echo "  ERROR - install failed"
        exit 1
    fi
    echo "  installed"
fi
echo "  OK"

# [4/5] Ollama server and model
echo "[4/5] Ollama server..."
if ! pgrep -x ollama >/dev/null 2>&1; then
    ollama serve >/dev/null 2>&1 &
    sleep 3
fi

if ! ollama list 2>/dev/null | grep -qi "gemma4"; then
    echo "  pulling gemma4..."
    ollama pull gemma4
fi
echo "  OK"

# [5/5] Start server
echo "[5/5] Starting server..."
cd "$ROOT/backend"
"$PYTHON" -m pip install -r requirements.txt -q 2>/dev/null || true
"$PYTHON" main.py &
SERVER_PID=$!
sleep 3

# Detect IP address
LOCAL_IP="127.0.0.1"
if command -v hostname >/dev/null 2>&1; then
    DETECTED_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -n "$DETECTED_IP" ]; then
        LOCAL_IP="$DETECTED_IP"
    fi
fi

echo ""
echo " === StoryForge ready ==="
echo " http://${LOCAL_IP}:8000"
echo " http://127.0.0.1:8000"
echo ""

# Open browser if possible
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:8000" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:8000" >/dev/null 2>&1 || true
fi

echo "Press Ctrl+C to stop server..."
wait "$SERVER_PID" 2>/dev/null || true
