"""Fixtures compartides: generació de clips sintètics amb ffmpeg."""
import subprocess
from pathlib import Path

import pytest


def _make_clip(dst: Path, seconds: float, color: str, portrait: bool, audio: bool) -> Path:
    size = "270x480" if portrait else "480x270"
    cmd = ["ffmpeg", "-y", "-f", "lavfi", "-t", str(seconds), "-i", f"color=c={color}:s={size}:r=30"]
    if audio:
        cmd += ["-f", "lavfi", "-t", str(seconds), "-i", "sine=frequency=440:sample_rate=48000"]
    cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
    if audio:
        cmd += ["-c:a", "aac"]
    cmd += [str(dst)]
    subprocess.run(cmd, check=True, capture_output=True)
    return dst


@pytest.fixture
def make_clip(tmp_path: Path):
    """Factoria de clips sintètics curts per a tests d'integració."""

    def _factory(name: str = "clip.mp4", seconds: float = 2.0, color: str = "red",
                 portrait: bool = False, audio: bool = True) -> Path:
        return _make_clip(tmp_path / name, seconds, color, portrait, audio)

    return _factory
