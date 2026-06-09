// channel-detect.js - Nhận diện kênh VTV
async function waitForElementsDefined() {
    await Promise.all([
        customElements.whenDefined('ytd-channel-name'),
        customElements.whenDefined('ytd-video-owner-renderer')
    ]);
}
function getChannelNameFromPlayerResponse() {
    try {
        const p = typeof unsafeWindow !== 'undefined' ? unsafeWindow.ytInitialPlayerResponse : window.ytInitialPlayerResponse;
        if (p?.videoDetails?.author) return p.videoDetails.author;
    } catch(e) {}
    return null;
}
function getTextFromElement(el, sel) {
    if (!el) return null;
    if (el.shadowRoot) { const f = el.shadowRoot.querySelector(sel); if (f?.textContent.trim()) return f.textContent.trim(); }
    const f = el.querySelector(sel); return f?.textContent.trim() || null;
}
function getTextFromAllLinks(el) {
    if (!el) return null;
    const links = el.shadowRoot ? el.shadowRoot.querySelectorAll('a.yt-simple-endpoint') : el.querySelectorAll('a.yt-simple-endpoint');
    for (const l of links) { const t = l.textContent.trim(); if (t) return t; }
    return null;
}
function getChannelNameFromDOM() {
    const owner = document.querySelector('ytd-video-owner-renderer');
    if (owner) {
        for (const sel of ['#owner a.yt-simple-endpoint', '#channel-name a', '#text-container a', 'a.yt-simple-endpoint']) {
            const t = getTextFromElement(owner, sel); if (t) return t;
        }
        const t = getTextFromAllLinks(owner); if (t) return t;
    }
    const channelEls = document.querySelectorAll('ytd-channel-name');
    for (const c of channelEls) {
        for (const sel of ['a.yt-simple-endpoint', '#text a', '#text-container a', 'a']) {
            const t = getTextFromElement(c, sel); if (t) return t;
        }
        const t = getTextFromAllLinks(c); if (t) return t;
    }
    const oc = document.querySelector('#owner-container'); if (oc) { const a = oc.querySelector('a.yt-simple-endpoint'); if (a?.textContent.trim()) return a.textContent.trim(); }
    const cn = document.querySelector('#channel-name'); if (cn) { const a = cn.querySelector('a'); if (a?.textContent.trim()) return a.textContent.trim(); }
    const all = document.querySelectorAll('a.yt-simple-endpoint');
    for (const a of all) {
        const t = a.textContent.trim();
        if (t && t.length > 3 && !t.includes('subscribe') && !t.includes('Subscribed')) {
            const h = a.getAttribute('href');
            if (h && (h.startsWith('/@') || h.startsWith('/channel/'))) return t;
        }
    }
    return null;
}
function getChannelName() { return getChannelNameFromPlayerResponse() || getChannelNameFromDOM(); }
async function waitForChannel() {
    await waitForElementsDefined();
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 40; i++) { const n = getChannelName(); if (n) return n; await new Promise(r => setTimeout(r, 400)); }
    return '';
}