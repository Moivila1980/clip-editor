"""Smoke test E2E de la pestanya Tallar: tallar un clip, desar-lo i veure'l al Muntatge."""
import subprocess
import sys
import tempfile
import time
import urllib.request
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765"
ROOT = Path(__file__).resolve().parents[1]


def make_clip(dst: Path, color: str) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-t", "3", "-i", f"color=c={color}:s=480x270:r=30",
         "-f", "lavfi", "-t", "3", "-i", "sine=frequency=440:sample_rate=48000",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(dst)],
        check=True, capture_output=True)
    return dst


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

        page.locator(".card").first.click()
        page.wait_for_selector("#editor:not([hidden])")
        page.locator("#trim-start").fill("0.5")
        page.locator("#trim-start").dispatch_event("input")
        page.locator("#trim-end").fill("2")
        page.locator("#trim-end").dispatch_event("input")
        page.click("#save-cut")
        page.wait_for_selector("#saved-list li", timeout=60000)
        saved_text = page.locator("#saved-list li").first.inner_text()
        assert "gravacio_tall_0.5-2.0.mp4" in saved_text, saved_text
        print("OK tall desat:", saved_text.split("(")[0].strip())

        out_file = ROOT / "OUTPUT" / "talls" / "gravacio_tall_0.5-2.0.mp4"
        assert out_file.exists(), f"No existeix {out_file}"
        dur = float(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(out_file)],
            capture_output=True, text=True, check=True).stdout.strip())
        assert 1.2 < dur < 1.9, f"Durada inesperada: {dur}"
        print(f"OK fitxer a OUTPUT/talls ({dur:.2f}s)")

        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        page.wait_for_selector(".card", timeout=15000)
        names = [e.inner_text() for e in page.locator(".card-name").all()]
        assert any("gravacio_tall_0.5-2.0" in n for n in names), names
        print("OK el tall apareix a la pestanya Muntatge:", names)
        browser.close()

    print("SMOKE TEST TALLS COMPLET: tot OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
