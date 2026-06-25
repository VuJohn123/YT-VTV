// channel-detect.js — Layer 1: Resolve channel per video navigation
// Key fix: YouTube SPA không reload page → phải re-resolve channel per navigate,
// không cache theo URL vì cùng URL có thể render kênh khác sau SPA nav.

const ChannelDetect = (() => {
    // Per-video cache: videoId → channelName (tránh re-resolve cùng video)
    const _cache = new Map();

    async function _waitForOwner() {
        await customElements.whenDefined('ytd-video-owner-renderer').catch(() => {});
    }

    function _fromPlayerResponse(win) {
        try {
            const p = win.ytInitialPlayerResponse ?? win.ytplayer?.config?.args?.raw_player_response;
            if (p?.videoDetails?.author) return p.videoDetails.author;
        } catch (e) {}
        return null;
    }

    function _fromDOM() {
        // Primary: ytd-video-owner-renderer (most reliable)
        const owner = document.querySelector('ytd-video-owner-renderer');
        if (owner) {
            const roots = [owner, owner.shadowRoot].filter(Boolean);
            for (const root of roots) {
                for (const sel of [
                    '#channel-name a', '#owner-name a', '#text-container a',
                    'a[href^="/@"]', 'a[href^="/channel/"]',
                ]) {
                    const el = root.querySelector(sel);
                    const t  = el?.textContent?.trim();
                    if (t && t.length > 1) return t;
                }
            }
        }
        // Secondary: above-the-fold channel name badge
        for (const sel of [
            'ytd-channel-name yt-formatted-string a',
            '#upload-info a',
            'span#owner-name a',
        ]) {
            const el = document.querySelector(sel);
            const t  = el?.textContent?.trim();
            if (t && t.length > 1) return t;
        }
        return null;
    }

    /**
     * Resolve channel name for the current video.
     * Must be called after each yt-navigate-finish, not cached across navigations.
     * @param {string} videoId — current video ID (used for per-video dedup only)
     * @returns {Promise<string>}
     */
    async function resolve(videoId) {
        // Per-video cache hit (same video re-queried in same page session)
        if (videoId && _cache.has(videoId)) return _cache.get(videoId);

        const win = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

        await _waitForOwner();

        // Try playerResponse first (available immediately after nav)
        const fast = _fromPlayerResponse(win);
        if (fast) {
            if (videoId) _cache.set(videoId, fast);
            return fast;
        }

        // Poll DOM — YouTube renders owner async after SPA nav
        for (let i = 0; i < 50; i++) {
            // Re-check playerResponse each tick (it populates async)
            const pr = _fromPlayerResponse(win);
            if (pr) { if (videoId) _cache.set(videoId, pr); return pr; }

            const dom = _fromDOM();
            if (dom) { if (videoId) _cache.set(videoId, dom); return dom; }

            await new Promise(r => setTimeout(r, 300));
        }
        return '';
    }

    /** Clear cache on full page reload (called by entry.js on beforeunload) */
    function clearCache() { _cache.clear(); }

    return { resolve, clearCache };
})();
