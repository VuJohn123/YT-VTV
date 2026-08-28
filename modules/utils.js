// utils.js — Layer 0/1: Constants, pure utilities, parseTitle
// Không có side-effects, không có global mutable state ở đây.

// ─── VTV Channel family (similarity-based, không cần exact match) ─────────────
// Thêm kênh mới: chỉ cần thêm vào list, hệ thống tự so sánh.
//
// QUAN TRỌNG: danh sách này KHÔNG đầy đủ 100% (không có API chính thức để
// enumerate "mọi kênh thuộc VTV" — VTV không công khai danh sách kênh con
// chính thức). Đây là danh sách best-effort dựa trên các kênh phổ biến nhất
// đã xác nhận qua tìm kiếm công khai. Nếu 1 kênh VTV hợp lệ nào đó không có
// trong list, script sẽ coi nó là "sai kênh" — false negative, không phải
// false positive, nên an toàn hơn là thêm nhầm kênh giả mạo.
const VTV_CHANNEL_PATTERNS = [
    /^VTV\b/i,                          // VTV Giải Trí, VTV Hài, VTV Go, VTV1, VTV2...
    /vtv\s*giải\s*trí/i,
    /vtv\s*hài/i,
    /vtv\s*go\b/i,
    /vtv\s*cab/i,
    /vtv\s*digital/i,
    /vtv\s*news/i,
    /vtv\s*tuyển\s*chọn/i,
    /vtv\s*phim/i,
    /vtv\s*shows?\b/i,
    /vtv\s*[0-9]/i,
    /ấn\s*tượng\s*vtv/i,
    // Các kênh sản xuất/phân phối nội dung chính thức của VTV — KHÔNG có chữ
    // "VTV" trong tên nhưng vẫn thuộc VTV-family (xác nhận qua mô tả kênh
    // công khai trên YouTube). Quan trọng nhất: VFC Official — trung tâm sản
    // xuất phim truyền hình, phần lớn phim VTV Giải Trí thực ra upload gốc
    // từ kênh này trước khi được re-upload sang VTV Giải Trí Official. Đây
    // là bug thật xác nhận qua log của user: kênh "VFC Official" không match
    // bất kỳ pattern nào trước khi mở rộng list này.
    /^vfc\s*official/i,
    /^phim\s*truyền\s*hình\s*việt\s*nam$/i,
];

// Channel ID whitelist — mạnh hơn regex tên (tên hiển thị CÓ THỂ đổi hoặc bị
// giả mạo bởi kênh khác đặt tên giống hệt, nhưng channel ID là duy nhất và
// không đổi được). Dùng làm lớp xác thực BỔ SUNG khi có sẵn channel ID trong
// dữ liệu (ví dụ từ ytInitialPlayerResponse.videoDetails.channelId) — không
// thay thế hoàn toàn regex vì không phải lúc nào cũng lấy được ID kịp thời.
//
// Cấu trúc {id, name} thay vì Set trần các ID — để similarity-farm.js
// (Farm Mode) dùng LÀM LUÔN danh sách kênh mặc định sẵn có (seed list),
// không cần user tự gõ tay từng kênh mới bắt đầu farm được, và không tạo ra
// 1 danh sách tên kênh THỨ HAI trùng lặp dễ lệch dữ liệu với danh sách này
// theo thời gian (sửa 1 chỗ, cả isVTVChannel() lẫn Farm Mode đều tự cập nhật).
// VTV_CHANNEL_IDS (Set thuần ID) bên dưới CHỈ để giữ nguyên chữ ký cũ cho
// isVTVChannel() — không phải nguồn dữ liệu chính, luôn derive từ đây.
//
// Đã research xác nhận 2 ID QUAN TRỌNG NHẤT nhưng trước đây THIẾU hẳn khỏi
// whitelist ID (trước giờ chỉ được nhận diện qua regex tên — yếu hơn, vì
// tên hiển thị đổi được): "VTV Giải Trí Official" (kênh chính, xuất hiện
// xuyên suốt toàn bộ script) và "VFC Official" (trung tâm sản xuất, nơi
// phim VTV Giải Trí thường re-upload gốc từ đó — xem comment ở
// VTV_CHANNEL_PATTERNS phía trên).
const VTV_KNOWN_CHANNELS = [
    { id: 'UCuJ5k3GndbHnXLYyiIR6Z8Q', name: 'VTV Giải Trí Official' },
    { id: 'UCTAx9EFsYklqNCs5pBjbn2w', name: 'VFC Official' },
    { id: 'UCRLKY3loGMTmFLGO0BWQVeg', name: 'VTV1' },
    { id: 'UCfxbE4_BAlry2GFoNLDXPRA', name: 'VTV Go' },
    { id: 'UClpDH7RTC9kEK96DEQDUnfQ', name: 'Phim Truyền Hình Việt Nam' },
    { id: 'UCevx3UR91JjIpjD6eYW_2MA', name: 'Ấn tượng VTV' },
];
const VTV_CHANNEL_IDS = new Set(VTV_KNOWN_CHANNELS.map(c => c.id));

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
 * @param {string} [channelId] - nếu có, kiểm tra thêm qua whitelist ID (đáng
 *   tin cậy hơn tên hiển thị vì ID không đổi/không giả mạo được, nhưng không
 *   phải lúc nào cũng có sẵn kịp thời nên vẫn cần regex tên làm chính).
 * @returns {boolean}
 */
function isVTVChannel(channelName, channelId) {
    if (channelId && VTV_CHANNEL_IDS.has(channelId)) return true;
    if (!channelName) return false;
    return VTV_CHANNEL_PATTERNS.some(p => p.test(channelName));
}

// ─── Audio-story content detection ─────────────────────────────────────────
// Dùng cho AudioMode: nếu video là dạng "audio truyện" (chỉ có giọng đọc,
// hình ảnh tĩnh/không quan trọng), tăng tốc độ phát lên 1.5x an toàn — nghe
// truyện nhanh hơn dễ theo dõi hơn nhiều so với tua nhanh hội thoại phim/nhạc.
// CHỦ Ý CHỈ dựa vào tiêu đề, không dùng thêm description hay duration — 2 cái
// đó cần thêm 1 lượt fetch/khác biệt lớn giữa nhiều loại nội dung, trong khi
// heuristic tiêu đề đơn giản đã đủ tin cậy cho use-case cụ thể này (nếu sai,
// hậu quả chỉ là tốc độ không đổi — không có gì bị phá vỡ, an toàn để heuristic
// lỏng hơn so với channel-filtering ở trên, nơi sai sót có thể auto-navigate
// user sang kênh lạ).
const AUDIO_STORY_PATTERNS = [
    /audio\s*(truyện|full)/i,
    /(đọc|nghe|kể)\s*truyện/i,
    /truyện\s*(audio|ma|tâm\s*linh|ngôn\s*tình|teen|đêm\s*khuya)/i,
    /tiểu\s*thuyết/i,
    /diễn\s*đọc/i,
    /truyện\s*full/i,
    /\btruyện\b.*\b(chương|tập)\s*\d+/i, // "truyện ... chương 12" — định dạng phổ biến của kênh đọc truyện nhiều chương
];
function isAudioStoryContent(title) {
    if (!title) return false;
    return AUDIO_STORY_PATTERNS.some(p => p.test(title));
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

    // P0: style cũ "Tên tập N (phần P) | mô tả" — ngoặc chứa "phần P"/"PP" thay vì (segment/totalSeg)
    // Phải thử TRƯỚC P1 vì P1 sẽ match "tập N" trước rồi dừng, bỏ lỡ "(phần 2)" phía sau.
    let m = t.match(/^([^|]*?)\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)\s*\(\s*(?:phần|Phần|PHẦN|p|P)\s*(\d+)\s*\)/i);
    if (m) {
        r.series  = m[1].trim();
        r.episode = parseFloat(m[2]);
        r.season  = parseInt(m[3]);
    } else {
    // P2 thử TRƯỚC P1: "Tên P2 tập N" (season NGAY TRƯỚC "tập").
    // Bắt buộc thử trước P1 vì P1 dùng .*? lazy nên khi gặp "... p2 tập 8" nó sẽ
    // nuốt luôn "p2" vào phần series thay vì nhận diện đúng làm season.
    m = t.match(/^([^|]*?)\s+(?:P(\d+)|Phần\s*(\d+))\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)\s*(?:\((\d+)\/(\d+)\))?/i);
    if (m) {
        r.series  = m[1].trim();
        r.season  = m[2] ? parseInt(m[2]) : (m[3] ? parseInt(m[3]) : null);
        r.episode = parseFloat(m[4]);
        if (m[5] && m[6]) { r.segment = parseInt(m[5]); r.totalSeg = parseInt(m[6]); }
    } else {
    // P1: "Tên tập N - P2 (1/3)"
    // [^|]*? thay vì .*?: KHÔNG cho phép '|' lọt vào phần series, để title dạng
    // "Tên | tập N" rơi đúng xuống nhánh P3 thay vì bị P1 nuốt nhầm cả dấu '|'.
    m = t.match(/^([^|]*?)\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(?:P(\d+)|Phần\s*(\d+)))?\s*(?:\((\d+)\/(\d+)\))?/i);
    if (m) {
        r.series  = m[1].trim();
        r.episode = parseFloat(m[2]);
        r.season  = m[3] ? parseInt(m[3]) : (m[4] ? parseInt(m[4]) : null);
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
    }

    r.series = r.series
        .replace(/^(.*?)\s*(?:-?\s*(?:P\d+|Phần\s*\d+))\s*$/i, '$1')
        .replace(/(?:FULL|Full|Shorts|Preview|Trailer|Trực tiếp|TRỰC TIẾP)/gi, '')
        .replace(/\|\s*VTV[^|]*/i, '')
        .replace(/\s*\|\s*/g, ' - ')
        .replace(/[\s\-–|]+$/, '')  // dọn dấu gạch/pipe mồ côi còn sót ở cuối (phần sau nó đã bị pattern P0-P2 nuốt riêng)
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

/**
 * Convert YouTube's relative published time text ("3 years ago", "2 năm trước",
 * "5 tháng trước", "1 ngày trước"...) thành timestamp ước lượng (ms).
 * Dùng để SẮP XẾP tương đối giữa nhiều video cùng episode, không phải mốc chính xác.
 * @param {string} text
 * @returns {number|null} timestamp ước lượng, hoặc null nếu không parse được
 */
function parsePublishedAge(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();

    // Đơn vị: giây/phút/giờ/ngày/tuần/tháng/năm — cả tiếng Việt lẫn tiếng Anh
    const UNIT_MS = {
        'giây': 1000,                  'second': 1000,
        'phút': 60_000,                'minute': 60_000,
        'giờ':  3_600_000,             'hour':   3_600_000,
        'ngày': 86_400_000,            'day':    86_400_000,
        'tuần': 7 * 86_400_000,        'week':   7 * 86_400_000,
        'tháng': 30 * 86_400_000,      'month':  30 * 86_400_000,
        'năm':  365 * 86_400_000,      'year':   365 * 86_400_000,
    };

    const m = t.match(/(\d+)\s*(giây|phút|giờ|ngày|tuần|tháng|năm|second|minute|hour|day|week|month|year)/);
    if (!m) return null;

    const n    = parseInt(m[1]);
    const unit = m[2];
    return Date.now() - n * UNIT_MS[unit];
}

/**
 * So sánh hai video (cùng episode) để xác định cái nào ĐÁNG ƯU TIÊN hơn khi
 * cần chọn 1 trong nhiều bản trùng. Thứ tự ưu tiên:
 *   1. Duration classification: 'full' > 'unknown' > 'segment' — 1 tập ĐẦY ĐỦ
 *      (50p-1h30) luôn đáng tin hơn 1 đoạn ngắn 3-6 phút (khả năng cao là
 *      trailer/preview/1 phần bị chia nhỏ), bất kể ngày đăng cái nào mới hơn.
 *   2. publishedText (nếu có ở cả 2, cùng hạng duration) — mới hơn thắng.
 *   3. _seq (thứ tự trong playlist, lớn hơn = mới hơn theo giả định phổ biến
 *      playlist append theo thời gian).
 * @returns {number} dương nếu a đáng ưu tiên hơn b, âm nếu ngược lại, 0 nếu hoà
 */
function compareVideoRecency(a, b) {
    const da = classifyDuration(parseDurationText(a.lengthText));
    const db = classifyDuration(parseDurationText(b.lengthText));
    const RANK = { full: 2, unknown: 1, segment: 0 };
    if (RANK[da] !== RANK[db]) return RANK[da] - RANK[db];

    const ta = parsePublishedAge(a.publishedText);
    const tb = parsePublishedAge(b.publishedText);
    if (ta !== null && tb !== null) return ta - tb; // timestamp lớn hơn = mới hơn

    if (typeof a._seq === 'number' && typeof b._seq === 'number') return a._seq - b._seq;

    return 0;
}


/**
 * Parse YouTube's lengthText ("5:23", "52:30", "1:23:45") thành tổng số giây.
 * @param {string} text
 * @returns {number|null} số giây, hoặc null nếu không parse được
 */
function parseDurationText(text) {
    if (!text) return null;
    const parts = text.trim().split(':').map(n => parseInt(n, 10));
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return null;
}

// Ngưỡng phân loại thời lượng — dựa trên format phim truyền hình Việt Nam
// phổ biến: tập full thường 50 phút - 1h30, còn các video ngắn (trailer,
// preview, hoặc segment 1/4 2/4...) thường chỉ 3-5 phút.
const DURATION_FULL_MIN_S    = 50 * 60;   // 50 phút
const DURATION_FULL_MAX_S    = 90 * 60;   // 1h30
const DURATION_SEGMENT_MAX_S = 6 * 60;    // 6 phút (nới nhẹ so với 5p để dung sai)

/**
 * Phân loại 1 video theo thời lượng: 'full' (tập đầy đủ, ưu tiên cao nhất),
 * 'segment' (đoạn ngắn — có thể là 1 phần của tập bị chia nhỏ 1/4, 2/4...),
 * hoặc 'unknown' (không xác định — không loại trừ, chỉ không có tín hiệu rõ).
 * @param {number|null} seconds
 * @returns {'full'|'segment'|'unknown'}
 */
function classifyDuration(seconds) {
    if (seconds === null) return 'unknown';
    if (seconds >= DURATION_FULL_MIN_S && seconds <= DURATION_FULL_MAX_S) return 'full';
    if (seconds > 0 && seconds <= DURATION_SEGMENT_MAX_S) return 'segment';
    return 'unknown';
}


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
