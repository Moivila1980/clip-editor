"use strict";

/* Motor de vídeo dins del navegador (ffmpeg.wasm, un sol fil).
   Rèplica de la lògica de src/clip_editor/assemble.py a resolució 720p. */
const Engine = (() => {
  const FADE = 0.4;
  const XFADE = 0.5;
  const MUSIC_FADE = 2.0;
  const FPS = 30;
  const ENCODE = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p"];

  let ffmpeg = null;
  let logBuf = [];

  async function fileToBytes(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  async function load(onStatus) {
    if (ffmpeg) return;
    onStatus("Carregant el motor de vídeo (32 MB, només el primer cop)…");
    const { FFmpeg } = FFmpegWASM;
    const instance = new FFmpeg();
    instance.on("log", ({ message }) => logBuf.push(message));
    const base = new URL("vendor/", location.href).toString();
    await instance.load({
      coreURL: base + "ffmpeg-core.js",
      wasmURL: base + "ffmpeg-core.wasm",
    });
    ffmpeg = instance;
    onStatus("");
  }

  async function probeHasAudio(name) {
    logBuf = [];
    await ffmpeg.exec(["-hide_banner", "-i", name]);
    return logBuf.some((line) => /Stream #0:\d+.*Audio/.test(line));
  }

  function targetSize(fmt, dims) {
    if (fmt === "16:9") return [1280, 720];
    if (fmt === "9:16") return [720, 1280];
    const portrait = dims.filter(([w, h]) => h > w).length;
    return portrait > dims.length / 2 ? [720, 1280] : [1280, 720];
  }

  function normalizeArgs(inName, outName, start, end, size, hasAudio, fadeBlack) {
    const [w, h] = size;
    const dur = end - start;
    let vf =
      `split[a][b];` +
      `[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20[bg];` +
      `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${FPS},setsar=1`;
    let af = "anull";
    if (fadeBlack) {
      const st = Math.max(dur - FADE, 0).toFixed(3);
      vf += `,fade=t=in:st=0:d=${FADE},fade=t=out:st=${st}:d=${FADE}`;
      af = `afade=t=in:st=0:d=${FADE},afade=t=out:st=${st}:d=${FADE}`;
    }
    const args = ["-y", "-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", inName];
    if (!hasAudio) args.push("-f", "lavfi", "-t", dur.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
    const audioIn = hasAudio ? "0:a" : "1:a";
    args.push(
      "-filter_complex", `[0:v]${vf}[v];[${audioIn}]${af},aresample=48000[a]`,
      "-map", "[v]", "-map", "[a]", ...ENCODE,
      "-c:a", "aac", "-ac", "2", "-ar", "48000", outName,
    );
    return args;
  }

  function concatListText(files) {
    return files.map((f) => `file '${f}'`).join("\n") + "\n";
  }

  function xfadeOffsets(durations) {
    const offsets = [];
    let total = 0;
    for (let i = 0; i < durations.length - 1; i++) {
      total += durations[i];
      offsets.push(Math.round((total - (i + 1) * XFADE) * 1000) / 1000);
    }
    return offsets;
  }

  function xfadeArgs(files, durations, outName) {
    const args = ["-y"];
    for (const f of files) args.push("-i", f);
    const n = files.length;
    const offsets = xfadeOffsets(durations);
    const parts = [];
    let vprev = "[0:v]", aprev = "[0:a]";
    for (let i = 1; i < n; i++) {
      const vout = i < n - 1 ? `[v${i}]` : "[vout]";
      const aout = i < n - 1 ? `[a${i}]` : "[aout]";
      parts.push(`${vprev}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offsets[i - 1]}${vout}`);
      parts.push(`${aprev}[${i}:a]acrossfade=d=${XFADE}${aout}`);
      vprev = vout;
      aprev = aout;
    }
    args.push("-filter_complex", parts.join(";"), "-map", "[vout]", "-map", "[aout]",
              ...ENCODE, "-c:a", "aac", outName);
    return args;
  }

  function musicArgs(videoName, musicName, outName, musicVol, origVol, videoDur) {
    const mv = (musicVol / 100).toFixed(2);
    const ov = (origVol / 100).toFixed(2);
    const fadeSt = Math.max(videoDur - MUSIC_FADE, 0).toFixed(3);
    const mchain = `[1:a]atrim=0:${videoDur.toFixed(3)},volume=${mv},afade=t=out:st=${fadeSt}:d=${MUSIC_FADE}`;
    const fc = origVol > 0
      ? `${mchain}[m];[0:a]volume=${ov}[o];[o][m]amix=inputs=2:duration=first:normalize=0[aout]`
      : `${mchain}[aout]`;
    return ["-y", "-i", videoName, "-stream_loop", "-1", "-i", musicName,
            "-filter_complex", fc, "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-t", videoDur.toFixed(3), outName];
  }

  async function cleanup(names) {
    for (const name of names) {
      try { await ffmpeg.deleteFile(name); } catch (e) { /* best effort */ }
    }
  }

  /* Talla un tros d'un fitxer mantenint la resolució original i retorna el Blob. */
  async function cut(file, start, end, onStatus, onProgress) {
    await load(onStatus);
    const progHandler = ({ progress }) =>
      onProgress(Math.min(99, Math.round(Math.min(Math.max(progress, 0), 1) * 100)));
    ffmpeg.on("progress", progHandler);
    try {
      onStatus("Tallant…");
      await ffmpeg.writeFile("cutin.mp4", await fileToBytes(file));
      const ret = await ffmpeg.exec([
        "-y", "-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", "cutin.mp4",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-c:a", "aac", "cutout.mp4"]);
      if (ret !== 0) throw new Error("El motor ha fallat tallant el clip");
      const data = await ffmpeg.readFile("cutout.mp4");
      onStatus("");
      onProgress(100);
      return new Blob([data.buffer], { type: "video/mp4" });
    } finally {
      ffmpeg.off("progress", progHandler);
      await cleanup(["cutin.mp4", "cutout.mp4"]);
    }
  }

  /* clips: [{file, start, end, width, height}]
     opts: {transition, format, musicFile, musicVol, origVol} */
  async function assemble(clips, opts, onStatus, onProgress) {
    await load(onStatus);
    const size = targetSize(opts.format, clips.map((c) => [c.width, c.height]));
    const total = clips.length + 1 + (opts.musicFile ? 1 : 0);
    let done = 0;
    const progHandler = ({ progress }) =>
      onProgress(Math.min(99, Math.round(((done + Math.min(Math.max(progress, 0), 1)) / total) * 100)));
    ffmpeg.on("progress", progHandler);
    const scratch = ["list.txt", "joined.mp4", "final.mp4"];
    try {
      const norm = [];
      for (let i = 0; i < clips.length; i++) {
        onStatus(`Normalitzant clip ${i + 1}/${clips.length}…`);
        const inName = `in${i}.mp4`;
        scratch.push(inName);
        await ffmpeg.writeFile(inName, await fileToBytes(clips[i].file));
        const hasAudio = await probeHasAudio(inName);
        const outName = `seg${i}.mp4`;
        scratch.push(outName);
        const ret = await ffmpeg.exec(normalizeArgs(
          inName, outName, clips[i].start, clips[i].end, size, hasAudio,
          opts.transition === "fadeblack"));
        if (ret !== 0) throw new Error(`El motor ha fallat normalitzant el clip ${i + 1}`);
        await ffmpeg.deleteFile(inName);
        norm.push(outName);
        done++;
      }

      onStatus("Unint clips…");
      const durations = clips.map((c) => c.end - c.start);
      let joined = "joined.mp4";
      if (norm.length === 1) {
        joined = norm[0];
      } else if (opts.transition === "crossfade") {
        if (await ffmpeg.exec(xfadeArgs(norm, durations, joined)) !== 0)
          throw new Error("El motor ha fallat al crossfade");
      } else {
        await ffmpeg.writeFile("list.txt", concatListText(norm));
        if (await ffmpeg.exec(["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", joined]) !== 0)
          throw new Error("El motor ha fallat unint els clips");
      }
      done++;

      let videoDur = durations.reduce((a, b) => a + b, 0);
      if (opts.transition === "crossfade" && durations.length > 1)
        videoDur -= XFADE * (durations.length - 1);

      let finalName = joined;
      if (opts.musicFile) {
        onStatus("Afegint música…");
        const ext = (opts.musicFile.name.match(/\.\w+$/) || [".mp3"])[0].toLowerCase();
        const musicName = "music" + ext;
        scratch.push(musicName);
        await ffmpeg.writeFile(musicName, await fileToBytes(opts.musicFile));
        if (await ffmpeg.exec(musicArgs(joined, musicName, "final.mp4",
                                        opts.musicVol, opts.origVol, videoDur)) !== 0)
          throw new Error("El motor ha fallat afegint la música");
        finalName = "final.mp4";
        done++;
      }

      const data = await ffmpeg.readFile(finalName);
      onStatus("");
      onProgress(100);
      return new Blob([data.buffer], { type: "video/mp4" });
    } finally {
      ffmpeg.off("progress", progHandler);
      await cleanup(scratch);
    }
  }

  return { assemble, cut, targetSize, normalizeArgs, xfadeOffsets, xfadeArgs, musicArgs };
})();
