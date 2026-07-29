// navigator.js — Layer 1.5: SPA-native navigation cho YouTube
//
// MỤC TIÊU: chuyển sang video/tập tiếp theo mà KHÔNG reload toàn trang, tận
// dụng router SPA có sẵn của YouTube (Polymer `ytd-app`) để giữ nguyên state
// player, tab background, extension khác không bị mất, và cảm giác chuyển tập
// mượt như bấm vào gợi ý trong sidebar.
//
// CHIẾN LƯỢC (graceful degradation — ưu tiên mượt, nhưng KHÔNG BAO GIỜ để user
// bị kẹt nếu SPA nav thất bại):
//   1. Fast path: tạo <a href="..."> ẩn rồi dispatch click. YouTube's Polymer
//      router tự intercept mọi click vào link nội bộ cùng origin và tự chuyển
//      trang qua SPA (không cần biết chi tiết event/endpoint nội bộ của nó —
//      cách này ổn định hơn nhiều so với tự dispatch 'yt-navigate' hay gọi
//      thẳng API nội bộ, vì cấu trúc đó đổi thường xuyên giữa các version
//      YouTube và dễ vỡ khi họ refactor).
//   2. Watchdog: nếu sau WATCHDOG_MS mà không thấy tín hiệu URL đã đổi (SPA
//      nav không xảy ra — do YouTube đổi cấu trúc DOM, do extension khác chặn
//      click event, do link interceptor chưa kịp gắn khi trang mới load...),
//      tự động fallback về hard reload (`location.href = url`) để đảm bảo
//      navigation LUÔN xảy ra. Đây là lưới an toàn bắt buộc, không phải
//      optional — mất tính năng "mượt" còn chấp nhận được, mất khả năng
//      chuyển tập thì không.
//   3. Nếu URL đã đổi (do SPA nav thành công, hoặc do user tự điều hướng thủ
//      công trong lúc chờ) trước khi watchdog bắn, watchdog tự huỷ — không
//      bao giờ fallback đè lên 1 navigation đã xảy ra.

const Navigator = (() => {
    // WATCHDOG_MS ban đầu bảo thủ (đủ an toàn cho lần nav đầu tiên khi chưa
    // biết tốc độ SPA router thực tế của máy/mạng user). Sau khi đo được vài
    // lần nav SPA thành công, tự thu hẹp về sát độ trễ thực đo được — cảm
    // giác chuyển tập nhanh hơn rõ rệt trên máy mà SPA nav vốn xử lý nhanh,
    // mà vẫn không mất lưới an toàn (không bao giờ xuống dưới WATCHDOG_FLOOR_MS).
    const WATCHDOG_MS_INITIAL = 1200;
    const WATCHDOG_FLOOR_MS   = 500;
    const WATCHDOG_SAMPLE_MARGIN = 1.6; // hệ số an toàn nhân với latency trung bình đo được
    const WATCHDOG_SAMPLES_NEEDED = 3;  // cần đủ mẫu mới tin tưởng điều chỉnh xuống

    let _watchdogMs = WATCHDOG_MS_INITIAL;
    let _navLatencySamples = [];
    let _pendingNavAt = 0;

    let _watchdogTimer = null;
    let _urlChangedSincePending = false;
    let _lastSeenHref = location.href;

    function _onUrlChangeSignal() {
        if (location.href !== _lastSeenHref) {
            _lastSeenHref = location.href;
            _urlChangedSincePending = true;
            // Đo latency thực tế của lần SPA nav vừa xảy ra (chỉ tính khi có
            // 1 lần goTo() đang chờ xác nhận — tránh lẫn với nav tự nhiên do
            // user tự bấm link/back-forward không qua goTo()).
            if (_pendingNavAt > 0) {
                const latency = Date.now() - _pendingNavAt;
                _pendingNavAt = 0;
                if (latency > 0 && latency < WATCHDOG_MS_INITIAL) {
                    _navLatencySamples.push(latency);
                    if (_navLatencySamples.length > 8) _navLatencySamples.shift(); // rolling window, ưu tiên mẫu gần nhất
                    if (_navLatencySamples.length >= WATCHDOG_SAMPLES_NEEDED) {
                        const avg = _navLatencySamples.reduce((a, b) => a + b, 0) / _navLatencySamples.length;
                        _watchdogMs = Math.max(WATCHDOG_FLOOR_MS, Math.round(avg * WATCHDOG_SAMPLE_MARGIN));
                    }
                }
            }
        }
    }
    // 'yt-navigate-finish' là tín hiệu đáng tin cậy nhất (SPA router của
    // YouTube tự bắn ra khi nó chuyển trang xong), cũng lắng nghe 'popstate'
    // để bắt trường hợp user tự bấm back/forward trong lúc watchdog đang chờ.
    document.addEventListener('yt-navigate-finish', _onUrlChangeSignal);
    window.addEventListener('popstate', _onUrlChangeSignal);

    function _sameVideoId(url) {
        try {
            const targetId  = new URL(url, location.href).searchParams.get('v');
            const currentId = new URLSearchParams(location.search).get('v');
            return !!targetId && targetId === currentId;
        } catch (e) { return false; }
    }

    function _clearWatchdog() {
        if (_watchdogTimer) { clearTimeout(_watchdogTimer); _watchdogTimer = null; }
        _pendingNavAt = 0;
    }

    function _hardNavigate(url) {
        log('[Navigator] SPA nav không xảy ra kịp thời, fallback hard reload:', url);
        window.location.href = url;
    }

    /**
     * Tạo <a> ẩn và click để kích hoạt SPA router của YouTube.
     * QUAN TRỌNG: trước đây dùng `anchor.style.display = 'none'` — điều này
     * khiến `offsetParent` của anchor luôn là `null` (không có bounding box
     * thật). Một số handler click nội bộ của YouTube (heuristic lọc click
     * giả lập/bot) có thể bỏ qua target không có layout thật, khiến SPA nav
     * KHÔNG BAO GIỜ xảy ra và watchdog luôn fallback về hard reload — đúng
     * triệu chứng "navigate link Youtube thì mượt, còn script mình thì cứ
     * reload". Sửa: dùng position:fixed + kích thước 1x1 + opacity gần 0 để
     * anchor có bounding box thật (offsetParent hợp lệ) nhưng vẫn hoàn toàn
     * vô hình. Đồng thời dùng `anchor.click()` (method chuẩn, tự điền đủ
     * property của 1 click thật) thay vì tự dựng `new MouseEvent(...)`, và
     * gỡ anchor ở tick sau thay vì đồng bộ ngay — phòng router xử lý click
     * bất đồng bộ (rAF/microtask) rồi mới đọc lại target.
     */
    function _dispatchSpaClick(url) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
        anchor.rel = 'noopener';
        anchor.tabIndex = -1;
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => anchor.remove(), 0);
    }

    /**
     * Điều hướng tới URL (thường là video khác) ưu tiên SPA-native, tự fallback
     * hard-reload nếu thất bại. An toàn để gọi nhiều lần liên tiếp — mỗi lần
     * gọi mới sẽ huỷ watchdog của lần gọi trước (chỉ theo dõi lần gọi mới nhất).
     * @param {string} url - URL video đích (tuyệt đối hoặc tương đối)
     * @param {object} [opts]
     * @param {boolean} [opts.forceHard=false] - bỏ qua SPA nav, hard reload luôn
     */
    function goTo(url, opts = {}) {
        if (!url) return;
        _clearWatchdog();

        if (opts.forceHard) { _hardNavigate(url); return; }

        if (_sameVideoId(url)) {
            // Đã ở đúng video rồi (ví dụ user bấm nút 2 lần) — không làm gì,
            // tránh trigger navigation thừa hoặc reload không cần thiết.
            log('[Navigator] Đã ở video đích, bỏ qua navigate:', url);
            return;
        }

        let anchor;
        _urlChangedSincePending = false; // reset TRƯỚC dispatch — SPA router có thể xử lý đồng bộ
        _pendingNavAt = Date.now();
        try {
            _dispatchSpaClick(url);
        } catch (err) {
            warn('[Navigator] Lỗi khi tạo SPA nav click, fallback hard reload:', err);
            _pendingNavAt = 0;
            _hardNavigate(url);
            return;
        }

        // Watchdog: xác nhận SPA nav thực sự đã xảy ra trong thời gian hợp lý;
        // nếu không, coi như thất bại và tự cứu bằng hard reload. Thời lượng
        // tự thu hẹp dần về sát độ trễ SPA nav thực đo được (xem
        // _onUrlChangeSignal) sau vài lần nav thành công đầu tiên.
        _watchdogTimer = setTimeout(() => {
            _watchdogTimer = null;
            _pendingNavAt = 0;
            if (!_urlChangedSincePending) _hardNavigate(url);
        }, _watchdogMs);
    }

    /**
     * Huỷ watchdog đang chờ (nếu có) — dùng khi cần đảm bảo không có fallback
     * "hồi tố" xảy ra sai chỗ, ví dụ khi component chủ động huỷ 1 pending nav.
     */
    function cancelPending() { _clearWatchdog(); }

    return { goTo, cancelPending };
})();
