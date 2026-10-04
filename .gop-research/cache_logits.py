from pathlib import Path
import numpy as np, torch
from scipy.io import wavfile
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
p=Path('/workspace/.gop-research/model')
rate,a=wavfile.read('/workspace/.gop-research/input/recording-0.wav')
a=a.astype('float32')/32768
proc=Wav2Vec2Processor.from_pretrained(p,local_files_only=True)
model=Wav2Vec2ForCTC.from_pretrained(p,local_files_only=True).eval()
with torch.inference_mode():
 x=proc(a,sampling_rate=16000,return_tensors='pt').input_values
 logits=model(x).logits.squeeze(0)
post=logits.softmax(-1).double().transpose(0,1).contiguous()
torch.save({'post':post,'logits':logits.float(),'audio':a,'decode':proc.batch_decode(logits.argmax(-1))[0]},'/workspace/.gop-research/logits.pt')
print(post.shape)
