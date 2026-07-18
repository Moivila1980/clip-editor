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
