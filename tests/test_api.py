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


def test_cut_saves_file_and_registers_clip(client, tmp_path: Path) -> None:
    c, make_clip = client
    info = _upload(c, make_clip("gravacio.mp4"))
    res = c.post("/api/cut", json={"id": info["id"], "start": 0.5, "end": 1.5})
    assert res.status_code == 200, res.text
    new_clip = res.json()
    assert new_clip["name"] == "gravacio_tall_0.5-1.5.mp4"
    assert 0.8 < new_clip["duration"] < 1.4
    saved = tmp_path / "OUTPUT" / "talls" / "gravacio_tall_0.5-1.5.mp4"
    assert saved.exists()
    ids = [cl["id"] for cl in c.get("/api/clips").json()]
    assert new_clip["id"] in ids  # disponible per al muntatge


def test_cut_with_custom_name(client, tmp_path: Path) -> None:
    c, make_clip = client
    info = _upload(c, make_clip("gravacio.mp4"))
    res = c.post("/api/cut", json={"id": info["id"], "start": 0.5, "end": 1.5,
                                   "name": "esquena millor!"})
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "esquena millor.mp4"  # sanejat
    assert res.json()["is_cut"] is True
    assert (tmp_path / "OUTPUT" / "talls" / "esquena millor.mp4").exists()


def test_delete_cut_clip_removes_output_file(client, tmp_path: Path) -> None:
    c, make_clip = client
    info = _upload(c, make_clip("gravacio.mp4"))
    cut = c.post("/api/cut", json={"id": info["id"], "start": 0.5, "end": 1.5}).json()
    saved = tmp_path / "OUTPUT" / "talls" / cut["name"]
    assert saved.exists()
    assert c.delete(f"/api/clips/{cut['id']}").status_code == 200
    assert not saved.exists()


def test_cut_validation(client) -> None:
    c, make_clip = client
    info = _upload(c, make_clip("a.mp4"))
    assert c.post("/api/cut", json={"id": "no", "start": 0, "end": 1}).status_code == 404
    assert c.post("/api/cut", json={"id": info["id"], "start": 2, "end": 1}).status_code == 400


def test_assemble_end_to_end(client) -> None:
    c, make_clip = client
    info = _upload(c, make_clip("a.mp4"))
    res = c.post("/api/assemble", json={
        "order": [{"id": info["id"], "start": 0, "end": 1.5}], "name": "prova"})
    assert res.status_code == 200, res.text
    job_id = res.json()["job_id"]
    job = {}
    for _ in range(200):
        job = c.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            break
        time.sleep(0.3)
    assert job["status"] == "done", job.get("error")
    assert job["output"] == "prova.mp4"
