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


def cut_cmd(src: Path, dst: Path, start: float, end: float) -> list[str]:
    """Retalla un tros amb precisió de fotograma mantenint resolució i orientació originals."""
    return ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(src),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-c:a", "aac", str(dst)]


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
