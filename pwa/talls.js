"use strict";

/* Pàgina «Tallar» de la PWA: retallar cada clip per separat i descarregar-lo. */
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
    const marked = clip.start > 0 || clip.end < clip.duration;
    card.innerHTML = `
      <img src="${clip.thumb}" alt="">
      <div class="card-info">
        <span class="card-name" title="${clip.name}">${clip.name}</span>
        <span class="card-trim">${marked ? `✂ ${clip.start.toFixed(1)}s – ${clip.end.toFixed(1)}s` : "sense tall"}</span>
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

// --- editor de talls ---
let editing = null;

function openEditor(id) {
  editing = state.clips.find((c) => c.id === id);
  if (!editing) return;
  $("editor").hidden = false;
  $("editor-title").textContent = "Tallar: " + editing.name;
  $("preview").src = editing.url;
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

// --- tallar i descarregar ---
$("save-cut").onclick = async () => {
  if (!editing) return;
  hideError();
  $("progress").hidden = false;
  $("save-cut").disabled = true;
  const clip = editing;
  const stem = clip.name.replace(/\.\w+$/, "").replace(/[^\w\- ]/g, "") || "clip";
  const outName = `${stem}_tall_${clip.start.toFixed(1)}-${clip.end.toFixed(1)}.mp4`;
  try {
    const blob = await Engine.cut(
      clip.file, clip.start, clip.end,
      (msg) => { $("status").textContent = msg; },
      (pct) => {
        $("progress-bar").style.width = pct + "%";
        $("progress-text").textContent = pct + "%";
      },
    );
    const url = URL.createObjectURL(blob);
    $("saved-section").hidden = false;
    const li = document.createElement("li");
    li.innerHTML = `✂ <a href="${url}" download="${outName}">${outName}</a>
      <small>(${(blob.size / 1048576).toFixed(1)} MB — clica per descarregar)</small>`;
    $("saved-list").appendChild(li);
    li.querySelector("a").click();
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    $("progress").hidden = true;
    $("save-cut").disabled = false;
    $("status").textContent = "";
  }
};

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
