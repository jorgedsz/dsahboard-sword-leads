const META_TOKEN = (process.env.META_ACCESS_TOKEN || '').trim();
const API_VERSION = process.env.META_API_VERSION || 'v21.0';
const TTL_MS = (Number(process.env.META_CACHE_MINUTES) || 60) * 60 * 1000;

// adId -> { at, data }. Las URLs de imagen de Meta (fbcdn) caducan, por eso TTL.
const cache = new Map();

function enabled() {
  return Boolean(META_TOKEN);
}

function pickImage(creative = {}) {
  return creative.image_url || creative.thumbnail_url || null;
}

/**
 * Resuelve AD_ID -> imagen del creativo vía Graph API, en lotes de 50 (?ids=)
 * y respetando la caché. Devuelve { [adId]: { adId, name, imageUrl, thumbnailUrl } }
 * o { adId, error } por anuncio que falle.
 */
async function getAdImages(adIds) {
  const unique = [...new Set((adIds || []).map((s) => String(s).trim()).filter(Boolean))];
  const out = {};
  const toFetch = [];

  for (const id of unique) {
    const c = cache.get(id);
    if (c && Date.now() - c.at < TTL_MS) out[id] = c.data;
    else toFetch.push(id);
  }

  for (let i = 0; i < toFetch.length; i += 50) {
    const chunk = toFetch.slice(i, i + 50);
    const url =
      `https://graph.facebook.com/${API_VERSION}/` +
      `?ids=${encodeURIComponent(chunk.join(','))}` +
      `&fields=name,creative{thumbnail_url,image_url}` +
      `&thumbnail_width=320&thumbnail_height=320` +
      `&access_token=${encodeURIComponent(META_TOKEN)}`;

    let json;
    try {
      const resp = await fetch(url);
      json = await resp.json();
      if (!resp.ok) {
        const msg = json?.error?.message || `Graph API ${resp.status}`;
        for (const id of chunk) out[id] = { adId: id, error: msg };
        continue;
      }
    } catch (e) {
      for (const id of chunk) out[id] = { adId: id, error: e.message };
      continue;
    }

    for (const id of chunk) {
      const node = json[id];
      if (!node || node.error) {
        out[id] = { adId: id, error: node?.error?.message || 'anuncio no encontrado' };
        continue;
      }
      const data = {
        adId: id,
        name: node.name || '',
        imageUrl: pickImage(node.creative),
        thumbnailUrl: node.creative?.thumbnail_url || null,
      };
      cache.set(id, { at: Date.now(), data });
      out[id] = data;
    }
  }

  return out;
}

module.exports = { enabled, getAdImages, API_VERSION };
