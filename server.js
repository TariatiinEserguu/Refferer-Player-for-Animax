
const express = require("express");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const DEFAULT_HOSTS =
  "cdn2.animax.mn,cdn2.playmax.mn,cdn3.animax.mn,cdn4.animax.mn,cdn5.animax.mn";

const ALLOWED_HOSTS = new Set(
  (process.env.ALLOWED_HOSTS || DEFAULT_HOSTS)
    .split(",")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean)
);

app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  "/vendor",
  express.static(path.join(__dirname, "node_modules/hls.js/dist"))
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

function validateUrl(value) {
  let u;

  try {
    u = new URL(value);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  if (u.username || u.password) {
    throw new Error("URLs containing credentials are not allowed");
  }

  const host = u.hostname.toLowerCase();

  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error("Hostname is not in ALLOWED_HOSTS: " + host);
  }

  return u;
}

function proxyUrl(url, referer) {
  const params = new URLSearchParams({
    url,
    referer
  });

  return "/proxy?" + params.toString();
}

function validReferer(value) {
  if (!value) return "";

  const u = new URL(value);

  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Invalid Referer URL");
  }

  return u.href;
}

async function upstream(url, referer, range) {
  let current = validateUrl(url);

  for (let i = 0; i < 6; i++) {
    const headers = {
      "User-Agent": "Mozilla/5.0",
      "Accept": "*/*"
    };

    if (referer) headers.Referer = referer;
    if (range) headers.Range = range;

    const response = await fetch(current, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000)
    });

    const location = response.headers.get("location");

    if (
      response.status >= 300 &&
      response.status < 400 &&
      location
    ) {
      await response.body?.cancel();
      current = validateUrl(new URL(location, current).href);
      continue;
    }

    return { response, current };
  }

  throw new Error("Too many redirects");
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/play", (req, res) => {
  try {
    const url = validateUrl(req.body?.url);
    const referer = validReferer(req.body?.referer || "");

    res.json({
      ok: true,
      playUrl: proxyUrl(url.href, referer)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/proxy", async (req, res) => {
  try {
    const url = validateUrl(req.query.url);
    const referer = validReferer(req.query.referer || "");

    const { response, current } = await upstream(
      url.href,
      referer,
      req.headers.range
    );

    res.status(response.status);

    for (const name of [
      "content-type",
      "content-range",
      "accept-ranges",
      "last-modified",
      "etag",
      "cache-control"
    ]) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");

    const type = response.headers.get("content-type") || "";
    const playlist =
      /\.m3u8$/i.test(current.pathname) ||
      /mpegurl/i.test(type);

    if (playlist && response.ok) {
      let body = await response.text();

      body = body.split(/\r?\n/).map(line => {
        const trimmed = line.trim();

        if (!trimmed) return line;

        if (trimmed.startsWith("#")) {
          return line.replace(
            /URI="([^"]+)"/g,
            (_, uri) => {
              const absolute = new URL(uri, current).href;
              validateUrl(absolute);
              return `URI="${proxyUrl(absolute, referer)}"`;
            }
          );
        }

        const absolute = new URL(trimmed, current).href;
        validateUrl(absolute);
        return proxyUrl(absolute, referer);
      }).join("\n");

      res.type("application/vnd.apple.mpegurl");
      return res.send(body);
    }

    if (!response.body) return res.end();

    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    if (error.code === "ERR_STREAM_PREMATURE_CLOSE") return;
    console.error("Proxy error:", error.message);

    if (!res.headersSent) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    } else {
      res.destroy();
    }
  }
});

app.use((err, req, res, next) => {
  console.error("Request error:", err.message);

  if (res.headersSent) return next(err);

  res.status(err.status || 500).json({
    ok: false,
    error: err.status === 400
      ? "Invalid request body"
      : "Server error"
  });
});

app.listen(PORT, () => {
  console.log(`Player: http://localhost:${PORT}`);
  console.log("Allowed hosts:", [...ALLOWED_HOSTS].join(", ") || "(none)");
});
