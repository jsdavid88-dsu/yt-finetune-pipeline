"""Build distributable StoryForge.zip package.

Run: python scripts/package.py
Output: dist/StoryForge.zip
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
STAGE = DIST / "StoryForge"


def main():
    print("=== StoryForge 패키징 시작 ===")

    # Clean
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)

    # 1. Frontend build
    print("[1/5] 프론트엔드 빌드...")
    subprocess.run(["npm", "run", "build"], cwd=str(ROOT / "frontend"), check=True)

    # 2. Copy backend
    print("[2/5] 백엔드 복사...")
    shutil.copytree(
        ROOT / "backend", STAGE / "backend",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "data"),
    )
    (STAGE / "backend" / "data").mkdir()

    # 3. Copy frontend dist
    print("[3/5] 프론트엔드 dist 복사...")
    shutil.copytree(ROOT / "frontend" / "dist", STAGE / "frontend" / "dist")

    # 4. Copy 시작.bat
    print("[4/5] 시작.bat 복사...")
    shutil.copy2(ROOT / "시작.bat", STAGE / "시작.bat")

    # 5. Setup directory
    print("[5/5] setup 디렉토리 생성...")
    (STAGE / "setup").mkdir()

    # Create zip
    print("ZIP 생성 중...")
    zip_path = DIST / "StoryForge"
    shutil.make_archive(str(zip_path), "zip", str(DIST), "StoryForge")

    final_zip = zip_path.with_suffix(".zip")
    size_mb = final_zip.stat().st_size / 1024 / 1024
    print(f"완료: {final_zip}")
    print(f"크기: {size_mb:.1f} MB")
    print()
    print("TODO: setup/ollama-installer.exe 수동 추가 필요")
    print("TODO: python-embedded/ 수동 추가 필요")
    print("      (https://www.python.org/ftp/python/ 에서 embedded zip 다운로드)")


if __name__ == "__main__":
    main()
