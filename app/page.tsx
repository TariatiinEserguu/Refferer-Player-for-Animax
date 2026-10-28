"use client";

import { useEffect, useRef, useState } from "react";
import type HlsType from "hls.js";
import { isAllowedHost } from "@/lib/hosts";

type VideoOption = {
  key: string;
  label: string;
  url: string;
};

const DEFAULT_REFERER = "https://animax.mn/";

function cleanUrl(value: string): string {
  return value.trim().replace(/\\\//g, "/");
}

function extractUrl(text: string): string {
  const input = text.trim();
  const markdown = input.match(/\]\((https?:\/\/[^)\s]+)\)/i);
  const raw = markdown
    ? markdown[1]
    : input.match(/https?:\/\/[^\s"'<>]+/i)?.[0];

  return raw ? cleanUrl(raw) : "";
}

function isMedia(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      isAllowedHost(parsed.hostname) &&
      /\.(mp4|m3u8)$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function getPlaymaxEpisodeId(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (!/^(www\.)?playmax\.mn$/i.test(parsed.hostname)) return null;

    return parsed.hash.match(/\/watch\/(\d+)\/(\d+)/)?.[2] ?? null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getVideoOptions(data: any): VideoOption[] {
  const sources = [
    data,
    data?.data,
    data?.episode,
    data?.data?.episode,
  ].filter(Boolean);

  const fields = [
    { key: "vid1", label: "480p" },
    { key: "vid2", label: "720p" },
    { key: "vid3", label: "1080p" },
    { key: "vid4", label: "1440p" },
    { key: "vid5", label: "2160p" },
    { key: "download_link", label: "MP4 татах холбоос" },
  ];

  const options: VideoOption[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const field of fields) {
      const value = source[field.key];
      if (typeof value !== "string" || !value.trim()) continue;

      const url = cleanUrl(value);
      if (!isMedia(url) || seen.has(url)) continue;

      seen.add(url);
      options.push({ key: field.key, label: field.label, url });
    }
  }

  return options;
}

function proxied(url: string, referer: string) {
  const params = new URLSearchParams({ url, referer });
  return `/api/video?${params.toString()}`;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [referer, setReferer] = useState(DEFAULT_REFERER);
  const [options, setOptions] = useState<VideoOption[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsType | null>(null);

  // Restore saved inputs after hydration (localStorage is client-only).
  useEffect(() => {
    try {
      /* eslint-disable react-hooks/set-state-in-effect */
      setInput(localStorage.getItem("rp.input") || "");
      setReferer(localStorage.getItem("rp.referer") || DEFAULT_REFERER);
    } catch {}
  }, []);

  // Attach the selected source to the <video>, using hls.js for playlists.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedUrl) return;

    let cancelled = false;
    const src = proxied(selectedUrl, referer.trim() || DEFAULT_REFERER);
    const isHls = /\.m3u8$/i.test(new URL(selectedUrl).pathname);

    async function attach(el: HTMLVideoElement) {
      if (isHls && !el.canPlayType("application/vnd.apple.mpegurl")) {
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;

        if (!Hls.isSupported()) {
          setStatus("Энэ браузер HLS дэмжихгүй байна.");
          return;
        }

        const hls = new Hls();
        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (_, err) => {
          if (!err.fatal) return;

          if (err.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (err.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setStatus("HLS алдаа: " + err.details);
            hls.destroy();
          }
        });

        hls.loadSource(src);
        hls.attachMedia(el);
      } else {
        el.src = src;
      }
    }

    attach(video);

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [selectedUrl, referer]);

  async function convert() {
    setStatus("");
    setOptions([]);
    setSelectedUrl("");

    try {
      localStorage.setItem("rp.input", input);
      localStorage.setItem("rp.referer", referer);
    } catch {}

    const url = extractUrl(input);

    if (!url) {
      setStatus("Playmax эсвэл Animax холбоос оруулна уу.");
      return;
    }

    if (isMedia(url)) {
      setOptions([{ key: "direct", label: "Шууд холбоос", url }]);
      setSelectedUrl(url);
      return;
    }

    const episodeId = getPlaymaxEpisodeId(url);

    if (!episodeId) {
      setStatus(
        "Холбоос буруу байна. Жишээ: https://playmax.mn/#/watch/5587/43666"
      );
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `/api/playmax?episodeId=${encodeURIComponent(episodeId)}`,
        { cache: "no-store" }
      );
      const data = await response.json().catch(() => null);

      if (!response.ok || !data) {
        throw new Error(
          data?.error || `API алдаа: HTTP ${response.status}`
        );
      }

      const found = getVideoOptions(data);

      if (found.length === 0) {
        throw new Error("Видео холбоос олдсонгүй.");
      }

      setOptions(found);
      setSelectedUrl(found[0].url);
      setStatus(`${found.length} видео сонголт олдлоо.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Тодорхойгүй алдаа гарлаа."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <section className="panel">
        <div className="eyebrow">REFERER PLAYER</div>
        <h1>Referer Player</h1>
        <p className="description">
          Playmax ангийн холбоос, эсвэл Animax .mp4 / .m3u8 холбоос оруулна уу.
        </p>

        <label htmlFor="video-link">Видео холбоос</label>
        <textarea
          id="video-link"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://playmax.mn/#/watch/5587/43666"
          rows={3}
        />

        <label htmlFor="referer">Referer (заавал биш)</label>
        <input
          id="referer"
          type="url"
          value={referer}
          onChange={(e) => setReferer(e.target.value)}
          placeholder={DEFAULT_REFERER}
        />

        <div className="buttons">
          <button className="primary" onClick={convert} disabled={loading}>
            {loading ? "Хайж байна..." : "Тоглуулах"}
          </button>
        </div>

        {status && (
          <p className="hint" role="status">
            {status}
          </p>
        )}

        {options.length > 0 && (
          <div>
            {options.length > 1 && (
              <>
                <label htmlFor="quality">Видео чанар</label>
                <select
                  id="quality"
                  value={selectedUrl}
                  onChange={(e) => setSelectedUrl(e.target.value)}
                >
                  {options.map((option) => (
                    <option key={option.url} value={option.url}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              onError={() =>
                setStatus(
                  "Видео тоглуулахад алдаа гарлаа. URL болон Referer-ээ шалгана уу."
                )
              }
            />

            <div className="buttons">
              <button
                className="secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(selectedUrl)
                    .then(() => setStatus("Холбоос хууллаа."))
                    .catch(() => setStatus("Хуулах боломжгүй байна."))
                }
              >
                Видео холбоос хуулах
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
