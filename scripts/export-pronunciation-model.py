#!/usr/bin/env python3
"""从钉住的 charsiu 源权重导出应用使用的 ONNX 发音模型资产。

上游没有可直接下载的 ONNX，因此运行时资产由本脚本在本地导出：

1. 读取已经过 SHA-256 校验的源权重目录（charsiu/en_w2v2_ctc_libris_and_cv）
   与 CMU 音素 tokenizer 目录（charsiu/tokenizer_en_cmu）；
2. 用 TorchScript 导出器导出 `input_values -> logits` 的 fp32 ONNX（动态时间轴）；
3. 只对 MatMul 做 INT8 动态量化（卷积与特征提取保持 fp32，避免量化破坏声学特征）；
4. 写出运行时目录：config.json、vocab.json、preprocessor_config.json、
   onnx/model_quantized.onnx，并输出各文件的 size 与 SHA-256 供调用方核对。

需要 Python 3.10+ 与 torch / transformers / onnx / onnxruntime。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

PREPROCESSOR_CONFIG = {
    "do_normalize": True,
    "feature_extractor_type": "Wav2Vec2FeatureExtractor",
    "feature_size": 1,
    "padding_side": "right",
    "padding_value": 0,
    "return_attention_mask": True,
    "sampling_rate": 16000,
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True, type=Path, help="校验过的源权重目录")
    parser.add_argument("--tokenizer-dir", required=True, type=Path, help="校验过的 tokenizer 目录")
    parser.add_argument("--output", required=True, type=Path, help="运行时资产输出目录")
    parser.add_argument("--work-dir", type=Path, help="导出中间文件目录（默认使用临时目录）")
    return parser.parse_args(argv)


def export_onnx(model_dir: Path, work_dir: Path) -> Path:
    import torch
    from transformers import Wav2Vec2ForCTC

    class LogitsOnly(torch.nn.Module):
        def __init__(self, model: torch.nn.Module) -> None:
            super().__init__()
            self.model = model

        def forward(self, input_values):  # noqa: ANN001, ANN201
            return self.model(input_values).logits

    model = Wav2Vec2ForCTC.from_pretrained(str(model_dir), local_files_only=True).eval()
    wrapper = LogitsOnly(model).eval()
    fp32_path = work_dir / "model.onnx"
    torch.onnx.export(
        wrapper,
        (torch.randn(1, 16_000),),
        str(fp32_path),
        input_names=["input_values"],
        output_names=["logits"],
        dynamic_axes={
            "input_values": {0: "batch", 1: "samples"},
            "logits": {0: "batch", 1: "frames"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )
    return fp32_path


def quantize(fp32_path: Path, output_path: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(
        str(fp32_path),
        str(output_path),
        weight_type=QuantType.QInt8,
        op_types_to_quantize=["MatMul"],
    )


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    for directory in (args.model_dir, args.tokenizer_dir):
        if not directory.is_dir():
            raise SystemExit(f"源目录不存在：{directory}")
    onnx_dir = args.output / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=args.work_dir) as temporary:
        work_dir = Path(temporary)
        fp32_path = export_onnx(args.model_dir, work_dir)
        quantize(fp32_path, onnx_dir / "model_quantized.onnx")

    shutil.copy(args.model_dir / "config.json", args.output / "config.json")
    shutil.copy(args.tokenizer_dir / "vocab.json", args.output / "vocab.json")
    # 必须用 write_bytes 固定 LF：文本模式在 Windows 上会把 \n 转成 \r\n，
    # 产物大小与 SHA-256 就会与固定清单不一致（安装路径会把它判为损坏并删除）。
    (args.output / "preprocessor_config.json").write_bytes(
        (json.dumps(PREPROCESSOR_CONFIG, indent=2) + "\n").encode("utf8")
    )

    summary = []
    for relative in (
        "config.json",
        "vocab.json",
        "preprocessor_config.json",
        "onnx/model_quantized.onnx",
    ):
        path = args.output / relative
        summary.append(
            {"path": relative, "size": path.stat().st_size, "sha256": sha256_file(path)}
        )
    print(json.dumps({"modelDir": str(args.model_dir), "runtime": summary}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
