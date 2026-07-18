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
  for (const clip of state.clips) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = clip.id;
    card.innerHTML = `
      <img src="${clip.thumb_url}" alt="">
      <div class="card-info">
        <span class="card-name" title="${clip.name}">${clip.name}</span>
        <span class="card-trim">${clip.start.toFixed(1)}s – ${clip.end.toFixed(1)}s</span>
      </div>
      <button class="del" title="Elimina">✕</button>`;
    card.querySelector(".del").onclick = (e) => { e.stopPropagation(); removeClip(clip.id); };
    card.onclick = () => openEditor(clip.id);
    list.appendChild(card);
  }
  $("assemble").disabled = state.clips.length === 0;
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

// --- ordre (drag & drop de targetes) ---
new Sortable($("clip-list"), {
  animation: 150,
  onEnd: () => {
    const order = [...$("clip-list").children].map((el) => el.dataset.id);
    state.clips.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  },
});

// --- drop de fitxers ---
const drop = $("drop-zone");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); uploadFiles([...e.dataTransfer.files]); };
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

function showError(msg) { const el = $("error"); el.textContent = msg; el.hidden = false; }
function hideError() { $("error").hidden = true; }

// --- estat inicial (clips que ja eren al workspace) ---
(async function init() {
  const res = await fetch("/api/clips");
  state.clips = (await res.json()).map((c) => ({ ...c, start: 0, end: c.duration }));
  renderClips();
})();
