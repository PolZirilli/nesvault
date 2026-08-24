#!/usr/bin/env python3
"""
match_covers.py — NESvault

Completa el campo "cover" de data/games.json buscando el arte de
tapa real en libretro-thumbnails (mismo repo que usa RetroArch,
sin API key), carpeta:

    Nintendo - Nintendo Entertainment System / Named_Boxarts

Usa el repo espejo individual (más liviano que el monorepo completo):
    https://github.com/libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System

Algoritmo, igual criterio que GENvault/SNESvault:
    1. Normaliza el nombre del juego y el nombre de cada archivo
       de tapa disponible (minúsculas, sin paréntesis/corchetes,
       sin puntuación, espacios colapsados).
    2. Intenta match EXACTO entre nombres normalizados.
    3. Si no hay exacto, busca el mejor match FUZZY (difflib) por
       encima de un umbral de similitud; si no llega al umbral,
       no asigna cover (mejor sin tapa que con la tapa equivocada).

Solo usa la librería estándar de Python (sin requests/bs4), para
poder correr en cualquier entorno sin instalar dependencias.

Uso:
    python3 py/match_covers.py
    python3 py/match_covers.py --games-json data/games.json --threshold 0.72
"""

import argparse
import difflib
import json
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import quote as urlquote

GITHUB_API_TREE_URL = (
    "https://api.github.com/repos/"
    "libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System/"
    "git/trees/master?recursive=1"
)
RAW_BASE_URL = (
    "https://raw.githubusercontent.com/"
    "libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System/"
    "master/Named_Boxarts/"
)
BOXART_PREFIX = "Named_Boxarts/"

PAREN_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize(name):
    name = name.lower()
    name = PAREN_RE.sub(" ", name)
    name = NON_ALNUM_RE.sub(" ", name)
    return " ".join(name.split())


def fetch_boxart_filenames():
    req = urllib.request.Request(
        GITHUB_API_TREE_URL, headers={"User-Agent": "nesvault-match-covers"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        print(f"Error consultando GitHub API: {e}", file=sys.stderr)
        if e.code == 403:
            print(
                "Puede ser rate-limit de GitHub API sin autenticar "
                "(60 req/hora por IP). Reintentá en un rato.",
                file=sys.stderr,
            )
        sys.exit(1)

    files = []
    for entry in data.get("tree", []):
        path = entry.get("path", "")
        if path.startswith(BOXART_PREFIX) and path.lower().endswith(".png"):
            files.append(path[len(BOXART_PREFIX):])
    return files


def build_index(filenames):
    index = {}
    for fname in filenames:
        base = fname[:-4] if fname.lower().endswith(".png") else fname
        norm = normalize(base)
        index.setdefault(norm, fname)
    return index


def find_match(game_name, index, threshold):
    norm = normalize(game_name)
    if norm in index:
        return index[norm], 1.0

    best_file, best_ratio = None, 0.0
    for norm_key, fname in index.items():
        ratio = difflib.SequenceMatcher(None, norm, norm_key).ratio()
        if ratio > best_ratio:
            best_ratio, best_file = ratio, fname

    if best_ratio >= threshold:
        return best_file, best_ratio
    return None, best_ratio


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--games-json", default="data/games.json")
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.72,
        help="Umbral mínimo de similitud fuzzy (0-1). Default 0.72.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No escribe el archivo, solo muestra qué haría.",
    )
    args = parser.parse_args()

    with open(args.games_json, "r", encoding="utf-8") as f:
        games = json.load(f)

    print("Descargando índice de tapas desde libretro-thumbnails…")
    filenames = fetch_boxart_filenames()
    print(f"  {len(filenames)} tapas encontradas.")
    index = build_index(filenames)

    matched, unmatched = 0, 0
    for game in games:
        name = game.get("name", "")
        if not name:
            continue
        fname, ratio = find_match(name, index, args.threshold)
        if fname:
            cover_url = RAW_BASE_URL + urlquote(fname)
            if game.get("cover") != cover_url:
                print(f"  [OK] {name!r} -> {fname} (score {ratio:.2f})")
            game["cover"] = cover_url
            matched += 1
        else:
            print(f"  [--] {name!r} sin match (mejor score {ratio:.2f})")
            unmatched += 1

    print(f"\nListo: {matched} con tapa, {unmatched} sin tapa.")

    if not args.dry_run:
        with open(args.games_json, "w", encoding="utf-8") as f:
            json.dump(games, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"Guardado en {args.games_json}")
    else:
        print("(dry-run, no se escribió nada)")


if __name__ == "__main__":
    main()
