@echo off
chcp 65001 >nul
set "ROOT=%~dp0"
set "VENV_PY=%ROOT%backend\.train-venv\Scripts\python.exe"

for /d %%d in ("%ROOT%backend\data\*") do (
    if exist "%%d\adapters\lora\adapter_model.safetensors" (
        echo === LoRA keys ===
        "%VENV_PY%" -c "from safetensors.torch import load_file; w = load_file(r'%%d\adapters\lora\adapter_model.safetensors'); keys = sorted(w.keys()); print(f'Total: {len(keys)} keys'); [print(k, w[k].shape) for k in keys[:20]]; print('...')"
        echo.
        echo === Base model keys (first 20) ===
        "%VENV_PY%" -c "from transformers import AutoModelForCausalLM; import torch; m = AutoModelForCausalLM.from_pretrained('unsloth/gemma-4-E4B-it', torch_dtype=torch.bfloat16, device_map='cpu'); keys = [k for k in m.state_dict().keys() if 'layers.0.self_attn' in k]; [print(k) for k in keys]"
        goto :done
    )
)
echo No LoRA found
:done
pause
