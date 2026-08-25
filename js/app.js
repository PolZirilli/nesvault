/* ============================================================
   NESvault — js/app.js
   Sigue las mismas convenciones que GENvault/SNESvault:
   - loadGameLibrary() lee data/games.json y descarta con
     typeof g.url === 'string' (evita el bug silencioso ya
     pisado en GENvault con la key `bundle` en vez de `url`).
   - Layout 60/40 (consola/catálogo). getCarouselColumns() lee el
     ancho de .rom-carousel y da 4 columnas (2 en pantallas muy
     angostas, ≤260px), sincronizado 1:1 con la @container query
     de css/styles.css (.rom-page). Si cambiás el breakpoint,
     cambiá los dos lugares.
   - Botonera de consola tipo GENvault/SNESvault: Comenzar (▶,
     reanuda) / Pausar (⏸) / Detener (⏹) / Ver Controles (◈), en
     vez de un único botón de power on/off. Pantalla completa es
     un ícono (⛶) superpuesto sobre la pantalla, no un botón en la
     fila. Reiniciar no tiene botón propio — solo atajo Ctrl+R
     (ver setupGlobalShortcuts()).
   - Motor: Nintendo.js (lrusso), vendorizado en js/vendor/.
     API pública: embedNintendo({...}), resetNintendo(),
     toggleSoundNintendo(), downloadStateNintendo(),
     uploadStateNintendo(), requestEmulatorFullscreenNintendo().
     Globals internos NO documentados pero usados acá para
     pausar/reanudar/detener de verdad (video Y audio): mismos
     que usa el motor en su propio blur/focus de ventana —
     stopLoopNintendo()/startLoopNintendo(), NINTENDO_RUNNING,
     NINTENDO_PAUSED, NINTENDO_AUDIO_CONTEXT, NINTENDO_AUDIO_NEXT_TIME,
     NINTENDO_AUDIO_BUFFER_QUEUE. Si se actualiza el motor, re-chequear
     que sigan existiendo con el mismo nombre.
   ============================================================ */

(function () {
  "use strict";

  var KEYMAP_STORAGE_KEY = "nesvault_keymap";
  var GPMAP_STORAGE_KEY = "nesvault_gpmap";
  var GAMES_JSON_URL = "data/games.json";

  // El motor exige mismo origen y NO soporta reinicializarse
  // de forma 100% garantizada sobre un canvas previo: cada vez
  // que se carga un juego nuevo, vaciamos #game antes de llamar
  // a embedNintendo() de nuevo (mismo criterio prudente que se
  // usaría en GENvault/SNESvault para evitar loops de audio
  // superpuestos).
  var gameContainerId = "game";

  var DEFAULT_KEYMAP = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    a: "KeyX",
    b: "KeyZ",
    select: "KeyA",
    start: "KeyS",
  };

  // Player 2 no es remapeable desde la UI (simplicidad, mismo
  // criterio que el resto de la familia vault) — queda con el
  // default de fábrica del motor por si alguien conecta un
  // segundo control físico.
  var PLAYER2_KEYMAP = {
    up: "Numpad8",
    down: "Numpad2",
    left: "Numpad4",
    right: "Numpad6",
    a: "Numpad7",
    b: "Numpad9",
    select: "Numpad1",
    start: "Numpad3",
  };

  var DEFAULT_GAMEPAD_MAP = {
    up: 12,
    down: 13,
    left: 14,
    right: 15,
    a: 0,
    b: 1,
    select: 8,
    start: 9,
  };

  var ACTION_LABELS = {
    up: "Arriba",
    down: "Abajo",
    left: "Izquierda",
    right: "Derecha",
    a: "Botón A",
    b: "Botón B",
    select: "Select",
    start: "Start",
  };

  var ACTION_ORDER = ["up", "down", "left", "right", "a", "b", "select", "start"];
  var DPAD_ACTIONS = ["up", "down", "left", "right"];
  var BUTTON_ACTIONS = ["a", "b"];
  var EXTRA_ACTIONS = ["select", "start"];

  var state = {
    games: [],
    filtered: [],
    page: 0,
    columns: 4,
    listeningAction: null, // acción esperando una tecla nueva
    hasGame: false, // hay una sesión de juego activa (jugando O pausada)
    isPaused: false,
    currentGameName: "",
  };

  // ---------- Utilidades ----------

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return Object.assign({}, fallback, parsed);
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* localStorage puede fallar en privado/incógnito, no es crítico */
    }
  }

  function cartIconSVG() {
    return (
      '<svg class="cart-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="10" y="6" width="30" height="20" rx="2" fill="#8e252d"/>' +
      '<rect x="14" y="10" width="22" height="4" fill="#f5f4ec"/>' +
      '<rect x="6" y="24" width="44" height="30" rx="3" fill="#e3220b"/>' +
      '<rect x="6" y="24" width="44" height="8" fill="#31181a" opacity="0.25"/>' +
      '<circle cx="28" cy="42" r="7" fill="#f5f4ec"/>' +
      '<circle cx="28" cy="42" r="3" fill="#31181a"/>' +
      "</svg>"
    );
  }

  // ---------- Catálogo ----------

  function loadGameLibrary() {
    var grid = $("#rom-grid");
    fetch(GAMES_JSON_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error("games.json no es un array");
        // IMPORTANTE: si una entrada no tiene la key literal `url`
        // (string), se descarta en silencio del catálogo — mismo
        // comportamiento documentado en GENvault. Ante un juego
        // que "no aparece", lo primero a chequear es esto.
        state.games = data.filter(function (g) {
          return g && typeof g.url === "string" && g.url.length > 0;
        });
        state.filtered = state.games.slice();
        state.page = 0;
        renderCarousel();
      })
      .catch(function (err) {
        console.error("[nesvault] no se pudo cargar el catálogo:", err);
        if (grid) {
          grid.innerHTML =
            '<div class="error-state">No se pudo cargar el catálogo (data/games.json). ' +
            "Revisá la consola para más detalle.</div>";
        }
        renderDots(0);
        updateArrows(0, 0);
      });
  }

  function getCarouselColumns() {
    // Mismos breakpoints que GENvault/SNESvault: 5 columnas por
    // defecto, 3 en ventanas ≤1180px, 2 en ventanas ≤620px — sobre
    // el ancho de la VENTANA (no del contenedor), igual que sus
    // media queries en css/styles.css (.rom-page). Si cambiás estos
    // números, cambiá los dos lugares.
    var w = window.innerWidth;
    if (w <= 620) return 2;
    if (w <= 1180) return 3;
    return 5;
  }

  function pageSize() {
    // 2 filas siempre, columnas según ancho — igual criterio que GENvault/SNESvault
    return getCarouselColumns() * 2;
  }

  function totalPages() {
    var size = pageSize();
    return Math.max(1, Math.ceil(state.filtered.length / size));
  }

  function renderCarousel() {
    var grid = $("#rom-grid");
    if (!grid) return;

    state.columns = getCarouselColumns();
    var size = pageSize();
    var pages = totalPages();
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;

    if (state.filtered.length === 0) {
      grid.innerHTML =
        '<div class="empty-state">' +
        cartIconSVG() +
        "<div>" +
        (state.games.length === 0
          ? "Todavía no hay juegos cargados en el catálogo."
          : "Ningún juego coincide con la búsqueda.") +
        "</div></div>";
      renderDots(0);
      updateArrows(0, 0);
      return;
    }

    var start = state.page * size;
    var pageItems = state.filtered.slice(start, start + size);

    grid.innerHTML = pageItems
      .map(function (game) {
        var coverHTML = hasCover(game.cover)
          ? '<img src="' +
          escapeAttr(game.cover) +
          '" alt="" loading="lazy" onerror="this.parentNode.innerHTML = this.parentNode.dataset.fallback">'
          : cartIconSVG();
        return (
          '<button class="rom-card" data-id="' +
          escapeAttr(game.id || "") +
          '">' +
          '<div class="cover" data-fallback="' +
          escapeAttr(cartIconSVG()) +
          '">' +
          coverHTML +
          "</div>" +
          '<div class="meta">' +
          '<div class="name">' +
          escapeHTML(game.name || "Sin nombre") +
          "</div>" +
          (game.region
            ? '<div class="region">' + escapeHTML(game.region) + "</div>"
            : "") +
          "</div>" +
          "</button>"
        );
      })
      .join("");

    $all(".rom-card", grid).forEach(function (card) {
      card.addEventListener("click", function () {
        var id = card.getAttribute("data-id");
        var game = state.filtered.filter(function (g) {
          return String(g.id) === id;
        })[0];
        if (game) loadGameFromCatalog(game);
      });
    });

    renderDots(pages);
    updateArrows(state.page, pages);
  }

  function hasCover(cover) {
    // Trata valores placeholder tipo "empty"/"null"/"none"/"n/a"
    // (a veces quedan así en el JSON por error) igual que sin
    // portada, para no pedirle al navegador una URL que no existe.
    if (!cover || typeof cover !== "string") return false;
    var v = cover.trim().toLowerCase();
    return v !== "" && v !== "empty" && v !== "null" && v !== "none" && v !== "n/a";
  }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
      );
    });
  }

  function escapeAttr(str) {
    return escapeHTML(str);
  }

  function renderDots(pages) {
    var dotsEl = $("#carousel-dots");
    if (!dotsEl) return;
    if (pages <= 1) {
      dotsEl.innerHTML = "";
      return;
    }
    var html = "";
    for (var i = 0; i < pages; i++) {
      html +=
        '<button class="dot' +
        (i === state.page ? " is-active" : "") +
        '" data-page="' +
        i +
        '" aria-label="Página ' +
        (i + 1) +
        '"></button>';
    }
    dotsEl.innerHTML = html;
    $all(".dot", dotsEl).forEach(function (dot) {
      dot.addEventListener("click", function () {
        state.page = parseInt(dot.getAttribute("data-page"), 10);
        renderCarousel();
      });
    });
  }

  function updateArrows(page, pages) {
    var prev = $("#carousel-prev");
    var next = $("#carousel-next");
    if (prev) prev.disabled = pages <= 1 || page <= 0;
    if (next) next.disabled = pages <= 1 || page >= pages - 1;
  }

  function setupSearch() {
    var input = $("#search-input");
    if (!input) return;
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      state.filtered = !q
        ? state.games.slice()
        : state.games.filter(function (g) {
          var name = (g.name || "").toLowerCase();
          var region = (g.region || "").toLowerCase();
          return name.indexOf(q) !== -1 || region.indexOf(q) !== -1;
        });
      state.page = 0;
      renderCarousel();
    });
  }

  function setupCarouselNav() {
    var prev = $("#carousel-prev");
    var next = $("#carousel-next");
    if (prev)
      prev.addEventListener("click", function () {
        state.page = Math.max(0, state.page - 1);
        renderCarousel();
      });
    if (next)
      next.addEventListener("click", function () {
        state.page = Math.min(totalPages() - 1, state.page + 1);
        renderCarousel();
      });

    // getCarouselColumns() ahora depende del ancho de la ventana
    // (mismos breakpoints que GENvault/SNESvault), así que basta con
    // escuchar window resize.
    var resizeTimer = null;
    function onWindowResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var newCols = getCarouselColumns();
        if (newCols !== state.columns) {
          state.page = 0;
          renderCarousel();
        }
      }, 150);
    }
    window.addEventListener("resize", onWindowResize);
  }

  // ---------- Carga de ROM / motor ----------

  function currentKeymap() {
    return loadJSON(KEYMAP_STORAGE_KEY, DEFAULT_KEYMAP);
  }

  function screenBezel() {
    return $(".screen-bezel");
  }

  function beforeMount() {
    var bezel = screenBezel();
    if (bezel) bezel.classList.add("is-hidden-placeholder");
    var container = document.getElementById(gameContainerId);
    if (container) container.innerHTML = "";
  }

  // IMPORTANTE: `name` acá es el nombre TÉCNICO que recibe el motor,
  // no el nombre lindo para mostrar en pantalla. Nintendo.js necesita
  // que tenga pinta de archivo real (con extensión .nes) — si se le
  // pasa un nombre de catálogo tipo "Super Mario Bros." o "Zelda
  // (USA)" sin extensión, embedNintendo() NO tira error pero
  // `cbStarted` nunca dispara (se detectó jugando: el canvas se
  // monta igual, pero el juego queda mudo/no arranca de verdad).
  // Por eso loadGameFromCatalog() deriva un nombre de archivo real
  // desde la URL de la ROM, y el nombre lindo se pasa aparte solo
  // para la UI (status bar).
  function mountRom(engineName, arrayBuffer, displayName) {
    beforeMount();
    var keymap = currentKeymap();
    var label = displayName || engineName;

    embedNintendo({
      container: gameContainerId,
      name: engineName,
      rom: arrayBuffer,
      soundEnabled: true,
      showMobileControls: isMobileDevice(),
      backText: "VOLVER",
      soundText: "SONIDO",
      loadText: "CARGAR",
      saveText: "GUARDAR",
      player1: keymap,
      player2: PLAYER2_KEYMAP,
      cbStarted: function () {
        state.hasGame = true;
        state.isPaused = false;
        state.currentGameName = label;
        updateStatusBar();
        updateTransportButtons();
      },
    });
  }

  function filenameFromUrl(url) {
    try {
      var clean = url.split("?")[0].split("#")[0];
      var parts = clean.split("/");
      var last = decodeURIComponent(parts[parts.length - 1] || "");
      return /\.nes$/i.test(last) ? last : last + ".nes";
    } catch (e) {
      return "game.nes";
    }
  }

  // El motor NO expone pausar/reanudar como API pública, pero sí lo
  // implementa internamente (auto-pausa al perder foco la ventana,
  // reanuda al recuperarlo) usando estas mismas variables globales.
  // pauseEmulation()/resumeEmulation() reproducen exactamente esa
  // misma secuencia a pedido del usuario (botones Pausar/Comenzar)
  // en vez de depender de blur/focus del browser.

  function pauseEmulation() {
    if (!state.hasGame || state.isPaused) return;
    state.isPaused = true;
    if (typeof window.stopLoopNintendo === "function") {
      try {
        window.stopLoopNintendo();
      } catch (e) { }
    }
    window.NINTENDO_PAUSED = true;
    if (
      window.NINTENDO_AUDIO_CONTEXT &&
      window.NINTENDO_AUDIO_CONTEXT.state === "running"
    ) {
      try {
        window.NINTENDO_AUDIO_CONTEXT.suspend();
      } catch (e) { }
    }
    updateStatusBar();
    updateTransportButtons();
  }

  function resumeEmulation() {
    if (!state.hasGame || !state.isPaused) return;
    state.isPaused = false;
    window.NINTENDO_PAUSED = false;
    // Mismo reset de timing que hace el motor en su propio handler de
    // "focus" antes de reanudar — si no, el audio arranca desfasado.
    window.NINTENDO_AUDIO_NEXT_TIME = 0;
    window.NINTENDO_AUDIO_BUFFER_QUEUE = [];
    if (
      window.NINTENDO_AUDIO_CONTEXT &&
      window.NINTENDO_AUDIO_CONTEXT.state === "suspended"
    ) {
      try {
        window.NINTENDO_AUDIO_CONTEXT.resume();
      } catch (e) { }
    }
    if (typeof window.startLoopNintendo === "function") {
      try {
        window.startLoopNintendo(window.NINTENDO_TARGET_FPS);
      } catch (e) { }
    }
    updateStatusBar();
    updateTransportButtons();
  }

  function stopEmulation() {
    // El motor no expone una API de "destruir instancia" documentada,
    // pero SÍ deja colgado en window el loop de animación (stopLoopNintendo)
    // y el AudioContext (NINTENDO_AUDIO_CONTEXT) que sigue vivo aunque
    // vaciemos el contenedor del DOM. Vaciar solo el innerHTML (como
    // hacíamos antes) saca el video de pantalla pero el loop
    // requestAnimationFrame del motor sigue corriendo en segundo plano
    // y el audio nunca se corta — por eso quedaba sonando de fondo
    // después de "Detener". Fix: cortar el loop y el audio primero, y
    // recién después vaciar el contenedor.
    if (typeof window.stopLoopNintendo === "function") {
      try {
        window.stopLoopNintendo();
      } catch (e) { }
    }
    // Belt-and-suspenders: el loop interno del motor (función G) chequea
    // NINTENDO_RUNNING antes de reprogramarse a sí mismo, así que aunque
    // algo vuelva a pedir un frame, no hace nada mientras esto sea false.
    window.NINTENDO_RUNNING = false;
    window.NINTENDO_PAUSED = false;
    if (
      window.NINTENDO_AUDIO_CONTEXT &&
      typeof window.NINTENDO_AUDIO_CONTEXT.suspend === "function" &&
      window.NINTENDO_AUDIO_CONTEXT.state === "running"
    ) {
      try {
        window.NINTENDO_AUDIO_CONTEXT.suspend();
      } catch (e) { }
    }
    // Mismo estado que espera el motor si el usuario vuelve a cargar un
    // juego después de apagar (ver embedNintendo: si el context está
    // "suspended" simplemente lo resume en vez de crear uno nuevo).
    window.NINTENDO_AUDIO_NEXT_TIME = 0;
    window.NINTENDO_AUDIO_BUFFER_QUEUE = [];

    var container = document.getElementById(gameContainerId);
    if (container) container.innerHTML = "";
    var bezel = screenBezel();
    if (bezel) bezel.classList.remove("is-hidden-placeholder");

    state.hasGame = false;
    state.isPaused = false;
    state.currentGameName = "";
    var label = $("#status-game");
    if (label) label.textContent = "Sin juego cargado";
    var bar = $("#status-bar");
    if (bar) {
      bar.classList.remove("is-playing");
      bar.classList.remove("is-paused");
    }
    updateTransportButtons();
  }

  function isMobileDevice() {
    return !!(
      navigator.userAgent.match(/Android/i) ||
      navigator.userAgent.match(/iPhone/i) ||
      navigator.userAgent.match(/iPad/i) ||
      navigator.userAgent.match(/iPod/i)
    );
  }

  function loadGameFromCatalog(game) {
    setStatusLoading(game.name);
    fetch(game.url)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.arrayBuffer();
      })
      .then(function (buf) {
        mountRom(filenameFromUrl(game.url), buf, game.name);
      })
      .catch(function (err) {
        console.error("[nesvault] error cargando ROM:", game, err);
        setStatusError(game.name);
      });
  }

  function setupManualLoad() {
    var dropzone = $("#dropzone");
    var input = $("#rom-file-input");
    if (!dropzone || !input) return;

    dropzone.addEventListener("click", function () {
      input.click();
    });

    input.addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      handleManualFile(file);
      input.value = null;
    });

    ["dragover", "dragenter"].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
      });
    });
    dropzone.addEventListener("drop", function (e) {
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleManualFile(file);
    });
  }

  function handleManualFile(file) {
    var name = file.name || "";
    if (!/\.nes$/i.test(name)) {
      alert("NESvault solo acepta archivos .nes");
      return;
    }
    var filenameEl = $("#dropzone-filename");
    if (filenameEl) filenameEl.textContent = name;
    setStatusLoading(name);
    var reader = new FileReader();
    reader.addEventListener("load", function () {
      mountRom(name, reader.result);
    });
    reader.addEventListener("error", function () {
      setStatusError(name);
    });
    reader.readAsArrayBuffer(file);
  }

  // ---------- Status bar / controles de consola ----------

  function setStatusLoading(name) {
    var bar = $("#status-bar");
    var label = $("#status-game");
    if (label) label.textContent = "Cargando " + name + "…";
    if (bar) {
      bar.classList.remove("is-playing");
      bar.classList.remove("is-paused");
    }
    state.hasGame = false;
    state.isPaused = false;
    updateTransportButtons();
  }

  function setStatusError(name) {
    var label = $("#status-game");
    if (label) label.textContent = "Error al cargar " + name;
  }

  function updateStatusBar() {
    var bar = $("#status-bar");
    var label = $("#status-game");
    if (label) {
      label.textContent =
        state.currentGameName + (state.isPaused ? " (Pausado)" : "");
    }
    if (bar) {
      bar.classList.toggle("is-playing", state.hasGame && !state.isPaused);
      bar.classList.toggle("is-paused", state.hasGame && state.isPaused);
    }
  }

  // Botonera tipo GENvault/SNESvault: Comenzar (reanudar) / Pausar /
  // Detener, en vez de un único toggle de power on-off.
  function updateTransportButtons() {
    var playBtn = $("#btn-play");
    var pauseBtn = $("#btn-pause");
    var stopBtn = $("#btn-stop");
    if (playBtn) playBtn.disabled = !(state.hasGame && state.isPaused);
    if (pauseBtn) pauseBtn.disabled = !(state.hasGame && !state.isPaused);
    if (stopBtn) stopBtn.disabled = !state.hasGame;
  }

  function requestFullscreen() {
    if (typeof requestEmulatorFullscreenNintendo === "function") {
      try {
        requestEmulatorFullscreenNintendo();
      } catch (e) { }
    }
  }

  function resetConsole() {
    if (!state.hasGame) return;
    if (typeof resetNintendo === "function") {
      try {
        resetNintendo();
      } catch (e) { }
    }
  }

  function setupConsoleControls() {
    var playBtn = $("#btn-play");
    var pauseBtn = $("#btn-pause");
    var stopBtn = $("#btn-stop");
    var fullscreenBtn = $("#btn-fullscreen");
    var controlsBtn = $("#btn-controls");

    if (playBtn) playBtn.addEventListener("click", resumeEmulation);
    if (pauseBtn) pauseBtn.addEventListener("click", pauseEmulation);
    if (stopBtn)
      stopBtn.addEventListener("click", function () {
        if (state.hasGame) stopEmulation();
      });
    if (fullscreenBtn) fullscreenBtn.addEventListener("click", requestFullscreen);
    if (controlsBtn) controlsBtn.addEventListener("click", openControlsModal);
  }

  // Ctrl/Cmd + 1/2/3/F/R — documentados en el popup "Ver Controles".
  // El motor NO los maneja internamente (se comprobó desarmando el
  // vendor bundle), así que los implementamos acá. Solo interceptan
  // el atajo del navegador (ej. Ctrl+R recarga la página) cuando hay
  // un juego activo — si no, se deja pasar el comportamiento normal.
  function setupGlobalShortcuts() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || state.listeningAction) return;
      if (!state.hasGame) return;
      switch (e.code) {
        case "Digit1":
          e.preventDefault();
          if (typeof downloadStateNintendo === "function") downloadStateNintendo();
          break;
        case "Digit2":
          e.preventDefault();
          if (typeof uploadStateNintendo === "function") uploadStateNintendo();
          break;
        case "Digit3":
          e.preventDefault();
          if (typeof toggleSoundNintendo === "function") toggleSoundNintendo();
          break;
        case "KeyF":
          e.preventDefault();
          requestFullscreen();
          break;
        case "KeyR":
          e.preventDefault();
          resetConsole();
          break;
      }
    });
  }

  // ---------- Modal de controles (Keyboard / Gamepad) ----------

  function openControlsModal() {
    var overlay = $("#controls-modal");
    if (!overlay) return;
    overlay.classList.add("is-open");
    renderKeyboardTab();
    renderGamepadTab();
  }

  function closeControlsModal() {
    var overlay = $("#controls-modal");
    if (overlay) overlay.classList.remove("is-open");
    state.listeningAction = null;
  }

  function setupModal() {
    var overlay = $("#controls-modal");
    if (!overlay) return;

    $all("[data-close-modal]", overlay).forEach(function (el) {
      el.addEventListener("click", closeControlsModal);
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeControlsModal();
    });

    $all(".tabs button", overlay).forEach(function (tabBtn) {
      tabBtn.addEventListener("click", function () {
        var target = tabBtn.getAttribute("data-tab");
        $all(".tabs button", overlay).forEach(function (b) {
          b.classList.toggle("is-active", b === tabBtn);
        });
        $all(".tab-panel", overlay).forEach(function (panel) {
          panel.classList.toggle(
            "is-active",
            panel.getAttribute("data-tab-panel") === target
          );
        });
      });
    });
  }

  function keyRowHTML(action, keymap) {
    return (
      '<div class="key-row">' +
      '<span class="action">' +
      ACTION_LABELS[action] +
      "</span>" +
      '<span class="binding">' +
      '<span class="key-badge" data-badge="' +
      action +
      '">' +
      formatKeyCode(keymap[action]) +
      "</span>" +
      '<button class="btn btn-set" data-remap="' +
      action +
      '">Set</button>' +
      "</span></div>"
    );
  }

  function keyCardHTML(action, keymap) {
    return (
      '<div class="keymap-btn-card">' +
      '<span class="action">' +
      ACTION_LABELS[action] +
      "</span>" +
      '<span class="key-badge" data-badge="' +
      action +
      '">' +
      formatKeyCode(keymap[action]) +
      "</span>" +
      '<button class="btn btn-set" data-remap="' +
      action +
      '">Set</button>' +
      "</div>"
    );
  }

  function renderKeyboardTab() {
    var dpadList = $("#keymap-dpad-list");
    var buttonsList = $("#keymap-buttons-list");
    var extraList = $("#keymap-extra-list");
    if (!dpadList && !buttonsList && !extraList) return;
    var keymap = currentKeymap();

    if (dpadList) {
      dpadList.innerHTML = DPAD_ACTIONS.map(function (action) {
        return keyRowHTML(action, keymap);
      }).join("");
    }
    if (buttonsList) {
      buttonsList.innerHTML = BUTTON_ACTIONS.map(function (action) {
        return keyCardHTML(action, keymap);
      }).join("");
    }
    if (extraList) {
      extraList.innerHTML = EXTRA_ACTIONS.map(function (action) {
        return keyRowHTML(action, keymap);
      }).join("");
    }

    $all("[data-remap]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        startListening(btn.getAttribute("data-remap"), btn);
      });
    });
  }

  function formatKeyCode(code) {
    if (!code) return "—";
    return code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Arrow/, "");
  }

  function startListening(action, btn) {
    if (state.listeningAction) return;
    state.listeningAction = action;
    btn.classList.add("is-listening");
    btn.textContent = "…";

    function onKey(e) {
      e.preventDefault();
      var keymap = currentKeymap();
      keymap[action] = e.code;
      saveJSON(KEYMAP_STORAGE_KEY, keymap);
      document.removeEventListener("keydown", onKey, true);
      state.listeningAction = null;
      renderKeyboardTab();
    }

    document.addEventListener("keydown", onKey, true);
  }

  function renderGamepadTab() {
    var list = $("#gamepad-list");
    if (!list) return;
    var gpmap = loadJSON(GPMAP_STORAGE_KEY, DEFAULT_GAMEPAD_MAP);
    list.innerHTML = ACTION_ORDER.map(function (action) {
      return (
        '<div class="key-row">' +
        '<span class="action">' +
        ACTION_LABELS[action] +
        "</span>" +
        '<span class="binding">' +
        '<span class="key-badge" data-gp-badge="' +
        action +
        '">Botón ' +
        gpmap[action] +
        "</span>" +
        '<button class="btn btn-set" data-gp-remap="' +
        action +
        '">Set</button>' +
        "</span></div>"
      );
    }).join("");

    $all("[data-gp-remap]", list).forEach(function (btn) {
      btn.addEventListener("click", function () {
        startListeningGamepad(btn.getAttribute("data-gp-remap"), btn);
      });
    });
  }

  function startListeningGamepad(action, btn) {
    if (state.listeningAction) return;
    state.listeningAction = "gp:" + action;
    btn.classList.add("is-listening");
    btn.textContent = "…";

    var poll = setInterval(function () {
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var p = 0; p < pads.length; p++) {
        var pad = pads[p];
        if (!pad) continue;
        for (var b = 0; b < pad.buttons.length; b++) {
          if (pad.buttons[b].pressed) {
            var gpmap = loadJSON(GPMAP_STORAGE_KEY, DEFAULT_GAMEPAD_MAP);
            gpmap[action] = b;
            saveJSON(GPMAP_STORAGE_KEY, gpmap);
            clearInterval(poll);
            state.listeningAction = null;
            renderGamepadTab();
            return;
          }
        }
      }
    }, 80);

    // Se cancela solo si el modal se cierra o pasan 8s sin input
    setTimeout(function () {
      if (state.listeningAction === "gp:" + action) {
        clearInterval(poll);
        state.listeningAction = null;
        renderGamepadTab();
      }
    }, 8000);
  }

  // ---------- Puente Gamepad → teclado ----------
  // El motor escucha eventos de teclado reales (keydown/keyup)
  // según el keymap pasado en player1. En vez de duplicar la
  // lógica de input dentro del motor, el gamepad se traduce a
  // eventos de teclado sintéticos usando el keymap ACTUAL — así
  // remapear el teclado remapea automáticamente lo que dispara
  // el control físico también.

  var gpPressedState = {};

  function pollGamepadBridge() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var anyConnected = false;
    var gpmap = loadJSON(GPMAP_STORAGE_KEY, DEFAULT_GAMEPAD_MAP);
    var keymap = currentKeymap();

    for (var p = 0; p < pads.length; p++) {
      var pad = pads[p];
      if (!pad) continue;
      anyConnected = true;

      ACTION_ORDER.forEach(function (action) {
        var idx = gpmap[action];
        var btn = pad.buttons[idx];
        var pressed = !!(btn && btn.pressed);

        // D-pad como eje analógico (algunos mandos lo reportan así)
        if (!pressed && pad.axes && pad.axes.length >= 2) {
          if (action === "left") pressed = pad.axes[0] < -0.5;
          if (action === "right") pressed = pad.axes[0] > 0.5;
          if (action === "up") pressed = pad.axes[1] < -0.5;
          if (action === "down") pressed = pad.axes[1] > 0.5;
        }

        var key = "p" + p + ":" + action;
        var was = !!gpPressedState[key];
        if (pressed && !was) {
          document.dispatchEvent(
            new KeyboardEvent("keydown", { code: keymap[action], bubbles: true })
          );
        } else if (!pressed && was) {
          document.dispatchEvent(
            new KeyboardEvent("keyup", { code: keymap[action], bubbles: true })
          );
        }
        gpPressedState[key] = pressed;
      });
    }

    updateGamepadBar(anyConnected);
    requestAnimationFrame(pollGamepadBridge);
  }

  function updateGamepadBar(connected) {
    var bar = $("#gamepad-bar");
    var tag = $("#gamepad-tag");
    var label = $("#gamepad-label");
    if (bar) bar.classList.toggle("is-connected", connected);
    if (tag) tag.textContent = connected ? "✓ OK" : "⚠ ERROR";
    if (label)
      label.textContent = connected
        ? "🕹️ Control conectado"
        : "🕹️ Control no detectado - Conectá un control y presioná cualquier botón";
  }

  // ---------- Restablecer keymap/gpmap por defecto ----------

  function setupResetDefaults() {
    var kbBtn = $("#btn-reset-keymap");
    var gpBtn = $("#btn-reset-gpmap");
    if (kbBtn)
      kbBtn.addEventListener("click", function () {
        saveJSON(KEYMAP_STORAGE_KEY, DEFAULT_KEYMAP);
        renderKeyboardTab();
      });
    if (gpBtn)
      gpBtn.addEventListener("click", function () {
        saveJSON(GPMAP_STORAGE_KEY, DEFAULT_GAMEPAD_MAP);
        renderGamepadTab();
      });
  }

  // ---------- Init ----------

  function init() {
    setupSearch();
    setupCarouselNav();
    setupManualLoad();
    setupConsoleControls();
    setupGlobalShortcuts();
    setupModal();
    setupResetDefaults();
    loadGameLibrary();
    requestAnimationFrame(pollGamepadBridge);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
