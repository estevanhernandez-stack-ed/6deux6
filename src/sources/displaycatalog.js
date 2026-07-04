const CATALOG = "https://displaycatalog.mp.microsoft.com/v7.0/products";

/** Extract raw 4-part versions from a displaycatalog product's PackageFullNames. */
export function parseVersions(product) {
  const versions = [];
  for (const avail of product?.DisplaySkuAvailabilities ?? []) {
    for (const pkg of avail?.Sku?.Properties?.Packages ?? []) {
      const m = /_(\d+\.\d+\.\d+\.\d+)_/.exec(pkg?.PackageFullName ?? "");
      if (m && !versions.includes(m[1])) versions.push(m[1]);
    }
  }
  return versions;
}

/** Numeric-aware compare of "a.b.c.d" strings, descending. */
function byVersionDesc(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
  return 0;
}

export async function fetchLatestStore(target, { fetchImpl = fetch } = {}) {
  try {
    const url = `${CATALOG}?bigIds=${target.productId}&market=US&languages=en-us`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`[displaycatalog] ${target.id}: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const versions = parseVersions(data?.Products?.[0]).sort(byVersionDesc);
    if (!versions.length) {
      console.error(`[displaycatalog] ${target.id}: no version parsed`);
      return null;
    }
    return {
      version: versions[0],
      url: `https://apps.microsoft.com/detail/${target.productId}`,
      notes: null,
      publishedAt: null,
    };
  } catch (err) {
    console.error(`[displaycatalog] ${target.id}: ${err.message}`);
    return null;
  }
}
