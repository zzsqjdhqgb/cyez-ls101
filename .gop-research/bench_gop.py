import importlib.util,time,torch
p='/tmp/ctc-gop-research/is24/generate-GOP/gop-ctc-af-S.py'
spec=importlib.util.spec_from_file_location('up',p); up=importlib.util.module_from_spec(spec); spec.loader.exec_module(up)
x=torch.load('/workspace/.gop-research/logits.pt',map_location='cpu',weights_only=False)['post']
# target ids from transcript
v=up.Wav2Vec2CTCTokenizer.from_pretrained('/workspace/.gop-research/model',local_files_only=True)
phones='DH AH R AE P AH D D IH V EH L AH P M AH N T AH V AA R T AH F IH SH AH L IH N T EH L AH JH AH N S HH AE Z R EY Z D IH M P AO R T AH N T K W EH S CH AH N Z AH B AW T DH AH F Y UW CH ER AH V EH M P L OY M AH N T AH N D DH AH S K IH L Z DH AE T Y AH NG P IY P AH L N IY D T UW AH K W AY ER'.split()
ids=torch.tensor(v.convert_tokens_to_ids(phones),dtype=torch.int32)
print('T/L',x.shape,ids.shape)
torch.set_num_threads(1)
t=time.time(); ll=up.ctc_loss(x,ids,blank=0); print('self',ll.item(),'sec',time.time()-t)
for i in [0,1,10,50,115]:
 t=time.time(); d=up.ctc_loss_denom(x,ids,i,blank=0); print('denom',i,d.item(),'gop',(-ll+d).item(),'sec',time.time()-t)
