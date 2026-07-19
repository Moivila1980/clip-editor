"use strict";

/* Pàgina «Tallar» de la PWA: reprodueix, marca inici, marca final i talla.
   Cada tall es descarrega i es pot eliminar de la llista. */
const state = { clips: [] };
const $ = (id) => document.getElementById(id);
let nextId = 1;

function readMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () =>
      resolve({ url, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No es pot llegir " + file.name)); };
    v.src = url;
  });
}

function makeThumb(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, v.duration / 2); };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      const scale = 320 / (v.videoWidth || 320);
      c.width = 320;
      c.height = Math.max(1, Math.round((v.videoHeight || 180) * scale));
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    v.onerror = () => resolve("");
    v.src = url;
  });
}

async function addFiles(files) {
  hideError();
  $("upload-status").hidden = false;
  for (const file of files) {
    if (!/\.(mp4|mov|m4v)$/i.test(file.name)) {
      showError("Format no admès: " + file.name);
      continue;
    }
    try {
      const meta = await readMeta(file);
      const thumb = await makeThumb(meta.url);
      state.clips.push({
        id: "c" + nextId++, file, name: file.name, url: meta.url, thumb,
        duration: meta.duration, start: 0, end: meta.duration,
      });
    } catch (err) {
      showError(err.message);
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
      <img src="${clip.thumb}" alt="">
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

function removeClip(id) {
  const clip = state.clips.find((c) => c.id === id);
  if (clip) URL.revokeObjectURL(clip.url);
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
  $("preview").src = editing.url;
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

// --- tallar (wasm) i llista de talls ---
$("do-cut").onclick = async () => {
  if (!editing) return;
  hideError();
  $("progress").hidden = false;
  $("do-cut").disabled = true;
  const clip = editing;
  const custom = $("cut-name").value.replace(/[^\w\- ]/g, "").trim();
  const stem = clip.name.replace(/\.\w+$/, "").replace(/[^\w\- ]/g, "") || "clip";
  const outName = custom
    ? `${custom}.mp4`
    : `${stem}_tall_${clip.start.toFixed(1)}-${clip.end.toFixed(1)}.mp4`;
  try {
    const blob = await Engine.cut(
      clip.file, clip.start, clip.end,
      (msg) => { $("status").textContent = msg; },
      (pct) => {
        $("progress-bar").style.width = pct + "%";
        $("progress-text").textContent = pct + "%";
      },
    );
    addSaved(outName, blob);
    $("cut-name").value = "";
    marks = { start: false, end: false };
    updateCutUI("Tall fet ✔ Pots marcar un altre tros del mateix vídeo i tornar a tallar.");
  } catch (err) {
    showError(err.message || String(err));
    $("do-cut").disabled = false;
  } finally {
    $("progress").hidden = true;
    $("status").textContent = "";
  }
};

function addSaved(outName, blob) {
  const url = URL.createObjectURL(blob);
  $("saved-section").hidden = false;
  const li = document.createElement("li");
  li.innerHTML = `✂ <a href="${url}" download="${outName}">${outName}</a>
    <small>(${(blob.size / 1048576).toFixed(1)} MB — clica per descarregar)</small>
    <button class="ren-saved" title="Canvia el nom">✏</button>
    <button class="del-saved" title="Elimina aquest tall">✕</button>`;
  li.querySelector(".ren-saved").onclick = () => {
    const a = li.querySelector("a");
    const current = a.getAttribute("download").replace(/\.mp4$/i, "");
    const name = prompt("Nou nom del tall:", current);
    if (!name || !name.trim()) return;
    const clean = name.replace(/[^\w\- ]/g, "").trim();
    if (!clean) return;
    a.setAttribute("download", clean + ".mp4");
    a.textContent = clean + ".mp4";
  };
  li.querySelector(".del-saved").onclick = () => {
    URL.revokeObjectURL(url);
    li.remove();
    if (!$("saved-list").children.length) $("saved-section").hidden = true;
  };
  li.querySelector("a").click();
  $("saved-list").appendChild(li);
}

// --- drop de fitxers ---
const drop = $("drop-zone");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); };
$("file-input").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };

function showError(msg) { const el = $("error"); el.textContent = msg; el.hidden = false; }
function hideError() { $("error").hidden = true; }

// --- PWA ---
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
