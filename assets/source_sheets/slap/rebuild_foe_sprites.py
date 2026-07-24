#!/usr/bin/env python3
"""Rebuild the seven runtime poses for every promotion opponent atlas.

The two unused cells in each 3x3 atlas are intentionally ignored.  Boss-only
poses (guard, special, and taunt) live outside the atlas and are left intact.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from rebuild_runtime_sprites import (
    DEFAULT_CHROMA_HELPER,
    REPO_ROOT,
    SCRIPT_DIR,
    _rebuild_atlas,
)


POSES = (
    "idle",
    "windup",
    "slap_left",
    "slap_right",
    "hit",
    "dodge",
    "ko",
)

FOES = (
    "jopssal",
    "barley",
    "corn",
    "potato",
    "sweetpotato",
    "wheat",
    "pea",
    "peanut",
    "walnut",
    "brownrice",
    "blackrice",
    "chapssal",
    "nurungji",
    "riceball",
    "gimbap",
    "garaetteok",
    "injeolmi",
    "ricebag_king",
)


def rebuild(chroma_helper: Path) -> None:
    if not chroma_helper.is_file():
        raise FileNotFoundError(f"Chroma-key helper not found: {chroma_helper}")

    foe_dir = REPO_ROOT / "assets" / "foes"
    atlas_dir = SCRIPT_DIR / "foes"
    for foe in FOES:
        outputs = [foe_dir / f"{foe}_{pose}.png" for pose in POSES]
        _rebuild_atlas(
            atlas_dir / f"{foe}-atlas.png",
            outputs,
            chroma_helper,
            preserve_enclosed_key_colors=foe
            in {"barley", "corn", "potato", "sweetpotato", "wheat", "pea"},
        )

    print(f"Rebuilt {len(FOES) * len(POSES)} runtime PNGs from {len(FOES)} foe atlases.")
    print("Preserved ricebag_king_guard/special/taunt.png unchanged.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--chroma-helper",
        type=Path,
        default=DEFAULT_CHROMA_HELPER,
        help="Path to the ImageGen remove_chroma_key.py helper.",
    )
    args = parser.parse_args()
    rebuild(args.chroma_helper.expanduser().resolve())


if __name__ == "__main__":
    main()
