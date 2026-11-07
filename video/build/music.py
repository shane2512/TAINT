import json
import numpy as np, json, wave
SR=44100; SCH=json.load(open('build/schedule.json')); S=SCH['seam']; T=SCH['total']+1.0; N=int(SR*T)
rng=np.random.default_rng(7)
BPM=100; beat=60/BPM
t=np.arange(N)/SR
L=np.zeros(N); R=np.zeros(N)
def add(sig,start,pan=0.0,gain=1.0):
    i=int(start*SR); 
    if i>=N: return
    s=sig[:N-i]*gain
    L[i:i+len(s)]+=s*(1-max(pan,0)); R[i:i+len(s)]+=s*(1+min(pan,0))
def env(n,a,r):
    e=np.ones(n); na=int(a*SR); nr=int(r*SR)
    if na>0: e[:na]=np.linspace(0,1,na)
    if nr>0: e[-nr:]*=np.linspace(1,0,nr)
    return e
from scipy.signal import lfilter
def lp(x,fc):  # one-pole lowpass
    a=float(np.exp(-2*np.pi*float(np.mean(fc))/SR)); return lfilter([1-a],[1,-a],x)
def hz(m): return 440*2**((m-69)/12)
# section intensity curve (0..1) by time
P=S['product']+.4; marks=[(0,.25),(S['gap'],.35),(P-.3,.35),(P,.75),(S['how'],.8),(S['stack'],.95),(S['tracks'],.85),(S['demo'],.7),(S['demo']+17,.7),(S['close']-.5,.45),(S['close'],1.0),(S['close']+4,.6),(T,0)]
tt=[m[0] for m in marks]; vv=[m[1] for m in marks]
inten=np.interp(t,tt,vv)
# drone A1
dr=np.sin(2*np.pi*55*t)+.4*np.sin(2*np.pi*110*t+.3)+.15*np.sin(2*np.pi*165*t)
dr*=0.16*(.6+.4*np.sin(2*np.pi*t/9.6)**2)*inten**.7
L+=dr; R+=dr
# pad chords: Am F C G, 2 bars each (4.8s)
chords=[[57,60,64],[53,57,60],[48,52,55],[55,59,62]]
bar2=beat*8
k=0; start=0.0
while start<T:
    ch=chords[k%4]; n=int(SR*(bar2+1.5)); tp=np.arange(n)/SR
    sig=np.zeros(n)
    for m in ch+[ch[0]+12]:
        for det in (-.07,0,.07):
            f=hz(m)*2**(det/12)
            for h,a in ((1,1),(2,.5),(3,.28),(4,.14)):
                sig+=a*np.sin(2*np.pi*f*h*tp+rng.uniform(0,6.28))
    sig=lp(sig,1100+700*np.sin(tp/bar2*np.pi))
    e=env(n,1.4,1.6); sig=sig/np.max(np.abs(sig))*.30*e
    i=int(start*SR); m_=sig[:N-i]; g=np.interp(np.arange(len(m_))/SR+start,tt,vv)
    L[i:i+len(m_)]+=m_*g; R[i:i+len(m_)]+=m_*g*.97
    start+=bar2; k+=1
# arp plucks (8ths) from 12s; louder from 25.8
def pluck(f,dur=.5):
    n=int(SR*dur); tp=np.arange(n)/SR
    s=np.sin(2*np.pi*f*tp)+.35*np.sin(2*np.pi*2*f*tp)+.12*np.sin(2*np.pi*3*f*tp)
    return s*np.exp(-tp*7)*.9
step=beat/2; idx=0; x=12.0
pat=[0,1,2,1,0,2,1,2]
while x<T-6:
    ch=chords[int((x//bar2))%4]
    mnote=ch[pat[idx%8]]+12+(12 if idx%16>=8 else 0)
    g=.10 if x<P else .17
    if S['demo']<x<S['close']: g=.12
    if x>S['close']: g=.14
    add(pluck(hz(mnote)),x,pan=(-.3 if idx%2 else .3),gain=g*np.interp(x,tt,vv)**.8)
    idx+=1; x+=step
# kick + hats in the driving sections
def kick():
    n=int(SR*.45); tp=np.arange(n)/SR
    f=45+90*np.exp(-tp*28); ph=2*np.pi*np.cumsum(f)/SR
    return np.sin(ph)*np.exp(-tp*9)
def hat():
    n=int(SR*.06); tp=np.arange(n)/SR
    nz=rng.standard_normal(n); nz=nz-lp(nz,6000)
    return nz*np.exp(-tp*70)
KK=kick(); HH=hat()
def driving(a,b,kg,hg):
    x=a
    while x<b:
        add(KK,x,gain=kg*np.interp(x,tt,vv))
        add(HH,x+beat/2,pan=.25,gain=hg*np.interp(x,tt,vv))
        x+=beat
driving(P,S['stack'],.55,.05)
driving(S['stack'],S['tracks'],.62,.07)
driving(S['tracks'],S['demo'],.55,.06)
driving(S['demo'],S['close'],.28,.03)
# soft heartbeat intro (problem scenes)
x=1.0
while x<P-.3:
    add(KK,x,gain=.18); x+=beat*2
# riser + impact
def riser(d):
    n=int(SR*d); tp=np.arange(n)/SR
    nz=rng.standard_normal(n); out=np.zeros(n); 
    fc=np.linspace(300,7000,n)
    # crude time-varying filter via blocks
    for b in range(0,n,2048):
        blk=nz[b:b+2048]; out[b:b+2048]=blk-lp(blk,float(fc[b]))*0.0
    out=lp(out,5000)
    return out*np.linspace(0,1,n)**2.2
def impact():
    n=int(SR*3.2); tp=np.arange(n)/SR
    b=np.sin(2*np.pi*(38+60*np.exp(-tp*6))*tp)*np.exp(-tp*1.6)
    nz=lp(rng.standard_normal(n),900)*np.exp(-tp*2.2)
    return b*1.0+nz*.5
def whoosh(d=.7):
    n=int(SR*d); tp=np.arange(n)/SR
    nz=rng.standard_normal(n); y=lp(nz,2500)-lp(nz,300)
    return y*np.sin(np.pi*tp/d)**2
RS=riser(2.2); IM=impact()
add(RS,P-2.2,gain=.20); add(IM,P,gain=.55)
add(RS,S['stack']-1.2,gain=.12)
add(RS,S['close']-2.4,gain=.22); add(IM,S['close'],gain=.70)
for s in (S['gap'],S['how'],S['stack'],S['tracks'],S['demo']):
    add(whoosh(),s-.1,pan=.2,gain=.20)
for s in (S['product'],):
    add(whoosh(.5),s-.2,gain=.2)
# master
m=np.max(np.abs(np.stack([L,R])))
L/=m; R/=m
fade=np.ones(N); nf=int(SR*3.5); fade[-nf:]=np.linspace(1,0,nf); fade[:int(SR*.8)]=np.linspace(0,1,int(SR*.8))
L*=fade*.9; R*=fade*.9
out=(np.stack([L,R],1)*32767).astype(np.int16)
with wave.open("assets/score-raw.wav","wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
print("ok")
