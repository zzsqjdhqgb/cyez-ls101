from pathlib import Path

import numpy as np
import torch
from scipy.io import wavfile
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

ROOT = Path('/workspace/.gop-research')
MODEL_DIR = ROOT / 'model'
AUDIO = ROOT / 'exam' / 'recording-1.wav'
OUTPUT = ROOT / 'exam' / 'logits.pt'

rate, audio = wavfile.read(AUDIO)
if rate != 16000:
    raise ValueError(f'expected 16 kHz input, got {rate}')
if audio.ndim != 1:
    raise ValueError(f'expected mono input, got shape {audio.shape}')
samples = audio.astype(np.float32) / 32768.0
processor = Wav2Vec2Processor.from_pretrained(MODEL_DIR, local_files_only=True)
model = Wav2Vec2ForCTC.from_pretrained(MODEL_DIR, local_files_only=True).eval()
with torch.inference_mode():
    inputs = processor(samples, sampling_rate=16000, return_tensors='pt').input_values
    logits = model(inputs).logits.squeeze(0)
post = logits.softmax(-1).double().transpose(0, 1).contiguous()
decoded = processor.batch_decode(logits.argmax(-1).unsqueeze(0))[0]
torch.save({'post': post, 'logits': logits.float(), 'audio': samples, 'decode': decoded}, OUTPUT)
print(f'output={OUTPUT}')
print(f'frames={post.shape[1]} decode={decoded!r}')
