// channel-detect.js — Layer 1: Resolve channel per video navigation
// Key fix: YouTube SPA không reload page → phải re-resolve channel per navigate,
// không cache theo URL vì cùng URL có thể render kênh khác sau SPA nav.
//
// TĂNG CƯỜNG: giờ trả về cả channelId (không chỉ channelName) để
// isVTVChannel() có thể xác thực qua ID — đáng tin cậy hơn tên hiển thị (tên
// có thể bị kênh giả mạo đặt giống hệt, ID thì không đổi/không giả mạo được).

const ChannelDetect = (() => {
    // Per-video cache: videoId → {name, id} (tránh re-resolve cùng video)
    const _cache = new Map();

    async function _waitForOwner() {
        await customElements.whenDefined('ytd-video-owner-renderer').catch(() => {});
    }

    function _fromPlayerResponse(win) {
        try {
            const p = win.ytInitialPlayerResponse ?? win.ytplayer?.config?.args?.raw_player_response;
            const details = p?.videoDetails;
            if (details?.author) return { name: details.author, id: details.channelId || null };
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
                    if (t && t.length > 1) {
                        const href = el.getAttribute('href') || '';
                        const idMatch = href.match(/\/channel\/(UC[\w-]+)/);
                        return { name: t, id: idMatch?.[1] || null };
                    }
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
            if (t && t.length > 1) {
                const href = el.getAttribute('href') || '';
                const idMatch = href.match(/\/channel\/(UC[\w-]+)/);
                return { name: t, id: idMatch?.[1] || null };
            }
        }
        return null;
    }

    /**
     * Resolve channel cho video hiện tại.
     * Must be called after each yt-navigate-finish, not cached across navigations.
     * @param {string} videoId — current video ID (used for per-video dedup only)
     * @returns {Promise<{name:string, id:string|null}>}
     */
    async function resolve(videoId) {
        if (videoId && _cache.has(videoId)) return _cache.get(videoId);

        const win = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

        await _waitForOwner();

        const fast = _fromPlayerResponse(win);
        if (fast) {
            if (videoId) _cache.set(videoId, fast);
            return fast;
        }

        for (let i = 0; i < 50; i++) {
            const pr = _fromPlayerResponse(win);
            if (pr) { if (videoId) _cache.set(videoId, pr); return pr; }

            const dom = _fromDOM();
            if (dom) { if (videoId) _cache.set(videoId, dom); return dom; }

            await new Promise(r => setTimeout(r, 300));
        }
        return { name: '', id: null };
    }

    /** Clear cache on full page reload (called by entry.js on beforeunload) */
    function clearCache() { _cache.clear(); }

    return { resolve, clearCache };
})();
