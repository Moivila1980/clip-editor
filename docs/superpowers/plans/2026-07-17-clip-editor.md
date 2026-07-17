# Clip Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App local (FastAPI + ffmpeg) per tallar, ordenar amb el ratolí i unir clips de mòbil amb transicions i música.

**Architecture:** Servidor FastAPI (port 8765) que serveix una pàgina estàtica (vanilla JS + SortableJS vendoritzat) i executa ffmpeg del PATH. Lògica de construcció d'ordres ffmpeg en funcions pures (`assemble.py`), execució en fil de fons (`jobs.py`), API fina (`app.py`).

**Tech Stack:** Python 3.11+ (uv), FastAPI, uvicorn, python-multipart, pytest + httpx (tests), ffmpeg/ffprobe 8.1.1 del PATH, SortableJS 1.15 vendoritzat.

**Spec:** `docs/superpowers/specs/2026-07-17-clip-editor-design.md`

---

### Task 1: Scaffolding del projecte

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `src/clip_editor/__init__.py`, `static/vendor/Sortable.min.js`

- [ ] **Step 1: Crear `pyproject.toml`**

```toml
[project]
name = "clip-editor"
version = "0.1.0"
description = "Editor local de clips de mòbil: tallar, ordenar, unir amb música"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "python-multipart>=0.0.9",
]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 2: Crear `.gitignore`**

```
workspace/
OUTPUT/
__pycache__/
.venv/
*.pyc
uv.lock
```

- [ ] **Step 3: Crear paquet i carpetes**

Crear `src/clip_editor/__init__.py` amb:

```python
"""Clip Editor: editor local de clips de mòbil."""
```

Crear dirs buits: `static/vendor/`, `tests/`.

- [ ] **Step 4: Instal·lar deps i vendoritzar SortableJS**

Run: `uv sync` (des de l'arrel del projecte)
Run: `curl -L -o static/vendor/Sortable.min.js https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js`
Expected: fitxer >40 KB.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml .gitignore src static
git commit -m "chore: scaffolding del projecte (uv + FastAPI + SortableJS vendoritzat)"
```

---

### Task 2: Models de dades (`models.py`)

**Files:**
- Create: `src/clip_editor/models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Test que falla**

`tests/test_models.py`:

```python
"""Tests dels models de l'API."""
import pytest
from pydantic import ValidationError

from clip_editor.models import AssembleRequest, MusicSpec, SegmentSpec


def test_assemble_request_defaults() -> None:
    req = AssembleRequest(order=[SegmentSpec(id="a", start=0, end=5)])
    assert req.transition == "cut"
    assert req.format == "auto"
    assert req.name == "muntatge"
    assert req.music is None


def test_order_cannot_be_empty() -> None:
    with pytest.raises(ValidationError):
        AssembleRequest(order=[])


def test_music_vol_bounds() -> None:
    with pytest.raises(ValidationError):
        MusicSpec(id="m", music_vol=150)
```

- [ ] **Step 2: Run** `uv run pytest tests/test_models.py -v` → Expected: FAIL (`ModuleNotFoundError: clip_editor.models`)

- [ ] **Step 3: Implementar `src/clip_editor/models.py`**

```python
"""Models de dades de l'API del Clip Editor."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

Transition = Literal["cut", "crossfade", "fadeblack"]
OutputFormat = Literal["auto", "16:9", "9:16"]


class ClipInfo(BaseModel):
    """Metadades d'un clip carregat, tal com les veu el frontend."""

    id: str
    name: str
    duration: float
    width: int
    height: int
    has_audio: bool
    thumb_url: str
    media_url: str


class SegmentSpec(BaseModel):
    """Tros d'un clip a conservar al muntatge."""

    id: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class MusicSpec(BaseModel):
    """Música de fons i volums (0-100)."""

    id: str
    music_vol: int = Field(default=80, ge=0, le=100)
    orig_vol: int = Field(default=100, ge=0, le=100)


class AssembleRequest(BaseModel):
    """Petició de muntatge final."""

    order: list[SegmentSpec] = Field(min_length=1)
    transition: Transition = "cut"
    music: Optional[MusicSpec] = None
    format: OutputFormat = "auto"
    name: str = "muntatge"


class JobState(BaseModel):
    """Estat d'una feina de muntatge."""

    status: Literal["queued", "running", "done", "error"] = "queued"
    progress: int = 0
    step: str = ""
    output: Optional[str] = None
    error: Optional[str] = None
```

- [ ] **Step 4: Run** `uv run pytest tests/test_models.py -v` → Expected: 3 PASS

- [ ] **Step 5: Commit** — `git add src/clip_editor/models.py tests/test_models.py && git commit -m "feat: models pydantic de l'API"`

---

### Task 3: Metadades i miniatures (`media.py`)

**Files:**
- Create: `src/clip_editor/media.py`, `tests/conftest.py`
- Test: `tests/test_media.py`

- [ ] **Step 1: Fixture de clips sintètics — `tests/conftest.py`**

```python
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
```

- [ ] **Step 2: Test que falla — `tests/test_media.py`**

```python
"""Tests de ffprobe i miniatures sobre clips sintètics."""
from pathlib import Path

import pytest

from clip_editor.media import MediaError, make_thumbnail, probe, probe_duration


def test_probe_landscape(make_clip) -> None:
    clip = make_clip("land.mp4", seconds=2.0)
    meta = probe(clip)
    assert meta["width"] == 480 and meta["height"] == 270
    assert 1.8 < meta["duration"] < 2.3
    assert meta["has_audio"] is True


def test_probe_no_audio(make_clip) -> None:
    clip = make_clip("mut.mp4", audio=False)
    assert probe(clip)["has_audio"] is False


def test_probe_invalid_file(tmp_path: Path) -> None:
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    with pytest.raises(MediaError):
        probe(bad)


def test_thumbnail(make_clip, tmp_path: Path) -> None:
    clip = make_clip()
    thumb = tmp_path / "t.jpg"
    make_thumbnail(clip, thumb)
    assert thumb.exists() and thumb.stat().st_size > 500


def test_probe_duration_audio_only(make_clip, tmp_path: Path) -> None:
    clip = make_clip("a.mp4", seconds=2.0)
    assert 1.8 < probe_duration(clip) < 2.3
```

- [ ] **Step 3: Run** `uv run pytest tests/test_media.py -v` → Expected: FAIL (mòdul inexistent)

- [ ] **Step 4: Implementar `src/clip_editor/media.py`**

```python
"""Metadades (ffprobe) i miniatures dels clips."""
import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


class MediaError(Exception):
    """Error llegint o processant un fitxer multimèdia."""


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def probe(path: Path) -> dict:
    """Retorna duration/width/height/has_audio amb la rotació del mòbil aplicada."""
    proc = _run(["ffprobe", "-v", "error", "-print_format", "json",
                 "-show_streams", "-show_format", str(path)])
    if proc.returncode != 0:
        raise MediaError(f"ffprobe ha fallat: {proc.stderr.strip()[:300]}")
    data = json.loads(proc.stdout)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if video is None:
        raise MediaError("El fitxer no conté cap pista de vídeo")
    width, height = int(video["width"]), int(video["height"])
    if _rotation(video) in (90, 270):
        width, height = height, width
    duration = float(data.get("format", {}).get("duration") or 0)
    if duration <= 0:
        raise MediaError("No s'ha pogut llegir la durada del vídeo")
    has_audio = any(s.get("codec_type") == "audio" for s in data.get("streams", []))
    return {"duration": duration, "width": width, "height": height, "has_audio": has_audio}


def _rotation(video_stream: dict) -> int:
    for side in video_stream.get("side_data_list") or []:
        if "rotation" in side:
            return abs(int(side["rotation"])) % 360
    tags = video_stream.get("tags") or {}
    if "rotate" in tags:
        return abs(int(tags["rotate"])) % 360
    return 0


def probe_duration(path: Path) -> float:
    """Durada en segons de qualsevol fitxer multimèdia (també àudio)."""
    proc = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=nw=1:nk=1", str(path)])
    if proc.returncode != 0 or not proc.stdout.strip():
        raise MediaError(f"ffprobe ha fallat: {proc.stderr.strip()[:300]}")
    return float(proc.stdout.strip())


def make_thumbnail(src: Path, dst: Path) -> None:
    """Extreu un fotograma a 0,5 s escalat a 320 px d'ample."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    proc = _run(["ffmpeg", "-y", "-ss", "0.5", "-i", str(src),
                 "-frames:v", "1", "-vf", "scale=320:-2", str(dst)])
    if proc.returncode != 0:
        raise MediaError(f"No s'ha pogut crear la miniatura: {proc.stderr.strip()[:300]}")
```

- [ ] **Step 5: Run** `uv run pytest tests/test_media.py -v` → Expected: 5 PASS

- [ ] **Step 6: Commit** — `git add src/clip_editor/media.py tests/conftest.py tests/test_media.py && git commit -m "feat: ffprobe amb rotacio de mobil + miniatures"`

---

### Task 4: Constructors d'ordres ffmpeg (`assemble.py`)

**Files:**
- Create: `src/clip_editor/assemble.py`
- Test: `tests/test_assemble.py`

- [ ] **Step 1: Test que falla — `tests/test_assemble.py`**

```python
"""Tests de les funcions pures de construcció d'ordres ffmpeg."""
from pathlib import Path

from clip_editor.assemble import (
    Segment, concat_cmd, concat_list_text, music_cmd, normalize_cmd,
    target_size, xfade_cmd, xfade_offsets,
)

SEG = Segment(src=Path("in.mp4"), start=1.0, end=5.0, has_audio=True)


def test_target_size_explicit() -> None:
    assert target_size("16:9", [(1080, 1920)]) == (1920, 1080)
    assert target_size("9:16", [(1920, 1080)]) == (1080, 1920)


def test_target_size_auto_majority() -> None:
    assert target_size("auto", [(1080, 1920), (1080, 1920), (1920, 1080)]) == (1080, 1920)
    assert target_size("auto", [(1920, 1080)]) == (1920, 1080)
    assert target_size("auto", [(1080, 1920), (1920, 1080)]) == (1920, 1080)  # empat -> 16:9


def test_normalize_cmd_basics() -> None:
    cmd = normalize_cmd(SEG, Path("out.mp4"), (1920, 1080), fade_black=False)
    joined = " ".join(cmd)
    assert "-ss 1.000" in joined and "-to 5.000" in joined
    assert "boxblur" in joined and "overlay" in joined
    assert "fade=" not in joined
    assert "libx264" in joined


def test_normalize_cmd_fadeblack() -> None:
    cmd = normalize_cmd(SEG, Path("out.mp4"), (1920, 1080), fade_black=True)
    joined = " ".join(cmd)
    assert "fade=t=in" in joined and "fade=t=out:st=3.600" in joined
    assert "afade=t=out" in joined


def test_normalize_cmd_silent_clip_gets_anullsrc() -> None:
    seg = Segment(src=Path("in.mp4"), start=0.0, end=4.0, has_audio=False)
    cmd = normalize_cmd(seg, Path("out.mp4"), (1920, 1080), fade_black=False)
    assert "anullsrc=r=48000:cl=stereo" in " ".join(cmd)


def test_concat_list_and_cmd(tmp_path: Path) -> None:
    text = concat_list_text([Path("a.mp4"), Path("b.mp4")])
    assert text == "file 'a.mp4'\nfile 'b.mp4'\n"
    cmd = concat_cmd(tmp_path / "list.txt", tmp_path / "out.mp4")
    assert "-f" in cmd and "concat" in cmd and "copy" in cmd


def test_xfade_offsets() -> None:
    # clips de 4 i 3 s, fosa 0.5: un sol offset a 3.5; tres clips: 3.5 i 6.0
    assert xfade_offsets([4.0, 3.0]) == [3.5]
    assert xfade_offsets([4.0, 3.0, 2.0]) == [3.5, 6.0]


def test_xfade_cmd_three_clips() -> None:
    files = [Path(f"{i}.mp4") for i in range(3)]
    cmd = xfade_cmd(files, [4.0, 3.0, 2.0], Path("out.mp4"))
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert fc.count("xfade") == 2 and fc.count("acrossfade") == 2
    assert "offset=3.5" in fc and "offset=6.0" in fc
    assert "[vout]" in fc and "[aout]" in fc


def test_music_cmd_mix_and_fade() -> None:
    cmd = music_cmd(Path("v.mp4"), Path("m.mp3"), Path("o.mp4"),
                    music_vol=80, orig_vol=50, video_dur=10.0)
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "volume=0.80" in fc and "volume=0.50" in fc
    assert "afade=t=out:st=8.000" in fc
    assert "amix=inputs=2:duration=first:normalize=0" in fc
    assert "-stream_loop" in cmd


def test_music_cmd_orig_muted_skips_amix() -> None:
    cmd = music_cmd(Path("v.mp4"), Path("m.mp3"), Path("o.mp4"),
                    music_vol=100, orig_vol=0, video_dur=10.0)
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "amix" not in fc and "[aout]" in fc
```

- [ ] **Step 2: Run** `uv run pytest tests/test_assemble.py -v` → Expected: FAIL (mòdul inexistent)

- [ ] **Step 3: Implementar `src/clip_editor/assemble.py`**

```python
"""Construcció d'ordres ffmpeg per al muntatge (funcions pures, testables)."""
from dataclasses import dataclass
from pathlib import Path

FADE = 0.4        # fosa a negre per segment (s)
XFADE = 0.5       # crossfade entre clips (s)
MUSIC_FADE = 2.0  # fosa de sortida de la música (s)
FPS = 30
ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]


@dataclass(frozen=True)
class Segment:
    """Tros d'un clip d'origen a conservar."""

    src: Path
    start: float
    end: float
    has_audio: bool

    @property
    def duration(self) -> float:
        return self.end - self.start


def target_size(fmt: str, dims: list[tuple[int, int]]) -> tuple[int, int]:
    """Resolució de sortida; en mode auto guanya l'orientació majoritària (empat -> 16:9)."""
    if fmt == "16:9":
        return (1920, 1080)
    if fmt == "9:16":
        return (1080, 1920)
    portrait = sum(1 for w, h in dims if h > w)
    return (1080, 1920) if portrait > len(dims) / 2 else (1920, 1080)


def normalize_cmd(seg: Segment, dst: Path, size: tuple[int, int], fade_black: bool) -> list[str]:
    """Retalla i re-codifica un segment a la resolució objectiu amb fons difuminat."""
    w, h = size
    vf = (
        f"split[a][b];"
        f"[a]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=20[bg];"
        f"[b]scale={w}:{h}:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,fps={FPS},setsar=1"
    )
    afilter = "anull"
    if fade_black:
        out_st = max(seg.duration - FADE, 0)
        vf += f",fade=t=in:st=0:d={FADE},fade=t=out:st={out_st:.3f}:d={FADE}"
        afilter = f"afade=t=in:st=0:d={FADE},afade=t=out:st={out_st:.3f}:d={FADE}"
    cmd = ["ffmpeg", "-y", "-ss", f"{seg.start:.3f}", "-to", f"{seg.end:.3f}", "-i", str(seg.src)]
    if not seg.has_audio:
        cmd += ["-f", "lavfi", "-t", f"{seg.duration:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
    audio_in = "0:a" if seg.has_audio else "1:a"
    cmd += [
        "-filter_complex", f"[0:v]{vf}[v];[{audio_in}]{afilter},aresample=48000[a]",
        "-map", "[v]", "-map", "[a]", *ENCODE,
        "-c:a", "aac", "-ac", "2", "-ar", "48000",
        str(dst),
    ]
    return cmd


def concat_list_text(files: list[Path]) -> str:
    """Contingut del fitxer de llista per al concat demuxer."""
    return "".join(f"file '{p.as_posix()}'\n" for p in files)


def concat_cmd(list_file: Path, dst: Path) -> list[str]:
    """Uneix segments ja normalitzats sense re-codificar."""
    return ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
            "-c", "copy", str(dst)]


def xfade_offsets(durations: list[float], fade: float = XFADE) -> list[float]:
    """Offsets dels crossfades: offset_k = suma(d_0..d_k) - (k+1)*fade."""
    offsets = []
    total = 0.0
    for i, dur in enumerate(durations[:-1]):
        total += dur
        offsets.append(round(total - (i + 1) * fade, 3))
    return offsets


def xfade_cmd(files: list[Path], durations: list[float], dst: Path) -> list[str]:
    """Uneix N segments normalitzats amb crossfade de vídeo i àudio."""
    cmd = ["ffmpeg", "-y"]
    for f in files:
        cmd += ["-i", str(f)]
    n = len(files)
    offsets = xfade_offsets(durations)
    parts = []
    vprev, aprev = "[0:v]", "[0:a]"
    for i in range(1, n):
        vout = f"[v{i}]" if i < n - 1 else "[vout]"
        aout = f"[a{i}]" if i < n - 1 else "[aout]"
        parts.append(f"{vprev}[{i}:v]xfade=transition=fade:duration={XFADE}:offset={offsets[i - 1]}{vout}")
        parts.append(f"{aprev}[{i}:a]acrossfade=d={XFADE}{aout}")
        vprev, aprev = vout, aout
    cmd += ["-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "[aout]",
            *ENCODE, "-c:a", "aac", str(dst)]
    return cmd


def music_cmd(video: Path, music: Path, dst: Path,
              music_vol: int, orig_vol: int, video_dur: float) -> list[str]:
    """Mescla la música (en bucle, amb fosa final) amb el so original del vídeo."""
    mv, ov = music_vol / 100, orig_vol / 100
    fade_st = max(video_dur - MUSIC_FADE, 0)
    mchain = (f"[1:a]atrim=0:{video_dur:.3f},volume={mv:.2f},"
              f"afade=t=out:st={fade_st:.3f}:d={MUSIC_FADE}")
    if ov > 0:
        fc = (f"{mchain}[m];[0:a]volume={ov:.2f}[o];"
              f"[o][m]amix=inputs=2:duration=first:normalize=0[aout]")
    else:
        fc = f"{mchain}[aout]"
    return ["ffmpeg", "-y", "-i", str(video), "-stream_loop", "-1", "-i", str(music),
            "-filter_complex", fc, "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-t", f"{video_dur:.3f}", str(dst)]
```

- [ ] **Step 4: Run** `uv run pytest tests/test_assemble.py -v` → Expected: 10 PASS

- [ ] **Step 5: Commit** — `git add src/clip_editor/assemble.py tests/test_assemble.py && git commit -m "feat: constructors d'ordres ffmpeg (normalitza, concat, xfade, musica)"`

---

### Task 5: Gestor de feines (`jobs.py`)

**Files:**
- Create: `src/clip_editor/jobs.py`
- Test: `tests/test_jobs.py`

- [ ] **Step 1: Test que falla — `tests/test_jobs.py`** (integració real amb ffmpeg, clips sintètics de 2 s)

```python
"""Tests d'integració del pipeline de muntatge amb ffmpeg real."""
import time
from pathlib import Path

from clip_editor.jobs import JobManager
from clip_editor.media import probe, probe_duration
from clip_editor.models import AssembleRequest, SegmentSpec


def _wait(jobs: JobManager, job_id: str, timeout: float = 120.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = jobs.get(job_id)
        if st.status in ("done", "error"):
            return st
        time.sleep(0.3)
    raise TimeoutError("El job no ha acabat a temps")


def _clips_meta(paths: list[Path]) -> dict[str, dict]:
    return {p.stem: {"path": p, **probe(p)} for p in paths}


def test_cut_pipeline(make_clip, tmp_path: Path) -> None:
    a, b = make_clip("a.mp4", color="red"), make_clip("b.mp4", color="blue")
    jobs = JobManager(tmp_path / "ws", tmp_path / "out")
    req = AssembleRequest(order=[SegmentSpec(id="a", start=0, end=1.5),
                                 SegmentSpec(id="b", start=0.5, end=2.0)])
    st = _wait(jobs, jobs.start(req, _clips_meta([a, b]), music_path=None))
    assert st.status == "done", st.error
    out = tmp_path / "out" / "muntatge.mp4"
    assert out.exists()
    assert 2.5 < probe_duration(out) < 3.6  # 1.5 + 1.5


def test_crossfade_pipeline(make_clip, tmp_path: Path) -> None:
    a, b = make_clip("a.mp4"), make_clip("b.mp4", color="green")
    jobs = JobManager(tmp_path / "ws", tmp_path / "out")
    req = AssembleRequest(order=[SegmentSpec(id="a", start=0, end=2.0),
                                 SegmentSpec(id="b", start=0, end=2.0)],
                          transition="crossfade", name="fosa")
    st = _wait(jobs, jobs.start(req, _clips_meta([a, b]), music_path=None))
    assert st.status == "done", st.error
    assert 3.0 < probe_duration(tmp_path / "out" / "fosa.mp4") < 4.1  # 4 - 0.5


def test_error_reported(make_clip, tmp_path: Path) -> None:
    a = make_clip("a.mp4")
    meta = _clips_meta([a])
    meta["a"]["path"] = tmp_path / "inexistent.mp4"  # forcem error d'ffmpeg
    jobs = JobManager(tmp_path / "ws", tmp_path / "out")
    req = AssembleRequest(order=[SegmentSpec(id="a", start=0, end=1.0)])
    st = _wait(jobs, jobs.start(req, meta, music_path=None))
    assert st.status == "error" and st.error
```

- [ ] **Step 2: Run** `uv run pytest tests/test_jobs.py -v` → Expected: FAIL (mòdul inexistent)

- [ ] **Step 3: Implementar `src/clip_editor/jobs.py`**

```python
"""Execució del muntatge en un fil de fons amb estat consultable."""
import logging
import re
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Optional

from . import assemble
from .models import AssembleRequest, JobState

logger = logging.getLogger(__name__)


class JobManager:
    """Gestiona feines de muntatge (una per job_id) i el seu estat."""

    def __init__(self, workspace: Path, output_dir: Path) -> None:
        self.workspace = workspace
        self.output_dir = output_dir
        self._jobs: dict[str, JobState] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> Optional[JobState]:
        with self._lock:
            state = self._jobs.get(job_id)
            return state.model_copy() if state else None

    def start(self, req: AssembleRequest, clips: dict[str, dict],
              music_path: Optional[Path]) -> str:
        job_id = uuid.uuid4().hex[:8]
        with self._lock:
            self._jobs[job_id] = JobState(status="queued")
        threading.Thread(target=self._run, args=(job_id, req, clips, music_path),
                         daemon=True).start()
        return job_id

    def _set(self, job_id: str, **fields) -> None:
        with self._lock:
            self._jobs[job_id] = self._jobs[job_id].model_copy(update=fields)

    def _exec(self, cmd: list[str]) -> None:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding="utf-8", errors="replace")
        if proc.returncode != 0:
            tail = "\n".join(proc.stderr.strip().splitlines()[-8:])
            raise RuntimeError(f"ffmpeg ha fallat:\n{tail}")

    def _run(self, job_id: str, req: AssembleRequest, clips: dict[str, dict],
             music_path: Optional[Path]) -> None:
        tmp = self.workspace / "segments" / job_id
        try:
            self._pipeline(job_id, req, clips, music_path, tmp)
        except Exception as exc:  # els jobs mai han de matar el servidor
            logger.exception("Job %s ha fallat", job_id)
            self._set(job_id, status="error", error=str(exc))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _pipeline(self, job_id: str, req: AssembleRequest, clips: dict[str, dict],
                  music_path: Optional[Path], tmp: Path) -> None:
        tmp.mkdir(parents=True, exist_ok=True)
        segments = [assemble.Segment(src=clips[s.id]["path"], start=s.start,
                                     end=min(s.end, clips[s.id]["duration"]),
                                     has_audio=clips[s.id]["has_audio"])
                    for s in req.order]
        dims = [(clips[s.id]["width"], clips[s.id]["height"]) for s in req.order]
        size = assemble.target_size(req.format, dims)
        total = len(segments) + 1 + (1 if music_path else 0)
        done = 0

        norm_files: list[Path] = []
        for i, seg in enumerate(segments):
            self._set(job_id, status="running", progress=int(done / total * 100),
                      step=f"Normalitzant clip {i + 1}/{len(segments)}")
            out = tmp / f"seg{i:03d}.mp4"
            self._exec(assemble.normalize_cmd(seg, out, size,
                                              fade_black=req.transition == "fadeblack"))
            norm_files.append(out)
            done += 1

        self._set(job_id, progress=int(done / total * 100), step="Unint clips")
        durations = [s.duration for s in segments]
        joined = tmp / "joined.mp4"
        if len(norm_files) == 1:
            shutil.copy(norm_files[0], joined)
        elif req.transition == "crossfade":
            self._exec(assemble.xfade_cmd(norm_files, durations, joined))
        else:
            list_file = tmp / "list.txt"
            list_file.write_text(assemble.concat_list_text(norm_files), encoding="utf-8")
            self._exec(assemble.concat_cmd(list_file, joined))
        done += 1

        video_dur = sum(durations)
        if req.transition == "crossfade" and len(durations) > 1:
            video_dur -= assemble.XFADE * (len(durations) - 1)

        final_src = joined
        if music_path:
            self._set(job_id, progress=int(done / total * 100), step="Afegint música")
            mixed = tmp / "mixed.mp4"
            music = req.music
            self._exec(assemble.music_cmd(joined, music_path, mixed,
                                          music.music_vol, music.orig_vol, video_dur))
            final_src = mixed
            done += 1

        safe_name = re.sub(r"[^\w\- ]", "", req.name).strip() or "muntatge"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        out_path = self.output_dir / f"{safe_name}.mp4"
        shutil.move(str(final_src), out_path)
        self._set(job_id, status="done", progress=100, step="Fet", output=out_path.name)
```

- [ ] **Step 4: Run** `uv run pytest tests/test_jobs.py -v` → Expected: 3 PASS (triga ~20-40 s per l'ffmpeg real)

- [ ] **Step 5: Run tota la suite** `uv run pytest -q` → Expected: tot verd

- [ ] **Step 6: Commit** — `git add src/clip_editor/jobs.py tests/test_jobs.py && git commit -m "feat: pipeline de muntatge en fil de fons amb progres"`

---

### Task 6: API FastAPI (`app.py`)

**Files:**
- Create: `src/clip_editor/app.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Test que falla — `tests/test_api.py`**

```python
"""Tests de l'API amb TestClient i workspace aïllat."""
import importlib
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path, monkeypatch, make_clip):
    monkeypatch.setenv("CLIP_EDITOR_HOME", str(tmp_path))
    import clip_editor.app as app_module
    importlib.reload(app_module)
    with TestClient(app_module.app) as c:
        yield c, make_clip


def _upload(c: TestClient, path: Path) -> dict:
    with path.open("rb") as fh:
        res = c.post("/api/clips", files={"file": (path.name, fh, "video/mp4")})
    assert res.status_code == 200, res.text
    return res.json()


def test_upload_list_delete(client) -> None:
    c, make_clip = client
    info = _upload(c, make_clip("a.mp4"))
    assert info["duration"] > 1 and info["has_audio"]
    assert len(c.get("/api/clips").json()) == 1
    assert c.delete(f"/api/clips/{info['id']}").status_code == 200
    assert c.get("/api/clips").json() == []


def test_upload_bad_extension(client, tmp_path: Path) -> None:
    c, _ = client
    bad = tmp_path / "x.txt"
    bad.write_text("hola")
    with bad.open("rb") as fh:
        res = c.post("/api/clips", files={"file": ("x.txt", fh, "text/plain")})
    assert res.status_code == 400


def test_assemble_validation(client) -> None:
    c, make_clip = client
    info = _upload(c, make_clip("a.mp4"))
    res = c.post("/api/assemble", json={"order": [{"id": "no-existeix", "start": 0, "end": 1}]})
    assert res.status_code == 400
    res = c.post("/api/assemble", json={"order": [{"id": info["id"], "start": 2, "end": 1}]})
    assert res.status_code == 400


def test_assemble_end_to_end(client) -> None:
    c, make_clip = client
    info = _upload(c, make_clip("a.mp4"))
    res = c.post("/api/assemble", json={
        "order": [{"id": info["id"], "start": 0, "end": 1.5}], "name": "prova"})
    assert res.status_code == 200
    job_id = res.json()["job_id"]
    for _ in range(200):
        job = c.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            break
        time.sleep(0.3)
    assert job["status"] == "done", job.get("error")
    assert job["output"] == "prova.mp4"
```

- [ ] **Step 2: Run** `uv run pytest tests/test_api.py -v` → Expected: FAIL (mòdul inexistent)

- [ ] **Step 3: Implementar `src/clip_editor/app.py`**

```python
"""Servidor FastAPI del Clip Editor (API + pàgina estàtica)."""
import logging
import os
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .jobs import JobManager
from .media import MediaError, make_thumbnail, probe, probe_duration
from .models import AssembleRequest, ClipInfo

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
BASE = Path(os.environ.get("CLIP_EDITOR_HOME", _PROJECT_ROOT))
WORKSPACE = BASE / "workspace"
CLIPS_DIR = WORKSPACE / "clips"
MUSIC_DIR = WORKSPACE / "music"
THUMBS_DIR = WORKSPACE / "thumbs"
OUTPUT_DIR = BASE / "OUTPUT"
STATIC_DIR = _PROJECT_ROOT / "static"
VIDEO_EXT = {".mp4", ".mov", ".m4v"}
MUSIC_EXT = {".mp3", ".m4a", ".wav", ".aac", ".ogg"}

for _d in (CLIPS_DIR, MUSIC_DIR, THUMBS_DIR, OUTPUT_DIR):
    _d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Clip Editor")
jobs = JobManager(WORKSPACE, OUTPUT_DIR)
_clips: dict[str, dict] = {}
_music: dict[str, dict] = {}

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/media", StaticFiles(directory=CLIPS_DIR), name="media")
app.mount("/thumbs", StaticFiles(directory=THUMBS_DIR), name="thumbs")
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")


def _rescan() -> None:
    """Recupera clips ja presents al workspace (p. ex. després de reiniciar)."""
    for path in sorted(CLIPS_DIR.iterdir()) if CLIPS_DIR.exists() else []:
        cid = path.stem
        if cid in _clips or path.suffix.lower() not in VIDEO_EXT:
            continue
        try:
            meta = probe(path)
            thumb = THUMBS_DIR / f"{cid}.jpg"
            if not thumb.exists():
                make_thumbnail(path, thumb)
            _clips[cid] = {"path": path, "name": path.name, **meta}
        except MediaError:
            logger.warning("S'ignora un fitxer il·legible del workspace: %s", path.name)


_rescan()


def _clip_info(cid: str) -> ClipInfo:
    c = _clips[cid]
    return ClipInfo(id=cid, name=c["name"], duration=c["duration"], width=c["width"],
                    height=c["height"], has_audio=c["has_audio"],
                    thumb_url=f"/thumbs/{cid}.jpg", media_url=f"/media/{c['path'].name}")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


async def _save_upload(file: UploadFile, dst: Path) -> None:
    with dst.open("wb") as fh:
        while chunk := await file.read(1 << 20):
            fh.write(chunk)


@app.post("/api/clips")
async def upload_clip(file: UploadFile) -> ClipInfo:
    ext = Path(file.filename or "clip.mp4").suffix.lower()
    if ext not in VIDEO_EXT:
        raise HTTPException(400, f"Format de vídeo no admès: {ext or '(sense extensió)'}")
    cid = uuid.uuid4().hex[:8]
    dst = CLIPS_DIR / f"{cid}{ext}"
    await _save_upload(file, dst)
    try:
        meta = probe(dst)
        make_thumbnail(dst, THUMBS_DIR / f"{cid}.jpg")
    except MediaError as exc:
        dst.unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc
    _clips[cid] = {"path": dst, "name": file.filename or dst.name, **meta}
    return _clip_info(cid)


@app.get("/api/clips")
def list_clips() -> list[ClipInfo]:
    return [_clip_info(cid) for cid in _clips]


@app.delete("/api/clips/{cid}")
def delete_clip(cid: str) -> dict:
    clip = _clips.pop(cid, None)
    if clip is None:
        raise HTTPException(404, "Clip desconegut")
    clip["path"].unlink(missing_ok=True)
    (THUMBS_DIR / f"{cid}.jpg").unlink(missing_ok=True)
    return {"ok": True}


@app.post("/api/music")
async def upload_music(file: UploadFile) -> dict:
    ext = Path(file.filename or "music.mp3").suffix.lower()
    if ext not in MUSIC_EXT:
        raise HTTPException(400, f"Format d'àudio no admès: {ext or '(sense extensió)'}")
    mid = uuid.uuid4().hex[:8]
    dst = MUSIC_DIR / f"{mid}{ext}"
    await _save_upload(file, dst)
    try:
        probe_duration(dst)
    except MediaError as exc:
        dst.unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc
    _music[mid] = {"path": dst, "name": file.filename or dst.name}
    return {"id": mid, "name": _music[mid]["name"]}


@app.post("/api/assemble")
def start_assemble(req: AssembleRequest) -> dict:
    unknown = [s.id for s in req.order if s.id not in _clips]
    if unknown:
        raise HTTPException(400, f"Clips desconeguts: {', '.join(unknown)}")
    for seg in req.order:
        if seg.end <= seg.start:
            raise HTTPException(400, f"Interval invàlid al clip {seg.id}: "
                                     f"{seg.start:.1f}–{seg.end:.1f} s")
    music_path = None
    if req.music is not None:
        if req.music.id not in _music:
            raise HTTPException(400, "Música desconeguda")
        music_path = _music[req.music.id]["path"]
    job_id = jobs.start(req, {s.id: _clips[s.id] for s in req.order}, music_path)
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    state = jobs.get(job_id)
    if state is None:
        raise HTTPException(404, "Feina desconeguda")
    return state
```

- [ ] **Step 4: Run** `uv run pytest tests/test_api.py -v` → Expected: 4 PASS

- [ ] **Step 5: Run tota la suite** `uv run pytest -q` → Expected: tot verd

- [ ] **Step 6: Commit** — `git add src/clip_editor/app.py tests/test_api.py && git commit -m "feat: API FastAPI (clips, musica, muntatge, jobs) amb rescan del workspace"`

---

### Task 7: Frontend (`static/`)

**Files:**
- Create: `static/index.html`, `static/style.css`, `static/app.js`

*(El codi complet dels tres fitxers és a l'apèndix A del pla — HTML amb seccions de càrrega/clips/editor/muntatge, CSS minimalista blanc amb un accent blau, i app.js amb: pujada per drag-and-drop i selector, targetes amb miniatura i interval, SortableJS per ordenar, editor de talls amb dos sliders + botons «marca aquí» sincronitzats amb el playhead, pujada de música amb dos volums, POST /api/assemble i polling del job amb barra de progrés i reproductor del resultat.)*

- [ ] **Step 1: Crear els tres fitxers amb el codi de l'apèndix A**
- [ ] **Step 2: Verificar manualment** — `uv run uvicorn --app-dir src clip_editor.app:app --port 8765`, obrir `http://localhost:8765`: la pàgina carrega sense errors de consola i mostra la zona de càrrega.
- [ ] **Step 3: Commit** — `git add static && git commit -m "feat: interficie web (drag-and-drop, talls, musica, progres)"`

---

### Task 8: Llançador i README

**Files:**
- Create: `ClipEditor.bat`, `README.md`

- [ ] **Step 1: Crear `ClipEditor.bat`**

```bat
@echo off
cd /d "%~dp0"
start /b cmd /c "timeout /t 2 >nul & start http://localhost:8765"
uv run uvicorn --app-dir src clip_editor.app:app --host 127.0.0.1 --port 8765
```

- [ ] **Step 2: Crear `README.md`** amb: què és, requisits (ffmpeg al PATH, uv), com engegar (doble clic al .bat), on queden els resultats (`OUTPUT/`), com executar els tests (`uv run pytest`).

- [ ] **Step 3: Commit** — `git add ClipEditor.bat README.md && git commit -m "feat: llancador i README"`

---

### Task 9: Verificació final end-to-end

- [ ] **Step 1: Suite completa** — `uv run pytest -q` → tot verd.
- [ ] **Step 2: Smoke test d'UI amb Playwright** (skill webapp-testing): arrencar el servidor, pujar 2 clips sintètics, reordenar-los, muntar amb crossfade, esperar `done`, comprovar que `OUTPUT/muntatge.mp4` existeix i el reproductor apareix.
- [ ] **Step 3: Prova amb clips reals de l'usuari si n'hi ha de disponibles.**
- [ ] **Step 4: Commit final** — `git commit -m "test: verificacio end-to-end"` (si hi ha canvis).

---

## Apèndix A: codi del frontend

Vegeu els fitxers de la Task 7. El codi complet es va escriure durant la implementació
directament a `static/index.html`, `static/style.css` i `static/app.js` seguint el
disseny de l'espec (seccions: càrrega → clips ordenables → editor de talls → muntatge
amb música/transició/format → progrés → resultat).
