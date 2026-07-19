"""Servidor FastAPI del Clip Editor (API + pàgina estàtica)."""
import logging
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel, Field

from . import assemble
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
    for path in sorted(CLIPS_DIR.iterdir()):
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


@app.get("/talls")
def talls_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "talls.html")


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


class CutRequest(BaseModel):
    """Petició de tall individual d'un clip."""

    id: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)


@app.post("/api/cut")
def cut_clip(req: CutRequest) -> ClipInfo:
    """Desa un tall a OUTPUT/talls i el registra com a clip nou per al muntatge."""
    clip = _clips.get(req.id)
    if clip is None:
        raise HTTPException(404, "Clip desconegut")
    if req.end <= req.start:
        raise HTTPException(400, f"Interval invàlid: {req.start:.1f}–{req.end:.1f} s")
    talls_dir = OUTPUT_DIR / "talls"
    talls_dir.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\- ]", "", Path(clip["name"]).stem).strip() or "clip"
    out_name = f"{stem}_tall_{req.start:.1f}-{req.end:.1f}.mp4"
    dst = talls_dir / out_name
    proc = subprocess.run(assemble.cut_cmd(clip["path"], dst, req.start, req.end),
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-5:])
        raise HTTPException(500, f"ffmpeg ha fallat:\n{tail}")
    cid = uuid.uuid4().hex[:8]
    registered = CLIPS_DIR / f"{cid}.mp4"
    shutil.copy(dst, registered)
    meta = probe(registered)
    make_thumbnail(registered, THUMBS_DIR / f"{cid}.jpg")
    _clips[cid] = {"path": registered, "name": out_name, **meta}
    return _clip_info(cid)


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
