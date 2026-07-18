"""Smoke test E2E de la PWA (ffmpeg.wasm al navegador): pujar, tallar i muntar."""
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8899"


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
    pwa_dir = Path(__file__).resolve().parents[1] / "pwa"
    server = subprocess.Popen([sys.executable, "-m", "http.server", "8899"], cwd=pwa_dir,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errors: list[str] = []
    try:
        time.sleep(2)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(BASE)
            page.wait_for_load_state("networkidle")

            page.set_input_files("#file-input", [str(c) for c in clips])
            page.wait_for_selector(".card:nth-child(2)", timeout=30000)
            print("OK pujada local (2 targetes)")

            page.locator(".card").first.click()
            page.wait_for_selector("#editor:not([hidden])")
            page.locator("#trim-end").fill("1.5")
            page.locator("#trim-end").dispatch_event("input")
            page.locator("#close-editor").click()
            print("OK editor de talls (fi=1.5s)")

            page.fill("#out-name", "pwa-smoke")
            page.click("#assemble")
            page.wait_for_selector("#result:not([hidden])", timeout=600000)
            info = page.locator("#result-path").inner_text()
            assert "pwa-smoke.mp4" in info, info
            print("OK muntatge wasm:", info)

            dl = page.locator("#download").get_attribute("download")
            assert dl == "pwa-smoke.mp4", dl
            page.screenshot(path=str(tmp / "pwa_final.png"), full_page=True)
            browser.close()
    finally:
        server.terminate()

    js_errors = [e for e in errors if "favicon" not in e.lower()]
    if js_errors:
        print("ERRORS JS:", js_errors)
        return 1
    print("SMOKE TEST PWA COMPLET: tot OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
