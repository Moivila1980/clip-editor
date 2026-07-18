"""Tests de les funcions pures de construcció d'ordres ffmpeg."""
from pathlib import Path

from clip_editor.assemble import (
    Segment,
    concat_cmd,
    concat_list_text,
    music_cmd,
    normalize_cmd,
    target_size,
    xfade_cmd,
    xfade_offsets,
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
