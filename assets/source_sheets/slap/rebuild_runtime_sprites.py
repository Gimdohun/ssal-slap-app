#!/usr/bin/env python3
"""Rebuild normalized runtime sprites from the canonical 3x3 player atlases.

The atlas dividers are detected from their actual pixel positions instead of
assuming equal thirds.  This prevents a shifted white gutter (the original
slap_king issue) from becoming an opaque line in a runtime sprite.
"""

from __future__ import annotations

import argparse
from collections import Counter, deque
from pathlib import Path
import shutil
from statistics import median
import subprocess
import sys
import tempfile

from PIL import Image, ImageFilter


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
    length: int,
    bands: tuple[tuple[int, int], tuple[int, int]],
    all_bands: list[tuple[int, int]] | None = None,
) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    outer_inset = 4
    # Leave a few pixels beyond the detected white divider. ImageGen can
    # feather a divider corner just outside the mostly-white band; without
    # this margin that residue becomes a detached white speck or line.
    gutter_inset = 4
    first, second = bands
    outer_start = outer_inset
    outer_end = length - outer_inset
    if all_bands:
        leading = next((band for band in all_bands if band[0] <= 2), None)
        trailing = next(
            (band for band in reversed(all_bands) if band[1] >= length - 3),
            None,
        )
        if leading:
            outer_start = leading[1] + 1 + gutter_inset
        if trailing:
            outer_end = trailing[0] - gutter_inset
    intervals = (
        (outer_start, first[0] - gutter_inset),
        (first[1] + 1 + gutter_inset, second[0] - gutter_inset),
        (second[1] + 1 + gutter_inset, outer_end),
    )
    if any(end <= start for start, end in intervals):
        raise RuntimeError(f"Invalid cell intervals: {intervals}")
    return intervals


def _equal_cell_intervals(length: int) -> tuple[tuple[int, int], ...]:
    """Fallback for older atlases whose three cells share one chroma field."""

    boundaries = (0, round(length / 3), round(length * 2 / 3), length)
    inset = max(3, round(length / 384))
    intervals = tuple(
        (boundaries[index] + inset, boundaries[index + 1] - inset)
        for index in range(3)
    )
    if any(end <= start for start, end in intervals):
        raise RuntimeError(f"Invalid equal-third cell intervals: {intervals}")
    return intervals


def _sample_chroma_key(source: Path) -> tuple[int, int, int]:
    """Find the saturated backdrop without averaging white frame pixels.

    Some generated atlases have a thin white outer frame.  Sampling the raw
    border in those cells produces a pale key color and can make the whole
    character partially transparent.  The backdrop still dominates the
    saturated border pixels, so select their largest quantized color cluster.
    This also supports the magenta key used by the brown-rice atlas.
    """

    with Image.open(source).convert("RGB") as image:
        width, height = image.size
        pixels = image.load()
        band = max(6, min(width, height) // 32)
        saturated: list[tuple[int, int, int]] = []
        for y in range(height):
            for x in range(width):
                if band <= x < width - band and band <= y < height - band:
                    continue
                red, green, blue = pixels[x, y]
                if (
                    max(red, green, blue) >= 128
                    and max(red, green, blue) - min(red, green, blue) >= 48
                ):
                    saturated.append((red, green, blue))

        if not saturated:
            raise RuntimeError(f"Could not sample a saturated chroma key from {source}")

        cluster_counts = Counter(
            (red // 16, green // 16, blue // 16)
            for red, green, blue in saturated
        )
        dominant = cluster_counts.most_common(1)[0][0]
        samples = [
            pixel
            for pixel in saturated
            if all(
                abs(pixel[channel] // 16 - dominant[channel]) <= 1
                for channel in range(3)
            )
        ]
        return tuple(
            int(round(median(pixel[channel] for pixel in samples)))
            for channel in range(3)
        )


def _remove_chroma(
    source: Path,
    destination: Path,
    chroma_helper: Path,
    preserve_enclosed_key_colors: bool,
) -> None:
    key = _sample_chroma_key(source)
    subprocess.run(
        [
            sys.executable,
            str(chroma_helper),
            "--input",
            str(source),
            "--out",
            str(destination),
            "--key-color",
            f"#{key[0]:02x}{key[1]:02x}{key[2]:02x}",
            "--tolerance",
            "80",
            "--force",
        ],
        check=True,
    )
    if preserve_enclosed_key_colors:
        _restore_enclosed_key_colors(source, destination)
    _contract_and_despill_matte(destination, key)


def _restore_enclosed_key_colors(source: Path, matte_path: Path) -> None:
    """Keep key-colored costume/body regions that are enclosed by an outline.

    A hard color key alone removes the pea pod and other green character parts.
    True backdrop pixels form one component connected to the cell border, while
    those character colors sit inside the black silhouette.  Retain only the
    border-connected transparent component, then contract it by one pixel to
    remove the remaining chroma fringe.
    """

    with Image.open(source).convert("RGBA") as original, Image.open(
        matte_path
    ).convert("RGBA") as keyed:
        width, height = original.size
        keyed_alpha = keyed.getchannel("A")
        flattened = getattr(keyed_alpha, "get_flattened_data", None)
        keyed_values = flattened() if flattened else keyed_alpha.getdata()
        candidates = bytearray(1 if alpha == 0 else 0 for alpha in keyed_values)
        outside = bytearray(width * height)
        queue: deque[int] = deque()

        def add_seed(x: int, y: int) -> None:
            index = y * width + x
            if candidates[index] and not outside[index]:
                outside[index] = 1
                queue.append(index)

        for x in range(width):
            add_seed(x, 0)
            add_seed(x, height - 1)
        for y in range(height):
            add_seed(0, y)
            add_seed(width - 1, y)

        while queue:
            index = queue.popleft()
            x = index % width
            y = index // width
            for next_x, next_y in (
                (x - 1, y),
                (x + 1, y),
                (x, y - 1),
                (x, y + 1),
                (x - 1, y - 1),
                (x + 1, y - 1),
                (x - 1, y + 1),
                (x + 1, y + 1),
            ):
                if not (0 <= next_x < width and 0 <= next_y < height):
                    continue
                next_index = next_y * width + next_x
                if candidates[next_index] and not outside[next_index]:
                    outside[next_index] = 1
                    queue.append(next_index)

        outside_count = sum(outside)
        if outside_count < width * height * 0.2:
            raise RuntimeError(
                f"Border-connected chroma area is unexpectedly small in {source}: "
                f"{outside_count}/{width * height}"
            )

        alpha = Image.new("L", (width, height), 255)
        alpha.putdata([0 if transparent else 255 for transparent in outside])
        original.putalpha(alpha)
        original.save(matte_path, format="PNG", optimize=True)


def _contract_and_despill_matte(
    matte_path: Path, key: tuple[int, int, int]
) -> None:
    """Remove the final one-pixel key fringe without tinting the silhouette."""

    with Image.open(matte_path).convert("RGBA") as image:
        alpha = image.getchannel("A").filter(ImageFilter.MinFilter(3))
        image.putalpha(alpha)
        near_background = alpha.filter(ImageFilter.MinFilter(5))
        pixels = image.load()
        near_pixels = near_background.load()
        width, height = image.size

        key_max = max(key)
        spill_channels = [
            channel
            for channel, value in enumerate(key)
            if value >= 128 and value >= key_max - 16
        ]
        other_channels = [
            channel for channel in range(3) if channel not in spill_channels
        ]

        for y in range(height):
            for x in range(width):
                red, green, blue, pixel_alpha = pixels[x, y]
                if pixel_alpha == 0 or near_pixels[x, y] == 255:
                    continue
                channels = [red, green, blue]
                anchor = max(channels[channel] for channel in other_channels)
                for channel in spill_channels:
                    if channels[channel] > anchor + 6:
                        channels[channel] = anchor
                pixels[x, y] = (*channels, pixel_alpha)

        image.save(matte_path, format="PNG", optimize=True)


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
    *,
    preserve_enclosed_key_colors: bool = False,
) -> None:
    with Image.open(atlas_path).convert("RGBA") as atlas:
        width, height = atlas.size
        try:
            vertical_bands = _white_bands(atlas, vertical=True)
            vertical = _pick_grid_bands(vertical_bands, width)
            columns = _cell_intervals(width, vertical, vertical_bands)
        except RuntimeError:
            vertical = None
            columns = _equal_cell_intervals(width)
        try:
            horizontal_bands = _white_bands(atlas, vertical=False)
            horizontal = _pick_grid_bands(horizontal_bands, height)
            rows = _cell_intervals(height, horizontal, horizontal_bands)
        except RuntimeError:
            horizontal = None
            rows = _equal_cell_intervals(height)

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
                _remove_chroma(
                    crop_path,
                    matte_path,
                    chroma_helper,
                    preserve_enclosed_key_colors,
                )
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
