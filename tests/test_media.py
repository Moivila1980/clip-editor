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


def test_probe_duration_matches(make_clip) -> None:
    clip = make_clip("a.mp4", seconds=2.0)
    assert 1.8 < probe_duration(clip) < 2.3
