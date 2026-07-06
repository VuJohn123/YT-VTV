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
    const WATCHDOG_MS = 1200; // đủ thời gian cho SPA nav bắt đầu chuyển URL, không đủ lâu để user cảm thấy delay

    let _watchdogTimer = null;
    let _urlChangedSincePending = false;
    let _lastSeenHref = location.href;

    function _onUrlChangeSignal() {
        if (location.href !== _lastSeenHref) {
            _lastSeenHref = location.href;
            _urlChangedSincePending = true;
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
    }

    function _hardNavigate(url) {
        log('[Navigator] SPA nav không xảy ra kịp thời, fallback hard reload:', url);
        window.location.href = url;
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
        try {
            anchor = document.createElement('a');
            anchor.href = url;
            anchor.style.display = 'none';
            anchor.rel = 'noopener'; // không mở tab mới, không ảnh hưởng ngoài dự kiến
            document.body.appendChild(anchor);
            anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (err) {
            warn('[Navigator] Lỗi khi tạo SPA nav click, fallback hard reload:', err);
            _hardNavigate(url);
            return;
        } finally {
            if (anchor?.isConnected) anchor.remove();
        }

        // Watchdog: xác nhận SPA nav thực sự đã xảy ra trong thời gian hợp lý;
        // nếu không, coi như thất bại và tự cứu bằng hard reload.
        _watchdogTimer = setTimeout(() => {
            _watchdogTimer = null;
            if (!_urlChangedSincePending) _hardNavigate(url);
        }, WATCHDOG_MS);
    }

    /**
     * Huỷ watchdog đang chờ (nếu có) — dùng khi cần đảm bảo không có fallback
     * "hồi tố" xảy ra sai chỗ, ví dụ khi component chủ động huỷ 1 pending nav.
     */
    function cancelPending() { _clearWatchdog(); }

    return { goTo, cancelPending };
})();
