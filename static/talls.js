"use strict";

/* Pàgina «Tallar»: retallar cada clip per separat i desar-lo com a fitxer nou. */
const state = { clips: [] };
const $ = (id) => document.getElementById(id);

function isCut(clip) {
  return clip.name.includes("_tall_");
}

async function uploadFiles(files) {
  $("upload-status").hidden = false;
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/clips", { method: "POST", body: fd });
      if (!res.ok) {
        showError((await res.json()).detail || "Error pujant " + file.name);
        continue;
      }
      const info = await res.json();
      state.clips.push({ ...info, start: 0, end: info.duration, saved: false });
    } catch (err) {
      showError("Error de connexió pujant " + file.name);
    }
  }
  $("upload-status").hidden = true;
  renderClips();
}

function renderClips() {
  const list = $("clip-list");
  list.innerHTML = "";
  for (const clip of state.clips) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = clip.id;
    const marked = clip.start > 0 || clip.end < clip.duration;
    card.innerHTML = `
      <img src="${clip.thumb_url}" alt="">
      <div class="card-info">
        <span class="card-name" title="${clip.name}">${clip.name}</span>
        <span class="card-trim">${marked ? `✂ ${clip.start.toFixed(1)}s – ${clip.end.toFixed(1)}s` : "sense tall"}</span>
      </div>
      <button class="del" title="Elimina">✕</button>`;
    card.querySelector(".del").onclick = (e) => { e.stopPropagation(); removeClip(clip.id); };
    card.onclick = () => openEditor(clip.id);
    list.appendChild(card);
  }
  $("save-all").disabled = !state.clips.some((c) => c.start > 0 || c.end < c.duration);
}

async function removeClip(id) {
  await fetch(`/api/clips/${id}`, { method: "DELETE" });
  state.clips = state.clips.filter((c) => c.id !== id);
  if (editing && editing.id === id) closeEditor();
  renderClips();
}

// --- editor de talls ---
let editing = null;

function openEditor(id) {
  editing = state.clips.find((c) => c.id === id);
  if (!editing) return;
  $("editor").hidden = false;
  $("editor-title").textContent = "Tallar: " + editing.name;
  $("preview").src = editing.media_url;
  $("trim-start").max = editing.duration.toFixed(1);
  $("trim-end").max = editing.duration.toFixed(1);
  $("trim-start").value = editing.start;
  $("trim-end").value = editing.end;
  updateTrimLabels();
  $("editor").scrollIntoView({ behavior: "smooth" });
}

function closeEditor() {
  $("editor").hidden = true;
  $("preview").pause();
  editing = null;
}

function updateTrimLabels() {
  $("start-val").textContent = Number($("trim-start").value).toFixed(1);
  $("end-val").textContent = Number($("trim-end").value).toFixed(1);
}

function applyTrim(which) {
  if (!editing) return;
  let s = Number($("trim-start").value);
  let e = Number($("trim-end").value);
  if (which === "start" && s >= e) { s = Math.max(0, e - 0.1); $("trim-start").value = s; }
  if (which === "end" && e <= s) { e = Math.min(editing.duration, s + 0.1); $("trim-end").value = e; }
  editing.start = s;
  editing.end = e;
  updateTrimLabels();
  $("preview").currentTime = which === "start" ? s : e;
  renderClips();
}

$("trim-start").oninput = () => applyTrim("start");
$("trim-end").oninput = () => applyTrim("end");
$("set-start").onclick = () => { $("trim-start").value = $("preview").currentTime.toFixed(1); applyTrim("start"); };
$("set-end").onclick = () => { $("trim-end").value = $("preview").currentTime.toFixed(1); applyTrim("end"); };
$("close-editor").onclick = closeEditor;

// --- desar talls ---
async function saveCut(clip) {
  const res = await fetch("/api/cut", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: clip.id, start: clip.start, end: clip.end }),
  });
  if (!res.ok) {
    showError((await res.json()).detail || "No s'ha pogut desar el tall de " + clip.name);
    return null;
  }
  return res.json();
}

function addSaved(info) {
  $("saved-section").hidden = false;
  const li = document.createElement("li");
  li.innerHTML = `✂ <a href="/output/talls/${encodeURIComponent(info.name)}" download>${info.name}</a>
    <small>(${info.duration.toFixed(1)} s — clica per descarregar)</small>`;
  $("saved-list").appendChild(li);
}

$("save-cut").onclick = async () => {
  if (!editing) return;
  hideError();
  const info = await saveCut(editing);
  if (info) addSaved(info);
};

$("save-all").onclick = async () => {
  hideError();
  let count = 0;
  for (const clip of state.clips) {
    if (clip.start > 0 || clip.end < clip.duration) {
      const info = await saveCut(clip);
      if (info) count++;
      if (info) addSaved(info);
    }
  }
  if (count === 0) showError("Cap clip té un tall marcat (mou els controls d'inici/fi primer)");
};

// --- drop de fitxers ---
const drop = $("drop-zone");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); uploadFiles([...e.dataTransfer.files]); };
$("file-input").onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ""; };

function showError(msg) { const el = $("error"); el.textContent = msg; el.hidden = false; }
function hideError() { $("error").hidden = true; }

// --- estat inicial: originals ja pujats (s'amaguen els talls ja fets) ---
(async function init() {
  const res = await fetch("/api/clips");
  state.clips = (await res.json())
    .filter((c) => !isCut(c))
    .map((c) => ({ ...c, start: 0, end: c.duration }));
  renderClips();
})();
