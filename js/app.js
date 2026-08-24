/* ============================================================
   NESvault — js/app.js
   Sigue las mismas convenciones que GENvault/SNESvault:
   - loadGameLibrary() lee data/games.json y descarta con
     typeof g.url === 'string' (evita el bug silencioso ya
     pisado en GENvault con la key `bundle` en vez de `url`).
   - getCarouselColumns() sincronizado 1:1 con los breakpoints
     de css/styles.css (.rom-page): >1180px → 5, ≤1180px → 3,
     ≤620px → 2. Si cambiás un breakpoint, cambiá los dos.
   - Motor: Nintendo.js (lrusso), vendorizado en js/vendor/.
     API global: embedNintendo({...}), y funciones sueltas
     resetNintendo(), toggleSoundNintendo(),
     downloadStateNintendo(), uploadStateNintendo(),
     requestEmulatorFullscreenNintendo().
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

  var state = {
    games: [],
    filtered: [],
    page: 0,
    columns: 5,
    listeningAction: null, // acción esperando una tecla nueva
    isPlaying: false,
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
        var coverHTML = game.cover
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

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var newCols = getCarouselColumns();
        if (newCols !== state.columns) {
          state.page = 0;
          renderCarousel();
        }
      }, 150);
    });
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

  function mountRom(name, arrayBuffer) {
    beforeMount();
    var keymap = currentKeymap();

    embedNintendo({
      container: gameContainerId,
      name: name,
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
        state.isPlaying = true;
        state.currentGameName = name;
        updateStatusBar();
      },
    });
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
        mountRom(game.name, buf);
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
    if (bar) bar.classList.remove("is-playing");
  }

  function setStatusError(name) {
    var label = $("#status-game");
    if (label) label.textContent = "Error al cargar " + name;
  }

  function updateStatusBar() {
    var bar = $("#status-bar");
    var label = $("#status-game");
    if (label) label.textContent = state.currentGameName;
    if (bar) bar.classList.toggle("is-playing", state.isPlaying);
  }

  function setupConsoleControls() {
    var resetBtn = $("#btn-reset");
    var fullscreenBtn = $("#btn-fullscreen");
    var controlsBtn = $("#btn-controls");

    if (resetBtn)
      resetBtn.addEventListener("click", function () {
        if (typeof resetNintendo === "function") resetNintendo();
      });

    if (fullscreenBtn)
      fullscreenBtn.addEventListener("click", function () {
        if (typeof requestEmulatorFullscreenNintendo === "function") {
          requestEmulatorFullscreenNintendo();
        }
      });

    if (controlsBtn)
      controlsBtn.addEventListener("click", openControlsModal);
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

  function renderKeyboardTab() {
    var list = $("#keyboard-list");
    if (!list) return;
    var keymap = currentKeymap();
    list.innerHTML = ACTION_ORDER.map(function (action) {
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
    }).join("");

    $all("[data-remap]", list).forEach(function (btn) {
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
    var label = $("#gamepad-label");
    if (bar) bar.classList.toggle("is-connected", connected);
    if (label)
      label.textContent = connected
        ? "Control detectado"
        : "Sin control conectado (opcional)";
  }

  // ---------- Init ----------

  function init() {
    setupSearch();
    setupCarouselNav();
    setupManualLoad();
    setupConsoleControls();
    setupModal();
    loadGameLibrary();
    requestAnimationFrame(pollGamepadBridge);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
