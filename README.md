# Referer Player

Next.js app that plays Playmax / Animax videos through a Referer-aware proxy.

- Paste a Playmax episode link (`https://playmax.mn/#/watch/5587/43666`) to get 480p–2160p options,
  or paste a direct `cdnN.animax.mn` / `cdnN.playmax.mn` `.mp4` / `.m3u8` link.
- Optional custom Referer (defaults to `https://animax.mn/`).
- `/api/video` proxies the media with Range support and rewrites HLS playlists. Only Animax/Playmax hosts are allowed.

```bash
npm install
npm run dev
```
