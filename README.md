# Clip Editor

Editor local de clips de mòbil: talla, ordena amb el ratolí i uneix gravacions
amb transicions i música de fons. Tot funciona a la teva màquina — cap fitxer
surt de l'ordinador.

## Requisits

- Windows amb [ffmpeg](https://ffmpeg.org) al PATH (ja instal·lat)
- [uv](https://docs.astral.sh/uv/) (ja instal·lat)

## Com s'engega

Doble clic a **`ClipEditor.bat`**. S'obre el navegador a
`http://localhost:8765`. Per aturar-ho, tanca la finestra negra del terminal.

## Com s'utilitza

1. **Arrossega els vídeos** del mòbil (mp4/mov) a la zona de càrrega.
2. **Ordena** les targetes arrossegant-les amb el ratolí.
3. **Clica una targeta** per obrir l'editor de talls: mou els controls d'inici
   i fi, o reprodueix el vídeo i prem «marca aquí» per fixar el punt exacte.
4. Tria la **transició** (tall net, fosa entre clips o fosa a negre) i el
   **format** (auto, 16:9 o 9:16). Els clips amb orientació diferent es mostren
   sobre un fons difuminat.
5. Opcionalment tria una **música** (mp3/m4a/wav) i ajusta els volums de la
   música i del so original. La música acaba amb una fosa de 2 segons.
6. Prem **«Munta el vídeo»**. El resultat queda a `OUTPUT\<nom>.mp4`
   (es sobreescriu si repeteixes el mateix nom).

Els clips pujats queden a `workspace\clips\` i es recuperen si reinicies l'app.

## Tests

```
uv run pytest
```
