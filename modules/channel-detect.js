// channel-detect.js — Layer 1: Resolve YouTube channel name from DOM / ytInitialPlayerResponse
// Pure async logic, không ghi bất kỳ global state nào.

const ChannelDetect = (() => {
    async function _waitForDefined() {
        await Promise.all([
            customElements.whenDefined('ytd-channel-name'),
            customElements.whenDefined('ytd-video-owner-renderer'),
        ]);
    }

    function _fromPlayerResponse() {
        try {
            const p = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).ytInitialPlayerResponse;
            if (p?.videoDetails?.author) return p.videoDetails.author;
        } catch (e) {}
        return null;
    }

    function _textFromEl(el, sel) {
        if (!el) return null;
        if (el.shadowRoot) {
            const f = el.shadowRoot.querySelector(sel);
            if (f?.textContent.trim()) return f.textContent.trim();
        }
        return el.querySelector(sel)?.textContent.trim() || null;
    }

    function _textFromLinks(el) {
        if (!el) return null;
        const root = el.shadowRoot ?? el;
        for (const l of root.querySelectorAll('a.yt-simple-endpoint')) {
            const t = l.textContent.trim();
            if (t) return t;
        }
        return null;
    }

    function _fromDOM() {
        // ytd-video-owner-renderer
        const owner = document.querySelector('ytd-video-owner-renderer');
        if (owner) {
            for (const sel of ['#owner a.yt-simple-endpoint', '#channel-name a', '#text-container a', 'a.yt-simple-endpoint']) {
                const t = _textFromEl(owner, sel);
                if (t) return t;
            }
            const t = _textFromLinks(owner);
            if (t) return t;
        }
        // ytd-channel-name elements
        for (const c of document.querySelectorAll('ytd-channel-name')) {
            for (const sel of ['a.yt-simple-endpoint', '#text a', '#text-container a', 'a']) {
                const t = _textFromEl(c, sel);
                if (t) return t;
            }
            const t = _textFromLinks(c);
            if (t) return t;
        }
        // Fallback: any channel-href anchor
        for (const a of document.querySelectorAll('a.yt-simple-endpoint')) {
            const text = a.textContent.trim();
            const href = a.getAttribute('href') || '';
            if (text && text.length > 3 && (href.startsWith('/@') || href.startsWith('/channel/'))) return text;
        }
        return null;
    }

    /**
     * Wait up to ~16 seconds for the channel name to appear.
     * @returns {Promise<string>} — empty string if not found
     */
    async function resolve() {
        await _waitForDefined();
        await new Promise(r => setTimeout(r, 500));
        for (let i = 0; i < 40; i++) {
            const name = _fromPlayerResponse() || _fromDOM();
            if (name) return name;
            await new Promise(r => setTimeout(r, 400));
        }
        return '';
    }

    return { resolve };
})();
