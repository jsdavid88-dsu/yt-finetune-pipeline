@echo off
chcp 65001 >nul
set "ROOT=%~dp0"
set "VENV_PY=%ROOT%backend\.train-venv\Scripts\python.exe"

for /d %%d in ("%ROOT%backend\data\*") do (
    if exist "%%d\dataset.jsonl" (
        "%VENV_PY%" -c "import json,sys;sys.stdout.reconfigure(encoding='utf-8');lines=open(r'%%d\dataset.jsonl','r',encoding='utf-8').readlines();print(f'Total: {len(lines)} lines');d=json.loads(lines[0]);print(f'\n=== Line 0 (Task1) ===');print(f'inst: {d[\"instruction\"][:100]}');print(f'output[:300]: {d[\"output\"][:300]}');print();t4=[json.loads(l) for l in lines if 'this scene' in json.loads(l).get('instruction','').lower() or '이 장면을 써줘' in json.loads(l).get('instruction','')];print(f'Task4 count: {len(t4)}');d4=t4[0] if t4 else json.loads(lines[-1]);print(f'\n=== Task4 sample ===');print(f'inst: {d4[\"instruction\"][:150]}');print(f'output[:300]: {d4[\"output\"][:300]}')"
        goto :done
    )
)
echo No dataset found
:done
pause
