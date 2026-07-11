// search.js — Layer 1: YouTube search with in-memory LRU-TTL cache
// Pure function: không đọc/ghi global state ngoài cache của chính nó.

const Search = (() => {
    /** @type {Map<string, {data: Array, timestamp: number}>} */
    const _cache = new Map();
    /** @type {Map<string, Promise>} query đang fetch dở, để coalesce request trùng */
    const _inFlight = new Map();

    function _cacheKey(q) { return q.toLowerCase().trim(); }

    /**
     * Search YouTube. Results cached for SEARCH_CACHE_TTL ms.
     * Nếu có request khác đang fetch CÙNG query, gộp lại thành 1 network call
     * (request coalescing) — tránh trường hợp Path B của episode-navigator gọi
     * Promise.all với nhiều query có thể trùng nhau, hoặc 2 tab/2 lần gọi gần
     * nhau trước khi cache kịp ghi.
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

        const existing = _inFlight.get(key);
        if (existing) { log('[Search] coalesce vào request đang chạy:', query); return existing; }

        const promise = _doFetch(query, key);
        _inFlight.set(key, promise);
        try {
            return await promise;
        } finally {
            _inFlight.delete(key);
        }
    }

    async function _doFetch(query, key) {
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
                        const publishedText = vr.publishedTimeText?.simpleText || '';
                        const lengthText = vr.lengthText?.simpleText || '';
                        if (title && videoId) vids.push({ title, videoId, publishedText, lengthText });
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
