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
     * Wrapper Promise cho GM_xmlhttpRequest — dùng thay vì fetch() vì đây là
     * request CROSS-ORIGIN thật (sponsor.ajay.app, khác origin youtube.com).
     * fetch() thường vẫn bị same-origin policy chặn nếu server không trả đúng
     * CORS header cho origin gọi tới, và @connect trong userscript header CHỈ
     * có tác dụng với GM_xmlhttpRequest — không ảnh hưởng gì tới fetch(). Dùng
     * GM_xmlhttpRequest đảm bảo hoạt động chắc chắn bất kể server có cấu hình
     * CORS đúng hay không.
     */
    function _gmFetch(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url,
                onload: (res) => resolve(res),
                onerror: (err) => reject(err),
                ontimeout: () => reject(new Error('timeout')),
            });
        });
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
            const res = await _gmFetch(url);

            // 404 nghĩa là KHÔNG có video nào trùng prefix có segment — hoàn
            // toàn bình thường (phần lớn video VTV sẽ rơi vào trường hợp này),
            // không phải lỗi, không log warning.
            if (res.status === 404) { _cache.set(videoId, { segments: [], timestamp: Date.now() }); return []; }
            if (res.status < 200 || res.status >= 300) { warn('[SponsorBlock] HTTP', res.status); return []; }

            const data = JSON.parse(res.responseText);
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

    /**
     * Wrapper Promise cho GM_xmlhttpRequest kiểu POST, dùng để SUBMIT segment
     * lên SponsorBlock (khác với _gmFetch chỉ GET để đọc). Cùng lý do dùng
     * GM_xmlhttpRequest thay vì fetch() như đã giải thích ở trên.
     */
    function _gmPost(url, bodyObj) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(bodyObj),
                onload: (res) => resolve(res),
                onerror: (err) => reject(err),
                ontimeout: () => reject(new Error('timeout')),
            });
        });
    }

    /**
     * userID ẩn danh, sinh 1 lần và lưu vĩnh viễn (KHÔNG gắn với danh tính
     * thật nào — đây chính là cách SponsorBlock chính thức hoạt động: userID
     * chỉ dùng để server nhóm các lượt submit/vote lại, tính "uy tín"
     * (reputation) theo thời gian, không phải để định danh user thật). Dùng
     * getGlobal (không theo profile) vì reputation nên gắn với TRÌNH DUYỆT
     * này nói chung, không tách theo từng profile nội bộ của userscript.
     */
    function _getAnonUserId() {
        let id = Storage.getGlobal('sbUserId', null);
        if (!id) {
            id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'sb-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            Storage.setGlobal('sbUserId', id);
        }
        return id;
    }

    /**
     * Gửi 1 segment lên SponsorBlock — ĐÂY LÀ ĐÓNG GÓP CÔNG KHAI, dữ liệu
     * (thời gian bắt đầu/kết thúc, category, userID ẩn danh) sẽ hiển thị cho
     * TOÀN BỘ cộng đồng SponsorBlock dùng chung, không chỉ riêng user này —
     * phải luôn thông báo rõ điều này cho user trước khi gửi (xem
     * VoiceControl gọi hàm này).
     * CHƯA TỪNG TEST VỚI SERVER THẬT (môi trường này không có mạng ra
     * sponsor.ajay.app) — cấu trúc payload dựa theo API docs công khai của
     * SponsorBlock, nhưng nên coi lần submit đầu tiên là "thử nghiệm", kiểm
     * tra log console nếu server phản hồi lỗi bất ngờ.
     */
    async function submitSegment(videoId, category, startTime, endTime) {
        if (!videoId || startTime == null || endTime == null) {
            return { ok: false, error: 'Thiếu thông tin đoạn cần đánh dấu' };
        }
        const start = Math.min(startTime, endTime);
        const end   = Math.max(startTime, endTime);
        if (end - start < 1) {
            return { ok: false, error: 'Đoạn quá ngắn (dưới 1 giây) — có thể do bấm nhầm liên tiếp' };
        }
        try {
            const body = {
                userID: _getAnonUserId(),
                videoID: videoId,
                segments: [{ segment: [start, end], category }],
            };
            const res = await _gmPost(API_BASE, body);
            if (res.status >= 200 && res.status < 300) {
                _cache.delete(videoId); // buộc fetch lại lần sau để lấy luôn segment vừa submit
                log('[SponsorBlock] Đã submit:', category, start.toFixed(1), '→', end.toFixed(1));
                return { ok: true };
            }
            if (res.status === 409) return { ok: true, note: 'Đoạn này đã có người khác đánh dấu trước rồi' };
            warn('[SponsorBlock] Submit thất bại, HTTP', res.status, res.responseText);
            return { ok: false, error: `Server trả lỗi HTTP ${res.status}` };
        } catch (e) {
            warn('[SponsorBlock] Lỗi khi submit:', e);
            return { ok: false, error: 'Lỗi mạng khi gửi lên server' };
        }
    }

    // ─── Đánh dấu thủ công (start/cancel/finish) ───────────────────────────────
    let _markStart = null;
    let _markStartedAt = 0;

    function startMark() {
        const v = VideoContext.getVideoEl();
        if (!v) return null;
        _markStart = v.currentTime;
        _markStartedAt = Date.now();
        return _markStart;
    }

    function cancelMark() { _markStart = null; }
    function isMarking()  { return _markStart != null; }
    function getMarkStart() { return _markStart; }

    async function finishMark(category = 'sponsor') {
        if (_markStart == null) return { ok: false, error: 'Chưa bắt đầu đánh dấu — nói "đánh dấu bắt đầu tài trợ" trước' };
        const v = VideoContext.getVideoEl();
        if (!v) { _markStart = null; return { ok: false, error: 'Không tìm thấy video' }; }
        // Nếu user quên kết thúc quá lâu (>10 phút) — nhiều khả năng bấm nhầm
        // hoặc quên, huỷ tự động thay vì submit 1 đoạn dài bất thường.
        if (Date.now() - _markStartedAt > 10 * 60_000) {
            _markStart = null;
            return { ok: false, error: 'Đã quá lâu kể từ lúc bắt đầu đánh dấu (>10 phút), tự huỷ để tránh gửi nhầm đoạn quá dài' };
        }
        const start = _markStart;
        const end   = v.currentTime;
        _markStart  = null;
        const videoId = new URLSearchParams(location.search).get('v');
        return submitSegment(videoId, category, start, end);
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

    return {
        getSegments, enable, disable, isEnabled, getCurrentSegments,
        submitSegment, startMark, cancelMark, finishMark, isMarking, getMarkStart,
    };
})();
