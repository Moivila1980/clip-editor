"use strict";

/* UI de la PWA: tot es processa en local, al navegador. */
const state = { clips: [], music: null };
const $ = (id) => document.getElementById(id);
let nextId = 1;

// --- lectura de metadades i miniatures (sense servidor) ---
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
        duration: meta.duration, width: meta.width, height: meta.height,
        start: 0, end: meta.duration,
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
  state.clips.forEach((clip, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = clip.id;
    card.innerHTML = `
      <span class="ord">${i + 1}</span>
      <img src="${clip.thumb}" alt="" draggable="false">
      <div class="card-info">
        <span class="card-name" title="${clip.name}">${clip.name}</span>
        <span class="card-trim">${clip.start.toFixed(1)}s – ${clip.end.toFixed(1)}s</span>
      </div>
      <button class="del" title="Treu del muntatge">✕</button>`;
    card.querySelector(".del").onclick = (e) => { e.stopPropagation(); removeClip(clip.id); };
    card.onclick = () => openEditor(clip.id);
    list.appendChild(card);
  });
  $("assemble").disabled = state.clips.length === 0;
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

// --- ordre (drag & drop de targetes, ratolí i tàctil) ---
new Sortable($("clip-list"), {
  animation: 150,
  ghostClass: "sortable-ghost",
  delayOnTouchOnly: 150,
  touchStartThreshold: 4,
  onEnd: () => {
    const order = [...$("clip-list").children].map((el) => el.dataset.id);
    state.clips.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    renderClips(); // renumera 1, 2, 3…
  },
});

// --- drop de fitxers: funciona a TOTA la pàgina ---
const drop = $("drop-zone");
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) drop.classList.add("over");
});
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) drop.classList.remove("over"); });
document.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
});
$("file-input").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };

// --- música ---
$("music-input").onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.music = file;
  $("music-name").textContent = "🎵 " + file.name;
  e.target.value = "";
};

// --- muntatge ---
$("assemble").onclick = async () => {
  hideError();
  $("result").hidden = true;
  $("progress").hidden = false;
  $("assemble").disabled = true;
  const name = ($("out-name").value.trim() || "muntatge").replace(/[^\w\- ]/g, "") || "muntatge";
  try {
    const blob = await Engine.assemble(
      state.clips.map((c) => ({ file: c.file, start: c.start, end: c.end,
                                width: c.width, height: c.height })),
      {
        transition: $("transition").value,
        format: $("format").value,
        musicFile: state.music,
        musicVol: +$("music-vol").value,
        origVol: +$("orig-vol").value,
      },
      (msg) => { $("status").textContent = msg; },
      (pct) => {
        $("progress-bar").style.width = pct + "%";
        $("progress-text").textContent = pct + "%";
      },
    );
    const url = URL.createObjectURL(blob);
    $("result").hidden = false;
    $("result-video").src = url;
    const dl = $("download");
    dl.href = url;
    dl.download = name + ".mp4";
    $("result-path").textContent = `${name}.mp4 (${(blob.size / 1048576).toFixed(1)} MB)`;
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    $("progress").hidden = true;
    $("assemble").disabled = false;
    $("status").textContent = "";
  }
};

function showError(msg) { const el = $("error"); el.textContent = msg; el.hidden = false; }
function hideError() { $("error").hidden = true; }

// --- PWA ---
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
