import { NextRequest } from "next/server";
import { parseAllowedUrl, parseReferer } from "@/lib/hosts";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
];

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function proxyUrl(target: string, referer: string) {
  const params = new URLSearchParams({ url: target, referer });
  return `/api/video?${params.toString()}`;
}

async function fetchUpstream(
  start: URL,
  referer: string,
  range: string | null
) {
  let current = start;

  for (let i = 0; i < 6; i++) {
    const headers = new Headers({
      Referer: referer,
      "User-Agent": USER_AGENT,
      Accept: "*/*",
    });
    if (range) headers.set("Range", range);

    const response = await fetch(current, {
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });

    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      const next = parseAllowedUrl(new URL(location, current).href);
      if (!next) throw new Error("Redirect to a disallowed host");
      current = next;
      continue;
    }

    return { response, current };
  }

  throw new Error("Too many redirects");
}

function rewritePlaylist(body: string, base: URL, referer: string) {
  const rewrite = (value: string) => {
    const absolute = parseAllowedUrl(new URL(value, base).href);
    if (!absolute) throw new Error("Playlist references a disallowed host");
    return proxyUrl(absolute.href, referer);
  };

  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#")) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_, uri: string) => `URI="${rewrite(uri)}"`
        );
      }

      return rewrite(trimmed);
    })
    .join("\n");
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const url = parseAllowedUrl(params.get("url"));
  const referer = parseReferer(params.get("referer"));

  if (!url) return error("Зөвшөөрөгдөөгүй эсвэл буруу URL");
  if (!referer) return error("Referer URL буруу байна");

  try {
    const { response, current } = await fetchUpstream(
      url,
      referer,
      request.headers.get("range")
    );

    if (response.status !== 200 && response.status !== 206) {
      await response.body?.cancel();
      return Response.json(
        {
          error: "Видео сервер хүсэлтийг зөвшөөрсөнгүй",
          upstreamStatus: response.status,
        },
        { status: 502 }
      );
    }

    const type = response.headers.get("content-type") || "";
    const isPlaylist =
      /\.m3u8$/i.test(current.pathname) || /mpegurl/i.test(type);

    if (isPlaylist) {
      const body = rewritePlaylist(await response.text(), current, referer);

      return new Response(body, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (!response.body) return error("Видео өгөгдөл ирсэнгүй", 502);

    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });

    for (const name of PASS_HEADERS) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }

    if (!headers.has("content-type")) headers.set("content-type", "video/mp4");
    if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");

    return new Response(response.body, { status: response.status, headers });
  } catch (err) {
    console.error("Video proxy error:", err);
    return error("Видео сервертэй холбогдож чадсангүй", 502);
  }
}
