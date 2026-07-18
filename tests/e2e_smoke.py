"""Smoke test E2E del Clip Editor: pujar, reordenar, muntar i comprovar resultat."""
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765"
OUTPUT = Path(__file__).resolve().parents[1] / "OUTPUT"


def make_clip(dst: Path, color: str) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-t", "2", "-i", f"color=c={color}:s=480x270:r=30",
         "-f", "lavfi", "-t", "2", "-i", "sine=frequency=440:sample_rate=48000",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(dst)],
        check=True, capture_output=True)
    return dst


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    clips = [make_clip(tmp / "vermell.mp4", "red"), make_clip(tmp / "blau.mp4", "blue")]
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        # 0. Neteja de clips d'execucions anteriors
        import urllib.request, json
        existing = json.loads(urllib.request.urlopen(f"{BASE}/api/clips").read())
        for clip in existing:
            req = urllib.request.Request(f"{BASE}/api/clips/{clip['id']}", method="DELETE")
            urllib.request.urlopen(req)

        page.goto(BASE)
        page.wait_for_load_state("networkidle")

        # 1. Pujar els dos clips
        page.set_input_files("#file-input", [str(c) for c in clips])
        page.wait_for_selector(".card:nth-child(2)", timeout=30000)
        names = [e.inner_text() for e in page.locator(".card-name").all()]
        assert "vermell.mp4" in names and "blau.mp4" in names, f"Noms inesperats: {names}"
        print("OK pujada:", names)

        # 2. Obrir l'editor de talls del primer clip i moure el final a 1.5s
        page.locator(".card").first.click()
        page.wait_for_selector("#editor:not([hidden])")
        page.locator("#trim-end").fill("1.5")
        page.locator("#trim-end").dispatch_event("input")
        assert page.locator("#end-val").inner_text() == "1.5"
        page.locator("#close-editor").click()
        print("OK editor de talls (fi=1.5s)")

        # 3. Reordenar arrossegant la segona targeta davant la primera
        first = page.locator(".card").first.bounding_box()
        second = page.locator(".card").nth(1).bounding_box()
        page.mouse.move(second["x"] + second["width"] / 2, second["y"] + second["height"] / 2)
        page.mouse.down()
        page.mouse.move(first["x"] + 5, first["y"] + first["height"] / 2, steps=15)
        page.mouse.up()
        page.wait_for_timeout(500)
        names_after = [e.inner_text() for e in page.locator(".card-name").all()]
        print("OK reordenacio:", names_after)

        # 4. Muntar amb crossfade
        page.select_option("#transition", "crossfade")
        page.fill("#out-name", "smoke")
        page.click("#assemble")
        page.wait_for_selector("#result:not([hidden])", timeout=180000)
        result_path = page.locator("#result-path").inner_text()
        assert "smoke.mp4" in result_path, result_path
        print("OK muntatge:", result_path)

        page.screenshot(path=str(Path(__file__).parent / "smoke_final.png"), full_page=True)
        browser.close()

    out = OUTPUT / "smoke.mp4"
    assert out.exists(), f"No existeix {out}"
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(out)],
        capture_output=True, text=True, check=True).stdout.strip())
    assert 2.4 < dur < 3.6, f"Durada inesperada: {dur}"  # 1.5 + 2 - 0.5 de crossfade = 3.0
    print(f"OK fitxer final: {out} ({dur:.2f}s)")

    js_errors = [e for e in errors if "favicon" not in e.lower()]
    if js_errors:
        print("ERRORS JS:", js_errors)
        return 1
    print("SMOKE TEST COMPLET: tot OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
