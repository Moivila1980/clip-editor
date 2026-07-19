"use strict";

/* Pàgina «Tallar»: reprodueix, marca inici, marca final i talla.
   Cada tall es desa com a fitxer nou i es pot eliminar de la llista. */
const state = { clips: [] };
const $ = (id) => document.getElementById(id);

function isCut(clip) {
  return clip.is_cut || clip.name.includes("_tall_");
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
      state.clips.push({ ...info, start: 0, end: info.duration });
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
    card.innerHTML = `
      <img src="${clip.thumb_url}" alt="">
      <div class="card-info">
        <span class="card-name" title="${clip.name}">${clip.name}</span>
        <span class="card-trim">▶ ${clip.duration.toFixed(1)} s</span>
      </div>
      <button class="del" title="Elimina">✕</button>`;
    card.querySelector(".del").onclick = (e) => { e.stopPropagation(); removeClip(clip.id); };
    card.onclick = () => openEditor(clip.id);
    list.appendChild(card);
  }
}

async function removeClip(id) {
  await fetch(`/api/clips/${id}`, { method: "DELETE" });
  state.clips = state.clips.filter((c) => c.id !== id);
  if (editing && editing.id === id) closeEditor();
  renderClips();
}

// --- editor: marcar inici, marcar final, tallar ---
let editing = null;
let marks = { start: false, end: false };

function openEditor(id) {
  editing = state.clips.find((c) => c.id === id);
  if (!editing) return;
  marks = { start: false, end: false };
  editing.start = 0;
  editing.end = editing.duration;
  $("editor").hidden = false;
  $("editor-title").textContent = "Tallar: " + editing.name;
  $("preview").src = editing.media_url;
  $("trim-start").max = editing.duration.toFixed(1);
  $("trim-end").max = editing.duration.toFixed(1);
  $("trim-start").value = 0;
  $("trim-end").value = editing.duration;
  updateCutUI("Reprodueix el vídeo i prem «Marca l'inici» on comenci el tros que vols conservar.");
  $("editor").scrollIntoView({ behavior: "smooth" });
}

function closeEditor() {
  $("editor").hidden = true;
  $("preview").pause();
  editing = null;
}

function updateCutUI(message) {
  $("start-val").textContent = editing.start.toFixed(1);
  $("end-val").textContent = editing.end.toFixed(1);
  $("do-cut").disabled = !(marks.start && marks.end && editing.end > editing.start);
  if (message !== undefined) {
    $("cut-info").textContent = message;
    return;
  }
  const len = (editing.end - editing.start).toFixed(1);
  if (marks.start && marks.end) {
    $("cut-info").textContent =
      `Tall marcat: ${editing.start.toFixed(1)} s → ${editing.end.toFixed(1)} s (${len} s). Prem «✂ Talla».`;
  } else if (marks.start) {
    $("cut-info").textContent =
      `Inici marcat a ${editing.start.toFixed(1)} s. Continua reproduint i prem «Marca el final».`;
  }
}

$("mark-start").onclick = () => {
  if (!editing) return;
  editing.start = Math.round($("preview").currentTime * 10) / 10;
  if (editing.end <= editing.start) editing.end = editing.duration;
  marks.start = true;
  $("trim-start").value = editing.start;
  $("trim-end").value = editing.end;
  updateCutUI();
};

$("mark-end").onclick = () => {
  if (!editing) return;
  const t = Math.round($("preview").currentTime * 10) / 10;
  if (t <= editing.start) {
    updateCutUI("El final ha d'anar després de l'inici — avança el vídeo i torna a marcar.");
    return;
  }
  editing.end = t;
  marks.end = true;
  $("trim-end").value = editing.end;
  updateCutUI();
};

$("trim-start").oninput = () => {
  if (!editing) return;
  let s = Number($("trim-start").value);
  if (s >= editing.end) { s = Math.max(0, editing.end - 0.1); $("trim-start").value = s; }
  editing.start = s;
  marks.start = true;
  $("preview").currentTime = s;
  updateCutUI();
};

$("trim-end").oninput = () => {
  if (!editing) return;
  let e = Number($("trim-end").value);
  if (e <= editing.start) { e = Math.min(editing.duration, editing.start + 0.1); $("trim-end").value = e; }
  editing.end = e;
  marks.end = true;
  $("preview").currentTime = e;
  updateCutUI();
};

$("close-editor").onclick = closeEditor;

// --- tallar i llista de talls ---
$("do-cut").onclick = async () => {
  if (!editing) return;
  hideError();
  $("do-cut").disabled = true;
  const res = await fetch("/api/cut", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: editing.id, start: editing.start, end: editing.end,
                           name: $("cut-name").value }),
  });
  if (!res.ok) {
    showError((await res.json()).detail || "No s'ha pogut desar el tall");
    $("do-cut").disabled = false;
    return;
  }
  addSaved(await res.json());
  $("cut-name").value = "";
  marks = { start: false, end: false };
  updateCutUI("Tall desat ✔ Pots marcar un altre tros del mateix vídeo i tornar a tallar.");
};

function addSaved(info) {
  $("saved-section").hidden = false;
  const li = document.createElement("li");
  li.dataset.id = info.id;
  li.innerHTML = `✂ <a href="/output/talls/${encodeURIComponent(info.name)}" download>${info.name}</a>
    <small>(${info.duration.toFixed(1)} s — clica per descarregar)</small>
    <button class="ren-saved" title="Canvia el nom">✏</button>
    <button class="del-saved" title="Elimina aquest tall">✕</button>`;
  li.querySelector(".ren-saved").onclick = async () => {
    const a = li.querySelector("a");
    const current = a.textContent.replace(/\.mp4$/i, "");
    const name = prompt("Nou nom del tall:", current);
    if (!name || !name.trim() || name.trim() === current) return;
    const res = await fetch(`/api/clips/${info.id}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      showError((await res.json()).detail || "No s'ha pogut canviar el nom");
      return;
    }
    const updated = await res.json();
    a.textContent = updated.name;
    a.href = "/output/talls/" + encodeURIComponent(updated.name);
  };
  li.querySelector(".del-saved").onclick = async () => {
    await fetch(`/api/clips/${info.id}`, { method: "DELETE" });
    li.remove();
    if (!$("saved-list").children.length) $("saved-section").hidden = true;
  };
  $("saved-list").appendChild(li);
}

// --- drop de fitxers ---
const drop = $("drop-zone");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); uploadFiles([...e.dataTransfer.files]); };
$("file-input").onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ""; };

function showError(msg) { const el = $("error"); el.textContent = msg; el.hidden = false; }
function hideError() { $("error").hidden = true; }

// --- estat inicial: originals ja pujats (talls existents a la llista de desats) ---
(async function init() {
  const res = await fetch("/api/clips");
  const all = await res.json();
  state.clips = all.filter((c) => !isCut(c)).map((c) => ({ ...c, start: 0, end: c.duration }));
  for (const cut of all.filter(isCut)) addSaved(cut);
  renderClips();
})();
