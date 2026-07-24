#!/usr/bin/env python3
"""Rebuild normalized runtime sprites from the canonical 3x3 player atlases.

The atlas dividers are detected from their actual pixel positions instead of
assuming equal thirds.  This prevents a shifted white gutter (the original
slap_king issue) from becoming an opaque line in a runtime sprite.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from PIL import Image


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
DEFAULT_CHROMA_HELPER = (
    Path.home()
    / ".codex"
    / "skills"
    / ".system"
    / "imagegen"
    / "scripts"
    / "remove_chroma_key.py"
)

POSES = (
    "idle",
    "windup_right",
    "slap_right",
    "windup_left",
    "slap_left",
    "spin",
    "hit",
    "dodge",
    "win",
)

SKINS = (
    "work_glove",
    "rubber_glove",
    "pasu",
    "suit",
    "golf",
    "hiking",
    "cyborg",
    "midas",
    "slap_king",
)


def _near_white(rgb: tuple[int, int, int]) -> bool:
    return min(rgb) >= 244 and max(rgb) - min(rgb) <= 12


def _runs(values: list[int]) -> list[tuple[int, int]]:
    if not values:
        return []
    found: list[tuple[int, int]] = []
    start = previous = values[0]
    for value in values[1:]:
        if value != previous + 1:
            found.append((start, previous))
            start = value
        previous = value
    found.append((start, previous))
    return found


def _white_bands(image: Image.Image, *, vertical: bool) -> list[tuple[int, int]]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    axis_length = width if vertical else height
    cross_length = height if vertical else width
    sample_step = max(1, cross_length // 400)
    sample_positions = range(0, cross_length, sample_step)
    sample_count = len(sample_positions)

    white_axes: list[int] = []
    for axis in range(axis_length):
        count = 0
        for cross in sample_positions:
            pixel = pixels[axis, cross] if vertical else pixels[cross, axis]
            if _near_white(pixel):
                count += 1
        if count / sample_count >= 0.92:
            white_axes.append(axis)

    return [run for run in _runs(white_axes) if run[1] - run[0] + 1 >= 3]


def _pick_grid_bands(
    bands: list[tuple[int, int]], axis_length: int
) -> tuple[tuple[int, int], tuple[int, int]]:
    selected: list[tuple[int, int]] = []
    for fraction in (1 / 3, 2 / 3):
        target = axis_length * fraction
        candidates = [
            band
            for band in bands
            if abs(((band[0] + band[1]) / 2) - target) <= axis_length * 0.14
        ]
        if not candidates:
            raise RuntimeError(
                f"Could not find a white divider near {fraction:.0%}; bands={bands}"
            )
        selected.append(
            min(candidates, key=lambda band: abs(((band[0] + band[1]) / 2) - target))
        )
    if selected[0][1] >= selected[1][0]:
        raise RuntimeError(f"Invalid divider order: {selected}")
    return selected[0], selected[1]


def _cell_intervals(
    length: int, bands: tuple[tuple[int, int], tuple[int, int]]
) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    outer_inset = 4
    gutter_inset = 2
    first, second = bands
    intervals = (
        (outer_inset, first[0] - gutter_inset),
        (first[1] + 1 + gutter_inset, second[0] - gutter_inset),
        (second[1] + 1 + gutter_inset, length - outer_inset),
    )
    if any(end <= start for start, end in intervals):
        raise RuntimeError(f"Invalid cell intervals: {intervals}")
    return intervals


def _remove_chroma(
    source: Path, destination: Path, chroma_helper: Path
) -> None:
    subprocess.run(
        [
            sys.executable,
            str(chroma_helper),
            "--input",
            str(source),
            "--out",
            str(destination),
            "--auto-key",
            "border",
            "--soft-matte",
            "--despill",
            "--edge-contract",
            "1",
            "--force",
        ],
        check=True,
    )


def _normalize(source: Path, destination: Path) -> None:
    with Image.open(source).convert("RGBA") as sprite:
        normalized = sprite.resize((500, 500), Image.Resampling.LANCZOS)
        # Lanczos can revive a handful of low-alpha green pixels from the
        # chroma fringe.  They show up as tiny green sparks on dark screens.
        # No player wardrobe uses chroma-green, so discard only strongly
        # green-dominant, low-alpha remnants after the resize.
        pixels = []
        flattened = getattr(normalized, "get_flattened_data", None)
        source_pixels = flattened() if flattened else normalized.getdata()
        for red, green, blue, alpha in source_pixels:
            if alpha <= 96 and green > max(red, blue) + 16:
                pixels.append((0, 0, 0, 0))
            else:
                pixels.append((red, green, blue, alpha))
        normalized.putdata(pixels)
        canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        canvas.alpha_composite(normalized, (6, 6))
        destination.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(destination, format="PNG", optimize=True)


def _rebuild_atlas(
    atlas_path: Path,
    output_paths: list[Path],
    chroma_helper: Path,
) -> None:
    with Image.open(atlas_path).convert("RGBA") as atlas:
        width, height = atlas.size
        vertical = _pick_grid_bands(_white_bands(atlas, vertical=True), width)
        horizontal = _pick_grid_bands(_white_bands(atlas, vertical=False), height)
        columns = _cell_intervals(width, vertical)
        rows = _cell_intervals(height, horizontal)

        print(
            f"{atlas_path.name}: size={width}x{height}, "
            f"vertical={vertical}, horizontal={horizontal}"
        )

        with tempfile.TemporaryDirectory(prefix="ssal-slap-sprites-") as temp_name:
            temp_dir = Path(temp_name)
            for index, output_path in enumerate(output_paths):
                row, column = divmod(index, 3)
                left, right = columns[column]
                top, bottom = rows[row]
                crop_path = temp_dir / f"{index:02d}-crop.png"
                matte_path = temp_dir / f"{index:02d}-matte.png"
                atlas.crop((left, top, right, bottom)).save(crop_path, "PNG")
                _remove_chroma(crop_path, matte_path, chroma_helper)
                _normalize(matte_path, output_path)


def rebuild(chroma_helper: Path) -> None:
    if not chroma_helper.is_file():
        raise FileNotFoundError(f"Chroma-key helper not found: {chroma_helper}")

    char_dir = REPO_ROOT / "assets" / "char"
    base_outputs = [char_dir / f"char_{pose}.png" for pose in POSES]
    _rebuild_atlas(SCRIPT_DIR / "player_base_atlas.png", base_outputs, chroma_helper)
    shutil.copy2(base_outputs[0], REPO_ROOT / "assets" / "skins" / "plain.png")

    pose_dir = REPO_ROOT / "assets" / "skins" / "poses"
    skin_dir = REPO_ROOT / "assets" / "skins"
    for skin in SKINS:
        outputs = [pose_dir / f"{skin}_{pose}.png" for pose in POSES]
        _rebuild_atlas(
            SCRIPT_DIR / "skins" / f"{skin}_atlas.png", outputs, chroma_helper
        )
        shutil.copy2(outputs[0], skin_dir / f"{skin}.png")

    print("Rebuilt 100 runtime PNGs from 10 canonical atlases.")


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
