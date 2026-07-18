@echo off
cd /d "%~dp0"
start /b cmd /c "timeout /t 2 >nul & start http://localhost:8765"
uv run uvicorn --app-dir src clip_editor.app:app --host 127.0.0.1 --port 8765
