# NESvault

Emulador de Nintendo Entertainment System / Famicom en el navegador. Sitio estático (sin build step), motor [Nintendo.js](https://github.com/lrusso/Nintendo) (lrusso — mismo autor que Genesis.js de GENvault y SuperNintendo.js de SNESvault). Pensado para desplegarse en Netlify, hermano de GENvault, SNESvault y DOSVault.

## Paleta

Extraída de la consola Famicom (HVC-001) real vía clustering de color:

| Variable | Hex | Uso |
|---|---|---|
| `--femi-cream` | `#f5f4ec` | fondo / cuerpo principal |
| `--femi-cream-2` | `#ece1cd` | paneles secundarios |
| `--femi-maroon` | `#8e252d` | acento primario (botones, bordes) |
| `--femi-red` | `#e3220b` | acento CTA / hover / logo |
| `--femi-ink` | `#31181a` | texto, sombras "duras" |
| `--femi-grey` | `#6e6c6e` | UI muted, rejillas |
| `--femi-grey-light` | `#c4b7b5` | bordes suaves |
| `--femi-blue` | `#182c88` | acento menor (uso puntual) |

## Estructura

```
index.html                 layout: header + 2 columnas (consola / catálogo)
css/styles.css              paleta Famicom, grid responsive 5/3/2, popup Controles
js/app.js                   loadGameLibrary(), getCarouselColumns(), carga de ROMs, keymap, gamepad
js/vendor/Nintendo.min.js   motor vendorizado (DEBE quedar en el mismo origen que index.html)
data/games.json             catálogo — array de {id, name, region, cover, url}
actualizar-portadas.html    completa "cover" contra libretro-thumbnails (client-side)
py/match_covers.py          mismo matching, versión CLI (solo librería estándar)
```

## Catálogo (`data/games.json`)

```json
[
  {
    "id": "SuperMarioBros",
    "name": "Super Mario Bros.",
    "region": "🇺🇸",
    "cover": "https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System/master/Named_Boxarts/Super%20Mario%20Bros.%20(World).png",
    "url": "https://pub-13140bd15eda49b4a3f35bc937ab1c58.r2.dev/projects/nesvault/SuperMarioBros.nes"
  }
]
```

**Importante** (bug ya pisado en GENvault, mismo guard puesto acá a propósito): cada entrada necesita la key literal `url` (string). Si un juego se sube con otro nombre de campo (`bundle`, `rom`, etc.), `loadGameLibrary()` en `js/app.js` lo descarta del catálogo **en silencio**, sin error visible. Si un juego nuevo "no aparece", lo primero a chequear es esto.

`cover` puede quedar `null`/`""` — cae al ícono de cartucho placeholder (SVG inline), no rompe nada.

Arranca vacío (`[]`) a propósito — cargá los juegos editando este archivo directamente (mismo flujo que Pol usa en GENvault: editar `data/games.json` en GitHub), o corriendo `actualizar-portadas.html` / `py/match_covers.py` después de tener las entradas con `url` para completar `cover`.

## ROMs — Cloudflare R2

Mismo bucket público que GENvault/SNESvault/DOSVault:
`pub-13140bd15eda49b4a3f35bc937ab1c58.r2.dev`, bajo el prefijo `projects/nesvault/<archivo>.nes`.

El bucket ya tiene CORS configurado para los otros tres dominios. Para sumar NESvault, agregar el origin del sitio (sin barra final — ver "Gotchas" abajo) a `AllowedOrigins`, por ejemplo:

```json
["https://dosvault.netlify.app", "https://genvaultapp.netlify.app", "https://snesvault.netlify.app", "https://nesvault.netlify.app"]
```

## Portadas — libretro-thumbnails

Carpeta: `Nintendo - Nintendo Entertainment System / Named_Boxarts`, repo espejo individual (liviano, ideal para la API de Trees de GitHub sin auth):
https://github.com/libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System

Dos herramientas equivalentes (mismo algoritmo: normaliza nombre → match exacto → fuzzy):
- `py/match_covers.py` — CLI, solo librería estándar de Python.
- `actualizar-portadas.html` — 100% client-side, botón + log en vivo.

Arte de tapa real, no placeholders — mismo criterio de riesgo asumido (uso no comercial/indie) que en GENvault.

## Motor: Nintendo.js

- Formatos: `.nes` (el engine también trae referencias a `.fds`/`.unf`/`.unif` internamente, pero el `<input type=file>` de este sitio solo valida `.nes`).
- **Tiene que servirse desde el mismo origen que la página** — el script chequea `document.currentScript.src` contra `window.location.origin` y tira error si no coincide. Por eso está vendorizado local en `js/vendor/Nintendo.min.js` y no cargado desde un CDN (mismo gotcha ya documentado para `SuperNintendo.min.js` en SNESvault).
- API: `embedNintendo({ container, name, rom, soundEnabled, showMobileControls, backText, soundText, loadText, saveText, player1, player2, cbStarted })`. Funciones sueltas: `resetNintendo()`, `toggleSoundNintendo()`, `downloadStateNintendo()` (guardar), `uploadStateNintendo()` (cargar), `requestEmulatorFullscreenNintendo()`.
- Keymap por defecto (Player 1): D-Pad = flechas, A = `KeyX`, B = `KeyZ`, Select = `KeyA`, Start = `KeyS`. Remapeable desde "Ver Controles" → `localStorage` (`nesvault_keymap`). Player 2 (numpad) queda fijo.
- Gamepad: NESvault NO usa un parámetro nativo del motor para mandos (Nintendo.js no expone uno en `embedNintendo`) — en cambio, `js/app.js` sondea la Gamepad API estándar y traduce cada botón a un evento de teclado sintético usando el keymap ACTUAL de Player 1. Ventaja: remapear el teclado remapea el control físico automáticamente, sin duplicar lógica. Mapeo botón→acción editable en "Ver Controles" → `localStorage` (`nesvault_gpmap`).

## Deploy (Netlify)

1. Push a un repo (`nesvault`, rama `main`).
2. Netlify → New site from Git → sin build command, publish directory = raíz del repo.
3. Confirmar que `js/vendor/Nintendo.min.js` se sirve desde el mismo dominio (no proxy/CDN externo) — si no, el motor tira error de origen.
4. Agregar el dominio final al `AllowedOrigins` del bucket R2 (ver arriba).

## Gotchas conocidos (heredados de GENvault/SNESvault, aplicados preventivamente acá)

- **CORS con barra final**: un origin en `AllowedOrigins` con `/` al final (`https://nesvault.netlify.app/`) no matchea el header `Origin` exacto del navegador y tira error de CORS aunque el resto de la config esté bien. Ya pasó dos veces en el bucket compartido (SNESvault, y antes con otro dominio) — chequear esto primero ante cualquier error de CORS nuevo.
- **`url` vs otra key en `games.json`**: ver sección "Catálogo" arriba.
- **Breakpoints del carousel desincronizados**: `getCarouselColumns()` en `js/app.js` y el CSS Grid de `.rom-page` en `css/styles.css` usan los mismos 3 breakpoints (>1180px / ≤1180px / ≤620px). Si cambiás uno, cambiá el otro — si no, la última fila de una página completa queda con huecos (bug ya pisado en GENvault el 2026-08-19).
