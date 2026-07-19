"use strict";

const CACHE = "clip-editor-v3";
const ASSETS = [
  "./", "./index.html", "./talls.html", "./style.css", "./app.js", "./talls.js", "./engine.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png",
  "./vendor/Sortable.min.js", "./vendor/ffmpeg.js", "./vendor/814.ffmpeg.js",
  "./vendor/ffmpeg-core.js", "./vendor/ffmpeg-core.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then((hit) => hit || fetch(event.request)),
  );
});
