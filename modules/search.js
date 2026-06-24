// search.js — Layer 1: YouTube search with in-memory LRU-TTL cache
// Pure function: không đọc/ghi global state ngoài cache của chính nó.

const Search = (() => {
    /** @type {Map<string, {data: Array, timestamp: number}>} */
    const _cache = new Map();

    function _cacheKey(q) { return q.toLowerCase().trim(); }

    /**
     * Search YouTube. Results cached for SEARCH_CACHE_TTL ms.
     * @param {string} query
     * @returns {Promise<Array<{title:string, videoId:string}>>}
     */
    async function search(query) {
        const key = _cacheKey(query);
        const hit = _cache.get(key);
        if (hit && Date.now() - hit.timestamp < SEARCH_CACHE_TTL) {
            log('[Search] cache hit:', query);
            return hit.data;
        }

        log('[Search] fetch:', query);
        try {
            const res  = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
            const html = await res.text();
            const m    = html.match(/var ytInitialData\s*=\s*({.*?});/s);
            if (!m) return [];

            const json = JSON.parse(m[1]);
            const vids = [];
            const sections = json?.contents?.twoColumnSearchResultsRenderer
                ?.primaryContents?.sectionListRenderer?.contents ?? [];

            for (const sec of sections) {
                for (const item of sec?.itemSectionRenderer?.contents ?? []) {
                    const vr = item.videoRenderer;
                    if (vr) {
                        const title   = vr.title?.runs?.[0]?.text || '';
                        const videoId = vr.videoId;
                        if (title && videoId) vids.push({ title, videoId });
                    }
                }
            }

            _cache.set(key, { data: vids, timestamp: Date.now() });
            return vids;
        } catch (err) {
            warn('[Search] error:', err);
            return [];
        }
    }

    /**
     * Build a query string optionally appending channel name.
     * @param {string} base
     * @param {string} [channel]
     */
    function mkQuery(base, channel) {
        return INCLUDE_CHANNEL_IN_SEARCH && channel ? `${base} ${channel}` : base;
    }

    /** Invalidate the entire cache (e.g. after a long session). */
    function clearCache() { _cache.clear(); }

    return { search, mkQuery, clearCache };
})();
