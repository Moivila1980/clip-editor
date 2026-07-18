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
