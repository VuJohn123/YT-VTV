// sponsor-block.js — Layer 2: Tích hợp SponsorBlock API
//
// SponsorBlock (sponsor.ajay.app) là database cộng đồng công khai đánh dấu
// timestamp các đoạn sponsor/intro/outro/self-promo trong video YouTube.
// LƯU Ý QUAN TRỌNG: VTV Giải Trí là nội dung tiếng Việt ít phổ biến trên
// SponsorBlock (cộng đồng chủ yếu đánh dấu video tiếng Anh/công nghệ/gaming),
// nên tính năng này là BEST-EFFORT — phần lớn video sẽ KHÔNG có segment nào,
// đây là hành vi bình thường chứ không phải lỗi.
//
// PRIVACY: dùng k-anonymity — chỉ gửi 4 ký tự đầu của SHA256(videoID) lên
// server, không gửi videoID trực tiếp. Server trả về TẤT CẢ video có cùng
// prefix hash (thường vài chục video), client tự lọc ra đúng video của mình.
// Đây là thiết kế gốc của SponsorBlock, không phải tự chế.

const SponsorBlock = (() => {
    const API_BASE = 'https://sponsor.ajay.app/api/skipSegments';
    const CACHE_TTL = 30 * 60_000; // 30 phút — segment cộng đồng ít khi đổi nhanh
    const _cache = new Map(); // videoId → { segments, timestamp }

    // Categories mặc định: bỏ qua 'poi_highlight' (highlight KHÔNG nên tự skip,
    // đó là điểm hay của video) và 'filler' (tuỳ chọn, một số người thích xem).
    const DEFAULT_CATEGORIES = ['sponsor', 'selfpromo', 'intro', 'outro', 'preview', 'interaction'];

    async function _sha256Hex(text) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Lấy danh sách segment cho 1 video, dùng cache 30 phút.
     * @returns {Promise<Array<{category:string, start:number, end:number}>>} rỗng nếu không có/lỗi
     */
    async function getSegments(videoId, categories = DEFAULT_CATEGORIES) {
        if (!videoId) return [];
        const cached = _cache.get(videoId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.segments;

        try {
            const hash = await _sha256Hex(videoId);
            const prefix = hash.slice(0, 4);
            const url = `${API_BASE}/${prefix}?categories=${encodeURIComponent(JSON.stringify(categories))}`;
            const res = await fetch(url);

            // 404 nghĩa là KHÔNG có video nào trùng prefix có segment — hoàn
            // toàn bình thường (phần lớn video VTV sẽ rơi vào trường hợp này),
            // không phải lỗi, không log warning.
            if (res.status === 404) { _cache.set(videoId, { segments: [], timestamp: Date.now() }); return []; }
            if (!res.ok) { warn('[SponsorBlock] HTTP', res.status); return []; }

            const data = await res.json();
            // Server trả về nhiều video cùng prefix hash — lọc đúng video của mình
            const match = data.find(v => v.videoID === videoId);
            const segments = (match?.segments || []).map(s => ({
                category: s.category,
                start: s.segment[0],
                end: s.segment[1],
            }));

            _cache.set(videoId, { segments, timestamp: Date.now() });
            if (segments.length) log(`[SponsorBlock] ${segments.length} segment(s) tìm thấy cho`, videoId);
            return segments;
        } catch (e) {
            warn('[SponsorBlock] Lỗi khi lấy segments:', e);
            return []; // Lỗi mạng/CORS — im lặng, không ảnh hưởng tính năng khác
        }
    }

    // ─── Auto-skip runtime ──────────────────────────────────────────────────
    let _segments = [];
    let _enabled = false;
    let _skippedUUIDs = new Set(); // tránh skip lặp lại cùng 1 segment trong 1 lần xem

    function _onTimeUpdate() {
        if (!_enabled || !_segments.length) return;
        const v = VideoContext.getVideoEl();
        if (!v) return;
        const t = v.currentTime;
        for (const seg of _segments) {
            const key = `${seg.start}-${seg.end}`;
            if (_skippedUUIDs.has(key)) continue;
            // Chỉ skip khi đang ở TRONG segment (không skip ngược nếu user tua
            // qua rồi tua lại vào giữa segment có chủ đích — chỉ tự skip khi
            // playback tự nhiên đi vào đầu segment).
            if (t >= seg.start && t < seg.end - 0.3) {
                _skippedUUIDs.add(key);
                PlayerControl.seekTo(seg.end);
                EventBus.emit('voiceLabel', { text: `⏭ Đã bỏ qua đoạn ${seg.category}` });
                setTimeout(() => EventBus.emit('voiceLabel', { text: '' }), 1500);
                break; // chỉ xử lý 1 segment mỗi tick, tránh nhảy nhiều lần liên tiếp nếu segments chồng nhau
            }
        }
    }

    let _pollInterval = null;
    let _enableToken = 0;

    async function enable(videoId) {
        const myToken = ++_enableToken;
        _enabled = true;
        _skippedUUIDs = new Set();
        const segments = await getSegments(videoId);
        // Nếu có lệnh enable/disable khác xảy ra trong lúc đang await fetch
        // (navigate sang video khác trước khi fetch xong), bỏ kết quả này —
        // tránh áp dụng nhầm segment của video cũ vào video hiện tại.
        if (myToken !== _enableToken) return;
        _segments = segments;
        if (!_pollInterval) {
            // Poll thay vì 'timeupdate' event: timeupdate fire quá thường xuyên
            // (mỗi ~250ms) không cần thiết cho việc check segment, 500ms đủ
            // chính xác và nhẹ hơn cho CPU.
            _pollInterval = setInterval(_onTimeUpdate, 500);
        }
    }

    function disable() {
        ++_enableToken; // huỷ mọi enable() đang chờ await
        _enabled = false;
        _segments = [];
        if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
    }

    function isEnabled() { return _enabled; }
    function getCurrentSegments() { return _segments; }

    return { getSegments, enable, disable, isEnabled, getCurrentSegments };
})();
