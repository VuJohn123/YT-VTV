// tab-guard.js — Layer 2: Cảnh báo khi CÙNG 1 video VTV đang mở ở ≥2 tab
// cùng trình duyệt/máy.
//
// KHÁC WatchParty (watch-party.js): đây KHÔNG đồng bộ play/pause/seek/nav gì
// cả, chỉ đơn thuần CẢNH BÁO thụ động cho user biết — mặc định BẬT SẴN
// (không cần chủ động bật như WatchParty, vốn là tính năng nặng hơn nhiều
// và có tác dụng phụ rõ ràng nên phải opt-in). Mục đích: tránh user vô tình
// mở trùng 2 tab cùng phim (quên đã mở tab kia, double-click nhầm link
// playlist...) mà không biết — 2 tab cùng phát cùng lúc gây audio đè
// chồng lên nhau, lãng phí băng thông/CPU decode 2 luồng giống hệt nhau.
//
// DÙNG BROADCASTCHANNEL RIÊNG, KHÁC hẳn kênh của WatchParty — 2 tính năng
// độc lập hoàn toàn về mục đích lẫn dữ liệu, không được lẫn lộn (nếu dùng
// chung 1 channel, message của tính năng này có thể bị WatchParty hiểu
// nhầm là lệnh sync và ngược lại).
//
// CƠ CHẾ: mỗi tab tự "điểm danh" định kỳ (heartbeat, không phải announce 1
// lần) qua BroadcastChannel, mang theo videoId hiện tại. Tab nào nhận được
// heartbeat từ tab KHÁC có CÙNG videoId → hiện cảnh báo. Heartbeat LẶP LẠI
// (không phải 1 lần) để tab mở SAU vẫn phát hiện được tab đã mở TRƯỚC —
// không cần thêm cơ chế query/response riêng, đơn giản hơn WatchParty vì
// không cần độ trễ thấp (chỉ là cảnh báo, vài giây trễ không sao).

const TabGuard = (() => {
    const CHANNEL_NAME   = 'vtv-ultimate-tab-guard'; // KHÁC channel của WatchParty (xem comment ở trên)
    const HEARTBEAT_MS   = 4000;
    const PEER_STALE_MS  = 12_000; // không nghe heartbeat quá lâu → coi tab kia đã đóng/chuyển video khác

    const _tabId = Math.random().toString(36).slice(2);

    let _enabled         = false;
    let _channel         = null;
    let _heartbeatTimer  = null;
    let _currentVideoId  = null;
    let _peers           = new Map(); // tabId → { videoId, lastSeen }
    let _warningShown    = false;

    function _send(msg) {
        if (!_channel) return;
        try { _channel.postMessage(msg); } catch (e) { warn('[TabGuard] send lỗi:', e); }
    }

    function _handleIncoming(msg) {
        const { from, videoId } = msg || {};
        if (!from || from === _tabId) return;
        if (!videoId) {
            // videoId=null/rỗng = tín hiệu "đã rời video" tường minh (tab kia
            // đóng lại hoặc chuyển sang trang không phải VTV) — dọn NGAY khỏi
            // peer list thay vì đợi PEER_STALE_MS mới tự hết hạn, để cảnh báo
            // biến mất tức thời thay vì trễ tới 12s sau khi tab kia đã đóng.
            _peers.delete(from);
        } else {
            _peers.set(from, { videoId, lastSeen: Date.now() });
        }
        _reevaluate();
    }

    /** Đếm số tab khác đang mở CÙNG videoId, dọn peer đã "hết hạn" (không heartbeat gần đây → coi như đã đóng). */
    function _reevaluate() {
        if (!_enabled || !_currentVideoId) { _clearWarning(); return; }
        const now = Date.now();
        let dupCount = 0;
        for (const [id, p] of _peers) {
            if (now - p.lastSeen > PEER_STALE_MS) { _peers.delete(id); continue; }
            if (p.videoId === _currentVideoId) dupCount++;
        }
        if (dupCount > 0) _showWarning(dupCount);
        else _clearWarning();
    }

    function _showWarning(count) {
        _warningShown = true;
        EventBus.emit('dupTabWarning', { count });
    }

    function _clearWarning() {
        if (!_warningShown) return;
        _warningShown = false;
        EventBus.emit('dupTabWarning', { count: 0 });
    }

    function _heartbeat() {
        // Gửi cả khi videoId=null (KHÁC lần đầu thiết kế — trước đây bail
        // sớm nếu !_currentVideoId, khiến peer khác phải đợi PEER_STALE_MS
        // mới tự dọn cảnh báo dù tab này đã rời video từ lâu). Giờ null
        // cũng được gửi như tín hiệu "rời đi" tường minh — xem
        // _handleIncoming() xử lý phía nhận.
        _send({ from: _tabId, videoId: _currentVideoId, ts: Date.now() });
    }

    /**
     * Gọi mỗi khi video hiện tại của tab NÀY đổi (chuyển tập, chuyển video
     * khác, hoặc rời khỏi trang VTV — truyền null). Reset cảnh báo về trạng
     * thái chưa xác định rồi tự đánh giá lại ngay + gửi heartbeat NGAY (không
     * đợi tick định kỳ tiếp theo) — tránh cảnh báo "dính" theo video CŨ vài
     * giây sau khi đã chuyển sang video khác không còn trùng ai, và giúp
     * peer khác phát hiện video MỚI sớm nhất có thể thay vì đợi tới
     * HEARTBEAT_MS kế tiếp.
     */
    function setCurrentVideo(videoId) {
        _currentVideoId = videoId || null;
        _warningShown = false;
        if (_enabled) _heartbeat();
        _reevaluate();
    }

    function enable() {
        if (_enabled) return;
        if (typeof BroadcastChannel === 'undefined') {
            warn('[TabGuard] BroadcastChannel không được hỗ trợ trên trình duyệt này — tính năng tự vô hiệu hoá');
            return;
        }
        _enabled = true;
        _channel = new BroadcastChannel(CHANNEL_NAME);
        _channel.addEventListener('message', (evt) => _handleIncoming(evt.data));
        _heartbeat();
        _heartbeatTimer = setInterval(_heartbeat, HEARTBEAT_MS);
        log('[TabGuard] enabled');
    }

    function disable() {
        if (!_enabled) return;
        _enabled = false;
        // Báo cho peer khác biết mình rời đi TRƯỚC KHI đóng channel — nếu
        // không, peer khác phải đợi PEER_STALE_MS mới tự dọn cảnh báo dù tab
        // này đã tắt tính năng từ lâu (cùng lý do đã sửa ở _heartbeat()).
        _send({ from: _tabId, videoId: null, ts: Date.now() });
        if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
        if (_channel) { _channel.close(); _channel = null; }
        _peers.clear();
        _clearWarning();
    }

    function isEnabled()   { return _enabled; }
    function isSupported() { return typeof BroadcastChannel !== 'undefined'; }

    return { enable, disable, isEnabled, isSupported, setCurrentVideo };
})();
