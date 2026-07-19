"""Smoke test E2E de la pestanya Tallar: marcar inici/final, nom, tallar, eliminar."""
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765"
ROOT = Path(__file__).resolve().parents[1]
TALLS = ROOT / "OUTPUT" / "talls"


def make_clip(dst: Path, color: str) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-t", "3", "-i", f"color=c={color}:s=480x270:r=30",
         "-f", "lavfi", "-t", "3", "-i", "sine=frequency=440:sample_rate=48000",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(dst)],
        check=True, capture_output=True)
    return dst


def duration_of(path: Path) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True).stdout.strip())


def mark_and_cut(page, start: float, end: float, name: str) -> None:
    page.wait_for_function("document.getElementById('preview').readyState >= 1")
    page.evaluate(f"document.getElementById('preview').currentTime = {start}")
    page.click("#mark-start")
    page.evaluate(f"document.getElementById('preview').currentTime = {end}")
    page.click("#mark-end")
    page.fill("#cut-name", name)
    page.click("#do-cut")


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    clip = make_clip(tmp / "gravacio.mp4", "red")

    existing = json.loads(urllib.request.urlopen(f"{BASE}/api/clips").read())
    for c in existing:
        urllib.request.urlopen(urllib.request.Request(f"{BASE}/api/clips/{c['id']}", method="DELETE"))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(f"{BASE}/talls")
        page.wait_for_load_state("networkidle")

        page.set_input_files("#file-input", [str(clip)])
        page.wait_for_selector(".card", timeout=30000)
        print("OK pujada a la pestanya Tallar")

        # Tall 1: amb nom personalitzat
        page.locator(".card").first.click()
        page.wait_for_selector("#editor:not([hidden])")
        mark_and_cut(page, 0.5, 2.0, "prova esquena")
        page.wait_for_selector("#saved-list li", timeout=60000)
        text = page.locator("#saved-list li").first.inner_text()
        assert "prova esquena.mp4" in text, text
        named = TALLS / "prova esquena.mp4"
        assert named.exists() and 1.2 < duration_of(named) < 1.9
        print("OK tall amb nom personalitzat (1.5s)")

        # Editar el nom del tall un cop fet
        page.once("dialog", lambda d: d.accept("gir definitiu"))
        page.locator("#saved-list li .ren-saved").first.click()
        page.wait_for_timeout(800)
        renamed = TALLS / "gir definitiu.mp4"
        assert renamed.exists(), "El fitxer no s'ha reanomenat"
        assert not named.exists(), "El fitxer antic encara existeix"
        assert "gir definitiu.mp4" in page.locator("#saved-list li").first.inner_text()
        print("OK nom editat després de tallar")

        # Eliminar el tall
        page.locator("#saved-list li .del-saved").first.click()
        page.wait_for_timeout(800)
        assert not renamed.exists(), "El fitxer del tall no s'ha esborrat"
        assert page.locator("#saved-list li").count() == 0
        print("OK tall eliminat (llista i fitxer)")

        # Tall 2: sense nom (per defecte) i comprovar que apareix al Muntatge
        mark_and_cut(page, 1.0, 2.5, "")
        page.wait_for_selector("#saved-list li", timeout=60000)
        default = TALLS / "gravacio_tall_1.0-2.5.mp4"
        assert default.exists(), "Falta el tall amb nom per defecte"
        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        page.wait_for_selector(".card", timeout=15000)
        names = [e.inner_text() for e in page.locator(".card-name").all()]
        assert any("gravacio_tall_1.0-2.5" in n for n in names), names
        print("OK tall per defecte visible al Muntatge:", names)
        browser.close()

    print("SMOKE TEST TALLS COMPLET: tot OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
