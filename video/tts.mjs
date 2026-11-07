import fs from "node:fs";
process.loadEnvFile("../.env");
const key = process.env.FISH_AUDIO_KEY;
const lines = JSON.parse(fs.readFileSync("vo-lines.json", "utf8"));
const only = process.argv[2];
for (const [id, text] of Object.entries(lines)) {
  if (only && only !== id) continue;
  const r = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", model: "s2.1-pro-free" },
    body: JSON.stringify({ text, reference_id: "76e8d2175bc44e29be9885fb67a2b43a", format: "mp3", mp3_bitrate: 192, latency: "normal", normalize: true }),
  });
  if (!r.ok) { console.log(id, "HTTP", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
  fs.writeFileSync(`assets/vo/${id}.mp3`, Buffer.from(await r.arrayBuffer()));
  console.log(id, "ok");
}
