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

        self._set(job_id, status="running", progress=int(done / total * 100),
                  step="Unint clips")
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
        if music_path and req.music is not None:
            self._set(job_id, status="running", progress=int(done / total * 100),
                      step="Afegint música")
            mixed = tmp / "mixed.mp4"
            self._exec(assemble.music_cmd(joined, music_path, mixed,
                                          req.music.music_vol, req.music.orig_vol,
                                          video_dur))
            final_src = mixed
            done += 1

        safe_name = re.sub(r"[^\w\- ]", "", req.name).strip() or "muntatge"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        out_path = self.output_dir / f"{safe_name}.mp4"
        shutil.move(str(final_src), out_path)
        self._set(job_id, status="done", progress=100, step="Fet", output=out_path.name)
