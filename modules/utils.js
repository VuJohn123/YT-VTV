// utils.js — Layer 0/1: Constants, pure utilities, parseTitle
// Không có side-effects, không có global mutable state ở đây.

// ─── VTV Channel family (similarity-based, không cần exact match) ─────────────
// Thêm kênh mới: chỉ cần thêm vào list, hệ thống tự so sánh.
const VTV_CHANNEL_PATTERNS = [
    /^VTV\b/i,                          // VTV Giải Trí, VTV Hài, VTV Go, VTV2...
    /vtv\s*giải\s*trí/i,
    /vtv\s*hài/i,
    /vtv\s*go/i,
    /vtv\s*cab/i,
    /vtv\s*digital/i,
    /vtv\s*news/i,
    /vtv\s*tuyển\s*chọn/i,
    /vtv\s*phim/i,
    /vtv\s*[0-9]/i,
];

// Canonical channel cho search queries — luôn dùng cái này khi build query
const SEARCH_CHANNEL_HINT = 'VTV Giải Trí';

const DEBUG              = true;
const AD_MAX_DURATION    = 30;          // seconds
const SEARCH_CACHE_TTL   = 30 * 60_000; // 30 min
const VP_CACHE_TTL       =  6 * 3_600_000; // 6 hours
const INCLUDE_CHANNEL_IN_SEARCH = true;

// ─── Logging ──────────────────────────────────────────────────────────────────
const log  = (...a) => DEBUG && console.log('[VTV]', ...a);
const warn = (...a) => DEBUG && console.warn('[VTV]', ...a);

// ─── Channel matcher ─────────────────────────────────────────────────────────
/**
 * @param {string} channelName
 * @returns {boolean}
 */
function isVTVChannel(channelName) {
    if (!channelName) return false;
    return VTV_CHANNEL_PATTERNS.some(p => p.test(channelName));
}

// ─── DOM utils ───────────────────────────────────────────────────────────────
function escapeHTML(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ─── Title parser ─────────────────────────────────────────────────────────────
/**
 * @typedef {Object} ParsedInfo
 * @property {string}      series
 * @property {number|null} season
 * @property {number|null} episode
 * @property {number|null} segment
 * @property {number|null} totalSeg
 * @property {string}      format  — 'full'|'live'|'preview'|'short'|'trailer'|'highlight'
 */

/** @param {string} rawTitle @returns {ParsedInfo} */
function parseTitle(rawTitle) {
    let t = rawTitle.replace(/\s*-\s*YouTube$/i, '').trim();
    const r = { series: '', season: null, episode: null, segment: null, totalSeg: null, format: 'full' };

    if (/TRỰC TIẾP/i.test(t))              { r.format = 'live';      t = t.replace(/TRỰC TIẾP\s*/i, ''); }
    else if (/Preview/i.test(t))           { r.format = 'preview';   t = t.replace(/Preview\s*/i, ''); }
    else if (/Shorts/i.test(t))            { r.format = 'short';     t = t.replace(/Shorts\s*/i, ''); }
    else if (/Trailer Official/i.test(t))  { r.format = 'trailer';   t = t.replace(/Trailer Official\s*/i, ''); }
    else if (/Highlight|Trích đoạn/i.test(t)) r.format = 'highlight';

    // P1: "Tên tập N - P2 (1/3)"
    let m = t.match(/^(.*?)\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(?:P(\d+)|Phần\s*(\d+)))?\s*(?:\((\d+)\/(\d+)\))?/i);
    if (m) {
        r.series  = m[1].trim();
        r.episode = parseFloat(m[2]);
        r.season  = m[3] ? parseInt(m[3]) : (m[4] ? parseInt(m[4]) : null);
        if (m[5] && m[6]) { r.segment = parseInt(m[5]); r.totalSeg = parseInt(m[6]); }
    } else {
        // P2: "Tên P2 tập N"
        m = t.match(/^(.*?)\s+(?:P(\d+)|Phần\s*(\d+))\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)\s*(?:\((\d+)\/(\d+)\))?/i);
        if (m) {
            r.series  = m[1].trim();
            r.season  = m[2] ? parseInt(m[2]) : (m[3] ? parseInt(m[3]) : null);
            r.episode = parseFloat(m[4]);
            if (m[5] && m[6]) { r.segment = parseInt(m[5]); r.totalSeg = parseInt(m[6]); }
        } else {
            // P3: "Tên | tập N"
            m = t.match(/^(.*?)\s*\|\s*(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)/i);
            if (m) { r.series = m[1].trim(); r.episode = parseFloat(m[2]); }
            else {
                // P4: fallback "tập N"
                m = t.match(/(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)/i);
                if (m) { r.episode = parseFloat(m[1]); r.series = t.replace(m[0], '').trim(); }
            }
        }
    }

    r.series = r.series
        .replace(/^(.*?)\s*(?:-?\s*(?:P\d+|Phần\s*\d+))\s*$/i, '$1')
        .replace(/(?:FULL|Full|Shorts|Preview|Trailer|Trực tiếp|TRỰC TIẾP)/gi, '')
        .replace(/\|\s*VTV[^|]*/i, '')
        .replace(/\s*\|\s*/g, ' - ')
        .trim();

    if (!r.series && r.episode) r.series = t.split('|')[0].trim();
    return r;
}

/** @param {Array} list @returns {{episodes: number[], segments: Array}} */
function detectMissingEpisodes(list) {
    const eps = list
        .filter(e => e.episode && (!e.segment || e.segment === 1))
        .map(e => e.episode)
        .sort((a, b) => a - b);

    if (eps.length < 2) return { episodes: [], segments: [] };

    const missingEps = [];
    for (let i = eps[0]; i <= eps[eps.length - 1]; i++) {
        if (!eps.includes(i)) missingEps.push(i);
    }

    const byEp = {};
    for (const item of list) {
        if (!item.episode || !item.totalSeg || item.totalSeg <= 1) continue;
        if (!byEp[item.episode]) byEp[item.episode] = { total: item.totalSeg, present: new Set() };
        if (item.segment) byEp[item.episode].present.add(item.segment);
    }
    const missingSegs = [];
    for (const [ep, data] of Object.entries(byEp)) {
        for (let seg = 1; seg <= data.total; seg++) {
            if (!data.present.has(seg)) missingSegs.push({ episode: parseInt(ep), segment: seg, totalSeg: data.total });
        }
    }
    return { episodes: missingEps, segments: missingSegs };
}

/** @returns {{url:string, title:string}|null} */
function getYouTubeAutoplay() {
    const el = document.querySelector('ytd-compact-autoplay-renderer a.yt-simple-endpoint');
    if (el) return {
        url:   'https://www.youtube.com' + el.getAttribute('href'),
        title: el.querySelector('#video-title')?.textContent?.trim() || ''
    };
    const un = document.querySelector('ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer:first-child a.yt-simple-endpoint');
    if (un) return {
        url:   'https://www.youtube.com' + un.getAttribute('href'),
        title: un.querySelector('#video-title')?.textContent?.trim() || ''
    };
    return null;
}
