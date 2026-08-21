#!/usr/bin/env python3
"""Fit the startup logo's flat-color regions from a raster render.

The source is classified into semantic color masks, then Potrace fits each mask
with cubic Beziers. Ten smoothing configurations are emitted for quantitative
selection by evaluate-fit-candidates.mjs.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import cv2
from PIL import Image


PALETTE = {
    "blue": (2, 86, 191),
    "gold": (253, 166, 22),
    "orange": (253, 81, 8),
    "red": (239, 34, 24),
    "green": (10, 148, 34),
}

TRACE_PARTS = ("blue", "gold", "orange", "red", "green")

CANDIDATES = (
    {"name": "01_scale25", "scale": 0.25, "alphamax": 1.2, "opttolerance": 0.20},
    {"name": "02_scale33", "scale": 0.33, "alphamax": 1.2, "opttolerance": 0.20},
    {"name": "03_scale40", "scale": 0.40, "alphamax": 1.2, "opttolerance": 0.20},
    {"name": "04_scale50", "scale": 0.50, "alphamax": 1.2, "opttolerance": 0.20},
    {"name": "05_scale60", "scale": 0.60, "alphamax": 1.2, "opttolerance": 0.20},
    {"name": "06_scale75", "scale": 0.75, "alphamax": 1.2, "opttolerance": 0.20},
    {"name": "07_scale50_balanced", "scale": 0.50, "alphamax": 1.0, "opttolerance": 0.20},
    {"name": "08_scale50_soft", "scale": 0.50, "alphamax": 1.3, "opttolerance": 0.30},
    {"name": "09_scale40_balanced", "scale": 0.40, "alphamax": 1.0, "opttolerance": 0.15},
    {"name": "10_scale60_balanced", "scale": 0.60, "alphamax": 1.0, "opttolerance": 0.15},
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Rasterized source logo.")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--potrace", default="potrace")
    return parser.parse_args()


def classify(image: np.ndarray) -> dict[str, np.ndarray]:
    rgb = image[:, :, :3].astype(np.uint8)
    alpha = image[:, :, 3]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hue, saturation, value = cv2.split(hsv)
    hue = hue.astype(np.int16)
    hue_centers = np.array([107, 19, 9, 1, 66], dtype=np.int16)
    keys = list(PALETTE)
    direct = np.abs(hue[:, :, None] - hue_centers[None, None, :])
    distances = np.minimum(direct, 180 - direct)
    labels = distances.argmin(axis=2)
    colored = (saturation > 32) & (value > 55) & (alpha > 16) & (distances.min(axis=2) < 18)
    return {key: largest_component(colored & (labels == index)) for index, key in enumerate(keys)}


def largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if count <= 1:
        return mask
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == largest


def split_blue(mask: np.ndarray) -> dict[str, np.ndarray]:
    height, width = mask.shape
    y, x = np.ogrid[:height, :width]
    return {
        "blue-arch": largest_component(mask & (y <= 595)),
        "blue-left": largest_component(mask & (x < 315) & (y >= 545)),
        "blue-right": largest_component(mask & (x > 940) & (y >= 545) & (y <= 910)),
        "blue-boom": largest_component(mask & (x >= 590) & (y >= 790)),
    }


def write_mask(path: Path, mask: np.ndarray, scale: float = 1.0) -> None:
    pixels = np.where(mask, 0, 255).astype(np.uint8)
    image = Image.fromarray(pixels, mode="L")
    if scale != 1.0:
        size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
        image = image.resize(size, Image.Resampling.LANCZOS)
    image.save(path)


def trace_mask(
    mask_path: Path,
    output_path: Path,
    config: dict,
    potrace: str,
    width: int,
    height: int,
) -> tuple[str, str]:
    subprocess.run(
        [
            potrace,
            str(mask_path),
            "--svg",
            "--flat",
            "--turdsize",
            "12",
            "--alphamax",
            str(config["alphamax"]),
            "--opttolerance",
            str(config["opttolerance"]),
            "--unit",
            "10",
            "--width",
            f"{width}pt",
            "--height",
            f"{height}pt",
            "--output",
            str(output_path),
        ],
        check=True,
    )
    root = ET.parse(output_path).getroot()
    group = next(element for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "g")
    path = next(element for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "path")
    return group.attrib.get("transform", ""), path.attrib["d"]


def svg_for(parts: dict[str, tuple[str, str]], width: int, height: int) -> str:
    def actor(actor_id: str, part_name: str, fill: str) -> str:
        transform, path_data = parts[part_name]
        return (
            f'      <g id="{actor_id}">\n'
            f'        <path d="{path_data}" transform="{transform}" fill="{fill}"/>\n'
            "      </g>"
        )

    blue_transform, blue_path = parts["blue"]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="logo-title logo-desc">
  <title id="logo-title">曹二听说101 application icon</title>
  <desc id="logo-desc">Blue headphones surrounding three warm-color spirals and a green leaf.</desc>
  <defs>
    <path id="headphones-shape" d="{blue_path}" transform="{blue_transform}"/>
  </defs>
  <rect id="icon-tile" x="0" y="0" width="{width}" height="{height}" rx="214" fill="#fdfcfc"/>
  <g id="logo-lockup">
    <g id="headphones" fill="#0256bf"><use href="#headphones-shape"/></g>
    <g id="listening-mark">
{actor("gold-sweep", "gold", "#fda616")}
{actor("orange-sweep", "orange", "#fd5108")}
{actor("red-sweep", "red", "#ef2218")}
{actor("leaf", "green", "#0a9422")}
    </g>
  </g>
</svg>
'''


def main() -> None:
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    masks_dir = args.out_dir / "masks"
    traces_dir = args.out_dir / "traces"
    candidates_dir = args.out_dir / "candidates"
    masks_dir.mkdir(exist_ok=True)
    traces_dir.mkdir(exist_ok=True)
    candidates_dir.mkdir(exist_ok=True)

    image = np.asarray(Image.open(args.source).convert("RGBA"))
    height, width = image.shape[:2]
    masks = classify(image)
    masks.update(split_blue(masks["blue"]))

    for name in TRACE_PARTS:
        write_mask(masks_dir / f"{name}_full.pgm", masks[name])

    manifest = {"source": str(args.source), "size": [width, height], "palette": PALETTE, "candidates": []}
    for config in CANDIDATES:
        traced: dict[str, tuple[str, str]] = {}
        candidate_trace_dir = traces_dir / config["name"]
        candidate_masks_dir = masks_dir / config["name"]
        candidate_trace_dir.mkdir(exist_ok=True)
        candidate_masks_dir.mkdir(exist_ok=True)
        for part_name in TRACE_PARTS:
            mask_path = candidate_masks_dir / f"{part_name}.pgm"
            write_mask(mask_path, masks[part_name], config["scale"])
            traced[part_name] = trace_mask(
                mask_path,
                candidate_trace_dir / f"{part_name}.svg",
                config,
                args.potrace,
                width,
                height,
            )
        output = candidates_dir / f"{config['name']}.svg"
        output.write_text(svg_for(traced, width, height), encoding="utf-8")
        manifest["candidates"].append({**config, "svg": str(output)})

    (args.out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
