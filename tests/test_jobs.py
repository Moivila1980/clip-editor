"""Tests d'integració del pipeline de muntatge amb ffmpeg real."""
import time
from pathlib import Path

from clip_editor.jobs import JobManager
from clip_editor.media import probe, probe_duration
from clip_editor.models import AssembleRequest, JobState, SegmentSpec


def _wait(jobs: JobManager, job_id: str, timeout: float = 120.0) -> JobState:
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = jobs.get(job_id)
        if state and state.status in ("done", "error"):
            return state
        time.sleep(0.3)
    raise TimeoutError("El job no ha acabat a temps")


def _clips_meta(paths: list[Path]) -> dict[str, dict]:
    return {p.stem: {"path": p, **probe(p)} for p in paths}


def test_cut_pipeline(make_clip, tmp_path: Path) -> None:
    a, b = make_clip("a.mp4", color="red"), make_clip("b.mp4", color="blue")
    jobs = JobManager(tmp_path / "ws", tmp_path / "out")
    req = AssembleRequest(order=[SegmentSpec(id="a", start=0, end=1.5),
                                 SegmentSpec(id="b", start=0.5, end=2.0)])
    state = _wait(jobs, jobs.start(req, _clips_meta([a, b]), music_path=None))
    assert state.status == "done", state.error
    out = tmp_path / "out" / "muntatge.mp4"
    assert out.exists()
    assert 2.5 < probe_duration(out) < 3.6  # 1.5 + 1.5


def test_crossfade_pipeline(make_clip, tmp_path: Path) -> None:
    a, b = make_clip("a.mp4"), make_clip("b.mp4", color="green")
    jobs = JobManager(tmp_path / "ws", tmp_path / "out")
    req = AssembleRequest(order=[SegmentSpec(id="a", start=0, end=2.0),
                                 SegmentSpec(id="b", start=0, end=2.0)],
                          transition="crossfade", name="fosa")
    state = _wait(jobs, jobs.start(req, _clips_meta([a, b]), music_path=None))
    assert state.status == "done", state.error
    assert 3.0 < probe_duration(tmp_path / "out" / "fosa.mp4") < 4.1  # 4 - 0.5


def test_fadeblack_mixed_orientation(make_clip, tmp_path: Path) -> None:
    a = make_clip("a.mp4", portrait=True)
    b = make_clip("b.mp4", color="blue")
    jobs = JobManager(tmp_path / "ws", tmp_path / "out")
    req = AssembleRequest(order=[SegmentSpec(id="a", start=0, end=2.0),
                                 SegmentSpec(id="b", start=0, end=2.0)],
                          transition="fadeblack", format="16:9", name="mixt")
    state = _wait(jobs, jobs.start(req, _clips_meta([a, b]), music_path=None))
    assert state.status == "done", state.error
    meta = probe(tmp_path / "out" / "mixt.mp4")
    assert meta["width"] == 1920 and meta["height"] == 1080


def test_error_reported(make_clip, tmp_path: Path) -> None:
    a = make_clip("a.mp4")
    meta = _clips_meta([a])
    meta["a"]["path"] = tmp_path / "inexistent.mp4"  # forcem error d'ffmpeg
    jobs = JobManager(tmp_path / "ws", tmp_path / "out")
    req = AssembleRequest(order=[SegmentSpec(id="a", start=0, end=1.0)])
    state = _wait(jobs, jobs.start(req, meta, music_path=None))
    assert state.status == "error" and state.error
