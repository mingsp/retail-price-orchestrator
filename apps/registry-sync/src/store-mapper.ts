const allowedHosts = new Set(["cactivityapi-sc.waimai.meituan.com"]);
const transientParameters = new Set([
  "code",
  "msg",
  "response_code",
  "request_code",
  "responsecode",
  "requestcode"
]);

export interface NormalizedStoreUrl {
  submittedUrl: string;
  poiIdStr: string;
  canonicalUrl: string;
  identityKey: string;
}

export function normalizeStoreUrl(input: string): NormalizedStoreUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("invalid_store_url");
  }
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("unsupported_store_url");
  }
  const poiIdStr = url.searchParams.get("poi_id_str")?.trim();
  if (!poiIdStr) throw new Error("missing_poi_id_str");

  for (const key of [...url.searchParams.keys()]) {
    if (transientParameters.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();

  return {
    submittedUrl: input,
    poiIdStr,
    canonicalUrl: url.toString(),
    identityKey: `meituan_h5:${poiIdStr}`
  };
}
