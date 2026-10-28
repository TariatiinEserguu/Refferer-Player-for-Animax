const HOST_PATTERN = /^(cdn\d+\.(animax|playmax)\.mn|(www\.)?playmax\.mn)$/i;

export function isAllowedHost(hostname: string): boolean {
  return HOST_PATTERN.test(hostname);
}

export function parseAllowedUrl(value: string | null): URL | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (!isAllowedHost(url.hostname)) return null;

    return url;
  } catch {
    return null;
  }
}

export function parseReferer(value: string | null): string | null {
  if (!value) return "https://animax.mn/";

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
