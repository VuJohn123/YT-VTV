// channel-detect.js - Nhận diện kênh VTV

// ── Các strategy lấy channel name, ưu tiên từ trên xuống ──
const _channelStrategies = [
    // 1. Từ ytInitialPlayerResponse (nhanh nhất, không cần DOM)
    () => {
        try {
            const p = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).ytInitialPlayerResponse;
            return p?.videoDetails?.author || null;
        } catch(e) { return null; }
    },
    // 2. Từ ytd-video-owner-renderer
    () => {
        const owner = document.querySelector('ytd-video-owner-renderer');
        if (!owner) return null;
        for (const sel of ['#owner a.yt-simple-endpoint', '#channel-name a', '#text-container a', 'a.yt-simple-endpoint']) {
            const t = _textFrom(owner, sel);
            if (t) return t;
        }
        return _textFromLinks(owner);
    },
    // 3. Từ ytd-channel-name elements
    () => {
        for (const el of document.querySelectorAll('ytd-channel-name')) {
            for (const sel of ['a.yt-simple-endpoint', '#text a', '#text-container a', 'a']) {
                const t = _textFrom(el, sel);
                if (t) return t;
            }
            const t = _textFromLinks(el);
            if (t) return t;
        }
        return null;
    },
    // 4. Fallback: #owner-container và #channel-name
    () => {
        for (const sel of ['#owner-container a.yt-simple-endpoint', '#channel-name a']) {
            const el = document.querySelector(sel);
            const t  = el?.textContent?.trim();
            if (t) return t;
        }
        return null;
    },
    // 5. Fallback tổng quát: tìm link /@channel
    () => {
        for (const a of document.querySelectorAll('a.yt-simple-endpoint')) {
            const t = a.textContent.trim();
            const h = a.getAttribute('href') || '';
            if (t && t.length > 3 && (h.startsWith('/@') || h.startsWith('/channel/'))) return t;
        }
        return null;
    },
];

function _textFrom(el, sel) {
    if (!el) return null;
    const roots = el.shadowRoot ? [el.shadowRoot, el] : [el];
    for (const root of roots) {
        const found = root.querySelector(sel);
        if (found?.textContent?.trim()) return found.textContent.trim();
    }
    return null;
}

function _textFromLinks(el) {
    if (!el) return null;
    const roots = el.shadowRoot ? [el.shadowRoot, el] : [el];
    for (const root of roots) {
        for (const l of root.querySelectorAll('a.yt-simple-endpoint')) {
            const t = l.textContent.trim();
            if (t) return t;
        }
    }
    return null;
}

function getChannelName() {
    for (const strategy of _channelStrategies) {
        const result = strategy();
        if (result) return result;
    }
    return null;
}

async function waitForChannel() {
    await Promise.all([
        customElements.whenDefined('ytd-channel-name'),
        customElements.whenDefined('ytd-video-owner-renderer'),
    ]);
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 40; i++) {
        const n = getChannelName();
        if (n) return n;
        await new Promise(r => setTimeout(r, 400));
    }
    return '';
}
