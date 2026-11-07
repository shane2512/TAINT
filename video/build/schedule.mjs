// Places each voiceover line after the previous one and derives the scene seams from them.
import fs from "node:fs"; import { execSync } from "node:child_process";
const keys = ["s1","s2","s3","s4","s5","s6","s7","s7b","s8"];
const dur = Object.fromEntries(keys.map((k) => [k, Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 assets/vo/${k}.mp3`).toString())]));
const GAP = 0.6, LEAD = 0.4, DEMO = 32.5, CLOSE = 9.4;
const start = { s1: 0.8 };
for (let i = 1; i < 7; i++) start[keys[i]] = +(start[keys[i - 1]] + dur[keys[i - 1]] + GAP).toFixed(2);
const names = ["problem","gap","product","how","stack","tracks","demo","close"];
const seam = {}; names.forEach((n, i) => { seam[n] = i === 0 ? 0 : +(start[keys[i]] ?? 0) - LEAD; });
start.s7b = +(start.s7 + dur.s7 + 0.5).toFixed(2); seam.demo = +(start.s7 - LEAD).toFixed(2); seam.close = +(seam.demo + DEMO).toFixed(2);
start.s8 = +(seam.close + LEAD).toFixed(2);
for (const n of names) seam[n] = +Number(seam[n]).toFixed(2);
const total = Math.ceil((seam.close + CLOSE) * 2) / 2;
fs.writeFileSync("build/vo-starts.json", JSON.stringify(start));
fs.writeFileSync("build/schedule.json", JSON.stringify({ seam, total, close: CLOSE }));
console.log(JSON.stringify({ start, seam, total }));
