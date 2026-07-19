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
    is_cut: bool = False


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
