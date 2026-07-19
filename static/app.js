"use strict";

const state = { clips: [], music: null };
const $ = (id) => document.getElementById(id);

// --- càrrega de clips ---
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
  state.clips.forEach((clip, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = clip.id;
    card.innerHTML = `
      <span class="ord">${i + 1}</span>
      <img src="${clip.thumb_url}" alt="" draggable="false">
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
  $("seq-play").disabled = state.clips.length === 0;
}

// --- previsualització de la seqüència (encadena els clips en l'ordre actual) ---
let seqToken = 0;

function stopSequence() {
  seqToken++;
  const v = $("seq-video");
  v.pause();
  v.hidden = true;
  $("seq-stop").hidden = true;
  $("seq-play").hidden = false;
  $("seq-label").textContent = "";
}

async function playSequence() {
  const token = ++seqToken;
  const v = $("seq-video");
  v.hidden = false;
  $("seq-play").hidden = true;
  $("seq-stop").hidden = false;
  for (let i = 0; i < state.clips.length; i++) {
    if (token !== seqToken) return;
    const clip = state.clips[i];
    $("seq-label").textContent = `▶ ${i + 1}/${state.clips.length}: ${clip.name}`;
    await playClipRange(v, clip.media_url, clip.start, clip.end, () => token !== seqToken);
  }
  if (token === seqToken) stopSequence();
}

function playClipRange(v, src, start, end, cancelled) {
  return new Promise((resolve) => {
    const cleanup = () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onDone);
      resolve();
    };
    const onTime = () => {
      if (cancelled() || v.currentTime >= end - 0.05) { v.pause(); cleanup(); }
    };
    const onDone = () => cleanup();
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onDone);
    v.src = src;
    v.addEventListener("loadedmetadata", () => {
      v.currentTime = start;
      v.play().catch(() => cleanup());
    }, { once: true });
  });
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
  if (e.dataTransfer && e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]);
});
$("file-input").onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ""; };

// --- música ---
$("music-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/music", { method: "POST", body: fd });
  if (!res.ok) {
    showError((await res.json()).detail || "Error amb la música");
    return;
  }
  state.music = await res.json();
  $("music-name").textContent = "🎵 " + state.music.name;
  e.target.value = "";
};

// --- muntatge ---
$("assemble").onclick = async () => {
  hideError();
  $("result").hidden = true;
  const body = {
    order: state.clips.map((c) => ({ id: c.id, start: c.start, end: c.end })),
    transition: $("transition").value,
    format: $("format").value,
    name: $("out-name").value.trim() || "muntatge",
    music: state.music
      ? { id: state.music.id, music_vol: +$("music-vol").value, orig_vol: +$("orig-vol").value }
      : null,
  };
  const res = await fetch("/api/assemble", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    showError((await res.json()).detail || "No s'ha pogut començar el muntatge");
    return;
  }
  const { job_id } = await res.json();
  $("progress").hidden = false;
  $("assemble").disabled = true;
  pollJob(job_id);
};

async function pollJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}`);
  const job = await res.json();
  $("progress-bar").style.width = job.progress + "%";
  $("progress-text").textContent = `${job.step || "En cua"} (${job.progress}%)`;
  if (job.status === "done") {
    $("progress").hidden = true;
    $("assemble").disabled = false;
    $("result").hidden = false;
    $("result-video").src = `/output/${job.output}?t=${Date.now()}`;
    $("result-path").textContent = "Desat a OUTPUT\\" + job.output;
  } else if (job.status === "error") {
    $("progress").hidden = true;
    $("assemble").disabled = false;
    showError(job.error || "Error desconegut durant el muntatge");
  } else {
    setTimeout(() => pollJob(jobId), 1000);
  }
}

$("seq-play").onclick = playSequence;
$("seq-stop").onclick = stopSequence;

function showError(msg) { const el = $("error"); el.textContent = msg; el.hidden = false; }
function hideError() { $("error").hidden = true; }

// --- estat inicial (clips que ja eren al workspace) ---
(async function init() {
  const res = await fetch("/api/clips");
  state.clips = (await res.json()).map((c) => ({ ...c, start: 0, end: c.duration }));
  renderClips();
})();
