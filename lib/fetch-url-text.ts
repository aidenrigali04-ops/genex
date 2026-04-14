const MAX_BYTES = 120_000;

function hostnameBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (h.startsWith("127.")) return true;
  if (h.startsWith("10.")) return true;
  if (h.startsWith("192.168.")) return true;
  if (h.startsWith("172.")) {
    const parts = h.split(".");
    const second = Number(parts[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (h.endsWith(".local")) return true;
  return false;
}

function stripHtmlToText(html: string): string {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ");
  const noTags = noScripts.replace(/<[^>]+>/gu, " ");
  return noTags.replace(/\s+/gu, " ").trim();
}

export async function fetchUrlAsPlainText(urlString: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }

  if (hostnameBlocked(url.hostname)) {
    throw new Error("That URL host is not allowed");
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 18_000);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Genex/1.0; content repurposing)",
        Accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`Could not fetch page (HTTP ${res.status})`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const t2 = await res.text();
      return stripHtmlToText(t2).slice(0, MAX_BYTES);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BYTES) {
          chunks.push(value.slice(0, MAX_BYTES - (total - value.byteLength)));
          break;
        }
        chunks.push(value);
      }
    }

    const decoder = new TextDecoder();
    let raw = "";
    for (const c of chunks) raw += decoder.decode(c, { stream: true });
    raw += decoder.decode();

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/plain")) {
      return raw.trim().slice(0, MAX_BYTES);
    }

    return stripHtmlToText(raw).slice(0, MAX_BYTES);
  } finally {
    clearTimeout(t);
  }
}
