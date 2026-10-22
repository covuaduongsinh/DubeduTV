// Content script chỉ được nhờ service worker tải phụ đề từ các host mà tiện ích
// đã khai báo (vd. *.udemycdn.com), không dùng được như proxy tải tuỳ ý.

const EXCLUDED_HOSTS = new Set([
  "api.anthropic.com",
  "api.groq.com",
  "api.openai.com",
  "translate.googleapis.com",
]);

function patternToRegExp(pattern) {
  const match = /^(https?|\*):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match) return null;
  const [, scheme, host, path] = match;
  if (EXCLUDED_HOSTS.has(host)) return null;
  const escape = (value) => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const schemePart = scheme === "*" ? "https?" : scheme;
  const hostPart = host.startsWith("*.")
    ? `(?:[^/]+\\.)?${escape(host.slice(2))}`
    : escape(host).replace(/\*/g, "[^/]*");
  const pathPart = escape(path).replace(/\*/g, ".*");
  return new RegExp(`^${schemePart}://${hostPart}(?::\\d+)?${pathPart}$`);
}

export function createFetchGuard(manifest) {
  const patterns = (manifest.host_permissions || [])
    .map(patternToRegExp)
    .filter(Boolean);
  return (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
        return false;
      return patterns.some((pattern) => pattern.test(parsed.href));
    } catch {
      return false;
    }
  };
}
