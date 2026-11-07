import subprocess, json
starts=json.load(open("build/vo-starts.json")); total=json.load(open("build/schedule.json"))["total"]
ins=[];fl=[]
for i,(k,v) in enumerate(starts.items()):
    ins+=["-i",f"assets/vo/{k}.mp3"]; fl.append(f"[{i}:a]adelay={int(v*1000)}|{int(v*1000)},apad=whole_dur={total+1}[a{i}]")
fl.append("".join(f"[a{i}]" for i in range(len(starts)))+f"amix=inputs={len(starts)}:normalize=0,aformat=sample_fmts=fltp:channel_layouts=stereo[vo]")
subprocess.run(["ffmpeg","-v","error","-y",*ins,"-filter_complex",";".join(fl),"-map","[vo]","-ar","44100","build/vo-sum.wav"],check=True)
subprocess.run(["ffmpeg","-v","error","-y","-i","assets/score-raw.wav","-i","build/vo-sum.wav","-filter_complex",f"[0:a]volume=0.55[m];[m][1:a]sidechaincompress=threshold=0.02:ratio=9:attack=40:release=500:makeup=1[d];[d]atrim=0:{total}[o]","-map","[o]","-ar","44100","assets/score.wav"],check=True)
subprocess.run(["ffmpeg","-v","error","-y","-i","assets/score.wav","-i","build/vo-sum.wav","-filter_complex","[0:a][1:a]amix=inputs=2:normalize=0[o]","-map","[o]","build/preview-mix.wav"],check=True)
