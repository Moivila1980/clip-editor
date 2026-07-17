# Clip Editor — Especificació de disseny (2026-07-17)

## Objectiu

App 100% local per editar gravacions de mòbil (clips de ~20–30 s): carregar clips,
ordenar-los amb el ratolí, tallar l'inici/fi de cada un, unir-los amb transicions i
música de fons, i exportar un únic vídeo final. Ús previst: docència/presentacions i
ús personal.

## Fora d'abast (adrede)

Títols/text sobre el vídeo, canvis de velocitat, filtres de color, exportació directa
a xarxes socials, edició multi-pista. Es poden afegir més endavant.

## Arquitectura

- **Servidor local**: Python + FastAPI + uvicorn, gestionat amb `uv`. Serveix una
  única pàgina estàtica i una API JSON. Port per defecte: `8765`.
- **Frontend**: una sola pàgina HTML + JS vanilla + SortableJS (vendoritzat en local,
  sense CDN) per al drag-and-drop. Previsualització amb `<video>` natiu.
- **Motor de vídeo**: `ffmpeg`/`ffprobe` del PATH (v8.1.1 ja instal·lat).
- **Llançador**: `ClipEditor.bat` — arrenca el servidor i obre el navegador a
  `http://localhost:8765`.
- **Privadesa**: cap crida externa; tots els fitxers es queden a la màquina.

## Estructura de directoris

```
clip-editor/
├── pyproject.toml            # uv; deps: fastapi, uvicorn, python-multipart
├── ClipEditor.bat            # llançador (doble clic)
├── src/clip_editor/
│   ├── __init__.py
│   ├── app.py                # rutes FastAPI + arrencada
│   ├── media.py              # ffprobe (metadata), miniatures
│   ├── assemble.py           # construcció d'ordres ffmpeg + execució amb progrés
│   ├── jobs.py               # gestor de feines en segon pla (fil + estat)
│   └── models.py             # dataclasses/pydantic del projecte de muntatge
├── static/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── vendor/Sortable.min.js
├── workspace/                # (gitignored) clips/, music/, thumbs/, segments temporals
├── OUTPUT/                   # (gitignored) vídeos finals
└── tests/                    # pytest
```

## Flux d'usuari

1. Doble clic a `ClipEditor.bat` → s'obre el navegador.
2. Arrossega vídeos (mp4/mov/m4v) a la zona de càrrega → apareixen targetes amb
   miniatura i durada.
3. Reordena les targetes arrossegant-les (SortableJS). Pot eliminar clips.
4. Clic a una targeta → previsualització amb doble control lliscant (inici/fi del
   tros a conservar). Els valors es mostren en segons i es desen per clip.
5. Tria transició: **tall net** | **fosa (crossfade 0,5 s)** | **fosa a negre**.
6. Música (opcional): puja mp3/m4a; controls de volum de **música** i de **so
   original** (0–100%); fosa de sortida automàtica (2 s) al final.
7. Format: **Auto** (segons orientació majoritària dels clips) | **16:9** | **9:16**.
   Clips que no encaixen → escalats sobre fons difuminat del mateix clip.
8. Nom del fitxer de sortida (per defecte `muntatge`) + botó **Munta el vídeo** →
   barra de progrés → en acabar, reproductor amb el resultat i ruta a `OUTPUT/`.
   El fitxer se sobreescriu si ja existeix (mateix nom = mateix fitxer).

## API

| Mètode | Ruta | Funció |
|---|---|---|
| POST | `/api/clips` | Puja un clip (multipart) → còpia a `workspace/clips/`, retorna `{id, name, duration, width, height, thumb_url}` |
| GET | `/api/clips` | Llista de clips carregats |
| DELETE | `/api/clips/{id}` | Elimina un clip del workspace |
| POST | `/api/music` | Puja fitxer de música → `workspace/music/` |
| GET | `/media/{id}` | Serveix el vídeo per a previsualització (amb suport Range) |
| GET | `/thumbs/{id}.jpg` | Miniatura del clip |
| POST | `/api/assemble` | Cos: `{order:[{id,start,end}], transition, music:{id,music_vol,orig_vol}, format, name}` → `{job_id}` |
| GET | `/api/jobs/{job_id}` | `{status: queued|running|done|error, progress: 0-100, output, error}` |

## Estratègia ffmpeg

1. **Normalització per segment**: per cada clip retallat (`-ss start -to end`),
   re-codificar a resolució objectiu (1920×1080 o 1080×1920), 30 fps, SAR 1,
   H.264 + AAC 48 kHz estèreo. Si l'orientació no encaixa: fons difuminat
   (split → scale+crop+boxblur → overlay del clip escalat centrat).
2. **Unió**:
   - *Tall net*: concat demuxer sobre els segments normalitzats (`-c copy`).
   - *Fosa a negre*: fade in/out de 0,4 s per segment (vídeo i àudio) + concat.
   - *Crossfade*: cadena `xfade` + `acrossfade` en un sol `filter_complex`
     (offsets calculats a partir de les durades retallades).
3. **Música**: entrada extra; `atrim`/`aloop` fins a la durada del vídeo; filtres
   `volume` segons els dos controls; `amix` amb la pista original; `afade=t=out`
   els darrers 2 s.
4. **Progrés**: `ffmpeg -progress pipe:1`; percentatge = temps processat / durada
   total. La feina corre en un fil de fons (un sol job simultani).

## Gestió d'errors

- Validació d'extensions i de fitxers il·legibles per ffprobe en pujar (missatge clar).
- `start >= end` o segments buits → error de validació abans de llançar ffmpeg.
- Si ffmpeg falla, el job desa les últimes línies d'stderr i la UI les mostra.
- Sense clips o sense cap segment vàlid → botó de muntar desactivat.

## Proves i verificació

- **pytest** (unitàries): constructors d'ordres ffmpeg (`assemble.py`) sense executar
  ffmpeg; càlcul d'offsets de crossfade; validació de peticions.
- **pytest** (integració): generar clips sintètics petits amb ffmpeg (2 s, barres de
  color + to), muntar-los pels tres modes de transició i comprovar durada i
  existència del fitxer final amb ffprobe.
- **UI**: smoke test amb Playwright (skill webapp-testing): pujar, reordenar,
  muntar, comprovar que el job acaba `done`.

## Convencions

- Estil de codi segons regles globals: fitxers 200–400 línies, type hints, logging
  amb `logger`, dataclasses immutables per a configuració.
- Conventional Commits; `workspace/` i `OUTPUT/` al `.gitignore`.
