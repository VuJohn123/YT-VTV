// utils.js — Layer 0/1: Constants, pure utilities, parseTitle
// Không có side-effects, không có global mutable state ở đây.

// ─── Constants ────────────────────────────────────────────────────────────────
const DEBUG              = true;
const TARGET_CHANNEL     = 'VTV Giải Trí Official';
const AD_MAX_DURATION    = 30;          // seconds
const SEARCH_CACHE_TTL   = 30 * 60_000; // 30 minutes
const VP_CACHE_TTL       =  6 * 3_600_000; // 6 hours
const INCLUDE_CHANNEL_IN_SEARCH = true;

// ─── Logging (pure, side-effect limited to console) ──────────────────────────
const log  = (...a) => DEBUG && console.log('[VTV]', ...a);
const warn = (...a) => DEBUG && console.warn('[VTV]', ...a);

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

    // Detect format prefix/suffix
    if (/TRỰC TIẾP/i.test(t))        { r.format = 'live';      t = t.replace(/TRỰC TIẾP\s*/i, ''); }
    else if (/Preview/i.test(t))     { r.format = 'preview';   t = t.replace(/Preview\s*/i, ''); }
    else if (/Shorts/i.test(t))      { r.format = 'short';     t = t.replace(/Shorts\s*/i, ''); }
    else if (/Trailer Official/i.test(t)) { r.format = 'trailer'; t = t.replace(/Trailer Official\s*/i, ''); }
    else if (/Highlight|Trích đoạn/i.test(t)) r.format = 'highlight';

    // Pattern 1: "Tên tập N - P2 (1/3)"
    let m = t.match(/^(.*?)\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(?:P(\d+)|Phần\s*(\d+)))?\s*(?:\((\d+)\/(\d+)\))?/i);
    if (m) {
        r.series  = m[1].trim();
        r.episode = parseFloat(m[2]);
        r.season  = m[3] ? parseInt(m[3]) : (m[4] ? parseInt(m[4]) : null);
        if (m[5] && m[6]) { r.segment = parseInt(m[5]); r.totalSeg = parseInt(m[6]); }
    } else {
        // Pattern 2: "Tên P2 tập N (1/3)"
        m = t.match(/^(.*?)\s+(?:P(\d+)|Phần\s*(\d+))\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)\s*(?:\((\d+)\/(\d+)\))?/i);
        if (m) {
            r.series  = m[1].trim();
            r.season  = m[2] ? parseInt(m[2]) : (m[3] ? parseInt(m[3]) : null);
            r.episode = parseFloat(m[4]);
            if (m[5] && m[6]) { r.segment = parseInt(m[5]); r.totalSeg = parseInt(m[6]); }
        } else {
            // Pattern 3: "Tên | tập N"
            m = t.match(/^(.*?)\s*\|\s*(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)/i);
            if (m) { r.series = m[1].trim(); r.episode = parseFloat(m[2]); }
            else {
                // Pattern 4: fallback "tập N"
                m = t.match(/(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)/i);
                if (m) { r.episode = parseFloat(m[1]); r.series = t.replace(m[0], '').trim(); }
            }
        }
    }

    // Normalize series: strip trailing season suffix, noise words
    r.series = r.series
        .replace(/^(.*?)\s*(?:-?\s*(?:P\d+|Phần\s*\d+))\s*$/i, '$1')
        .replace(/(?:FULL|Full|Shorts|Preview|Trailer|Trực tiếp|TRỰC TIẾP)/gi, '')
        .replace(/\|\s*VTV Giải Trí\s*$/i, '')
        .replace(/\s*\|\s*/g, ' - ')
        .trim();

    if (!r.series && r.episode) {
        r.series = t.split('|')[0].trim();
    }

    return r;
}

// ─── Episode type detector (pure) ─────────────────────────────────────────────
/** @param {string} title @returns {string} */
function detectEpisodeType(title) {
    const t = title.toLowerCase();
    if (/trực tiếp|live/i.test(t))              return 'live';
    if (/preview/i.test(t))                     return 'preview';
    if (/shorts/i.test(t))                      return 'short';
    if (/trailer official/i.test(t))            return 'trailer';
    if (/highlight|trích đoạn/i.test(t))        return 'highlight';
    if (/tóm tắt|recap|tổng hợp/i.test(t))     return 'recap';
    if (/ngoại truyện|ngoại truyen/i.test(t))   return 'ngoai_truyen';
    if (/đặc biệt|tập đặc biệt|special/i.test(t)) return 'dac_biet';
    if (/full tập|full hd|tập cuối|cuối cùng/i.test(t)) return 'full';
    return 'unknown';
}

/** @param {string} desc @returns {string[]} */
function detectGenres(desc) {
    const d = desc.toLowerCase();
    const genres = [];
    if (/tình cảm|tình yêu|lãng mạn|romance/i.test(d))    genres.push('tinh_cam');
    if (/hình sự|cảnh sát|phá án|điều tra/i.test(d))       genres.push('hinh_su');
    if (/hài hước|hài|comedy/i.test(d))                    genres.push('hai');
    if (/hành động|action|võ thuật/i.test(d))              genres.push('hanh_dong');
    if (/kinh dị|ma|ghost|horror/i.test(d))                genres.push('kinh_di');
    if (/viễn tưởng|sci-fi|khoa học/i.test(d))             genres.push('vien_tuong');
    if (/phiêu lưu|adventure/i.test(d))                    genres.push('phieu_luu');
    if (/cổ trang|kiếm hiệp|historical/i.test(d))          genres.push('co_trang');
    if (/tâm lý|psychological/i.test(d))                   genres.push('tam_ly');
    if (/đời thường|gia đình|family/i.test(d))             genres.push('doi_thuong');
    return genres;
}

// ─── Missing segment detector (pure) ─────────────────────────────────────────
/**
 * @param {Array<{episode:number, segment:number|null, totalSeg:number|null}>} list
 * @returns {{episodes: number[], segments: Array<{episode,segment,totalSeg}>}}
 */
function detectMissingEpisodes(list) {
    const eps = list
        .filter(e => e.episode && (!e.segment || e.segment === 1))
        .map(e => e.episode);

    if (eps.length < 2) return { episodes: [], segments: [] };
    eps.sort((a, b) => a - b);

    const missingEps = [];
    for (let i = eps[0]; i <= eps[eps.length - 1]; i++) {
        if (!eps.includes(i)) missingEps.push(i);
    }

    // Missing segments
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

// ─── YouTube autoplay suggestion (DOM read, no writes) ───────────────────────
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
