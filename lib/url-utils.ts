const trackingParamPrefixes = ["utm_"];
const trackingParams = new Set([
  "cmpid",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ocid",
  "outputtype",
  "ref",
  "smid",
]);

const regionalHostPrefixes = new Set(["amp", "edition", "m", "mobile", "us", "www"]);

export function normalizeHostname(hostname: string) {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);

  while (parts.length > 2 && regionalHostPrefixes.has(parts[0] ?? "")) {
    parts.shift();
  }

  return parts.join(".");
}

export function canonicalizeUrl(value: string) {
  const parsed = new URL(value);
  parsed.protocol = "https:";
  parsed.hostname = normalizeHostname(parsed.hostname);
  parsed.hash = "";

  for (const key of [...parsed.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();

    if (
      trackingParams.has(normalizedKey) ||
      trackingParamPrefixes.some((prefix) => normalizedKey.startsWith(prefix))
    ) {
      parsed.searchParams.delete(key);
    }
  }

  parsed.searchParams.sort();

  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

export function safeCanonicalizeUrl(value: string) {
  try {
    return canonicalizeUrl(value);
  } catch {
    return value.trim();
  }
}

export function normalizedUrlDomain(value: string) {
  try {
    return normalizeHostname(new URL(value).hostname);
  } catch {
    return "";
  }
}
