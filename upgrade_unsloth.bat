@echo off
chcp 65001 >nul
echo === Upgrade Unsloth ===

set "ROOT=%~dp0"
set "VENV_PIP=%ROOT%backend\.train-venv\Scripts\pip.exe"

if not exist "%VENV_PIP%" (
    echo ERROR - .train-venv not found.
    pause
    exit /b 1
)

echo Upgrading unsloth + unsloth_zoo...
"%VENV_PIP%" install --upgrade unsloth unsloth_zoo

echo.
echo Reinstalling CUDA torch (prevent CPU override)...
"%VENV_PIP%" install --force-reinstall torch torchvision --index-url https://download.pytorch.org/whl/cu128

echo.
echo Verifying...
"%ROOT%backend\.train-venv\Scripts\python.exe" -c "import unsloth; print(f'Unsloth: {unsloth.__version__}'); import torch; print(f'CUDA: {torch.cuda.is_available()}')"

echo.
pause
