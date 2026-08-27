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

    /**
     * BUG THẬT ĐÃ FIX: `window.ytInitialPlayerResponse` — dù tên gọi có
     * "Initial" — KHÔNG đảm bảo tự cập nhật sau mỗi lần SPA navigate sang
     * video mới (đã xác nhận qua tài liệu bên ngoài: dev khác gặp đúng vấn
     * đề này, phải tự verify `videoDetails.videoId` khớp video hiện tại
     * trước khi tin dùng global này, nếu không phải tự fetch lại qua
     * network). Code cũ đọc thẳng KHÔNG verify — sau khi chuyển sang video
     * khác, nếu global chưa kịp cập nhật (hoặc không cập nhật), hàm này trả
     * về kênh của video CŨ, khiến toàn bộ luồng detect kênh sai/"không thèm
     * update" đúng như đã báo. Giờ luôn verify videoId khớp trước khi tin —
     * không khớp thì coi như "chưa có", để resolve() fallback qua _fromDOM()
     * (đọc trực tiếp DOM đã re-render, luôn đúng video hiện tại).
     */
    function _fromPlayerResponse(win, expectedVideoId) {
        try {
            const p = win.ytInitialPlayerResponse ?? win.ytplayer?.config?.args?.raw_player_response;
            const details = p?.videoDetails;
            if (!details?.author) return null;
            if (expectedVideoId && details.videoId && details.videoId !== expectedVideoId) {
                return null; // stale — thuộc về video KHÁC, không dùng
            }
            return { name: details.author, id: details.channelId || null };
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
     *
     * BUG THẬT ĐÃ FIX (research: đã xác nhận qua nguồn ngoài — YouTube có
     * pattern "metadata lags navigation": ngay sau `yt-navigate-finish`, URL
     * đã đổi (`?v=` mới) nhưng phần tử DOM hiển thị metadata — ví dụ tiêu đề
     * `h1.ytd-watch-metadata` — VẪN CÒN giữ nội dung của video CŨ "trong
     * chốc lát" trước khi Polymer re-render xong, vì phần tử DOM được TÁI SỬ
     * DỤNG chứ không tạo mới mỗi lần nav). `ytd-video-owner-renderer` (nơi
     * `_fromDOM()` đọc tên kênh) nhiều khả năng dính CÙNG pattern này (chưa
     * có nguồn xác nhận riêng cho chính element này, nhưng đây là hành vi
     * chung của DOM data-binding trong toàn bộ Polymer app, không phải đặc
     * thù của 1 element — không có lý do để nó là ngoại lệ). `_fromDOM()`
     * trước đây được TIN NGAY LẬP TỨC ở lần đọc ĐẦU TIÊN thành công, không
     * verify gì — nếu bắt trúng đúng "chốc lát" đó, sẽ trả về + CACHE VĨNH
     * VIỄN tên kênh của video CŨ cho videoId MỚI (cache theo videoId, không
     * tự sửa lại cho tới khi reload cả trang) — đúng triệu chứng "thỉnh
     * thoảng mắc kẹt sau SPA nav, không detect được kênh khác".
     * Sửa: yêu cầu 2 lần đọc DOM LIÊN TIẾP (cách nhau 1 tick retry, ~300ms)
     * cho kết quả GIỐNG HỆT nhau mới chấp nhận + cache — nếu DOM vẫn đang
     * "lag" giữa 2 lần đọc, 2 kết quả sẽ khác nhau (giá trị cũ → giá trị
     * mới) và bị từ chối, vòng lặp tự thử lại tới khi ổn định. Đổi lại: chậm
     * thêm tối đa ~300ms cho case phải rơi vào nhánh DOM fallback (không xảy
     * ra nếu `_fromPlayerResponse` đã đủ nhanh/đáng tin — vẫn ưu tiên nhánh
     * đó trước như cũ), đánh đổi hợp lý để không bao giờ bị SAI VĨNH VIỄN.
     * @param {string} videoId — current video ID (used for per-video dedup only)
     * @returns {Promise<{name:string, id:string|null}>}
     */
    async function resolve(videoId) {
        if (videoId && _cache.has(videoId)) return _cache.get(videoId);

        const win = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

        await _waitForOwner();

        const fast = _fromPlayerResponse(win, videoId);
        if (fast) {
            if (videoId) _cache.set(videoId, fast);
            return fast;
        }

        let prevDom = null; // candidate DOM đọc được ở lần lặp TRƯỚC — dùng để xác nhận đã "ổn định"
        for (let i = 0; i < 50; i++) {
            const pr = _fromPlayerResponse(win, videoId);
            if (pr) { if (videoId) _cache.set(videoId, pr); return pr; }

            const dom = _fromDOM();
            if (dom) {
                if (prevDom && prevDom.name === dom.name && prevDom.id === dom.id) {
                    // Giống hệt lần đọc trước → coi như đã ổn định, đủ tin cậy để cache.
                    if (videoId) _cache.set(videoId, dom);
                    return dom;
                }
                // Chưa ổn định (khác lần đọc trước, hoặc đây là lần đầu có
                // candidate) — CHƯA trả về, ghi nhớ để so sánh ở vòng kế tiếp.
                prevDom = dom;
            }

            await new Promise(r => setTimeout(r, 300));
        }
        return { name: '', id: null };
    }

    /** Clear cache on full page reload (called by entry.js on beforeunload) */
    function clearCache() { _cache.clear(); }

    return { resolve, clearCache };
})();
