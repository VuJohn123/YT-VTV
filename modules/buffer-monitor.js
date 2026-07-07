// buffer-monitor.js — Layer 2: Tự động giảm chất lượng khi phát hiện buffering liên tục
//
// Theo dõi sự kiện 'waiting' (buffering) trên <video>. Nếu xảy ra quá
// WAITING_THRESHOLD lần trong WINDOW_MS, tự động gọi PlayerControl.setQuality
// giảm 1 bậc — cải thiện trải nghiệm trên mạng chậm mà không cần user tự vào
// Settings đổi tay.
//
// TRÁNH DOWNGRADE LIÊN TỤC: sau khi downgrade 1 lần, có cooldown
// COOLDOWN_MS trước khi cho phép downgrade tiếp — tránh trường hợp mạng chập
// chờn khiến quality bị hạ liên tục xuống tận đáy chỉ vì vài giây mất mạng
// tạm thời.

const BufferMonitor = (() => {
    const WINDOW_MS = 30_000;
    const WAITING_THRESHOLD = 3;
    const COOLDOWN_MS = 60_000;

    const QUALITY_LADDER = ['highres', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

    let _waitingTimestamps = [];
    let _lastDowngradeAt = 0;
    let _enabled = false;
    let _attachedVideoEl = null;

    function _onWaiting() {
        if (!_enabled) return;
        const now = Date.now();
        _waitingTimestamps.push(now);
        _waitingTimestamps = _waitingTimestamps.filter(t => now - t < WINDOW_MS);

        if (_waitingTimestamps.length >= WAITING_THRESHOLD && now - _lastDowngradeAt > COOLDOWN_MS) {
            _downgrade();
            _lastDowngradeAt = now;
            _waitingTimestamps = [];
        }
    }

    function _downgrade() {
        const current = PlayerControl.getQuality();
        if (!current) return; // API không khả dụng, không thể biết mức hiện tại để hạ xuống 1 bậc an toàn

        const idx = QUALITY_LADDER.indexOf(current);
        if (idx === -1 || idx === QUALITY_LADDER.length - 1) return; // đã ở mức thấp nhất hoặc không nhận diện được

        const target = QUALITY_LADDER[idx + 1];
        const ok = PlayerControl.setQuality(target);
        if (ok) {
            log('[BufferMonitor] Buffering liên tục, tự giảm chất lượng:', current, '→', target);
            EventBus.emit('voiceLabel', { text: `📉 Giảm chất lượng xuống ${target} do mạng chậm` });
        }
    }

    function _attach() {
        const v = VideoContext.getVideoEl();
        if (!v || v === _attachedVideoEl) return;
        _attachedVideoEl = v;
        v.addEventListener('waiting', _onWaiting);
    }

    function enable() {
        _enabled = true;
        _waitingTimestamps = [];
        _attach();
        EventBus.on('videoReady', _attach); // re-attach khi chuyển tập (video element mới)
    }

    function disable() {
        _enabled = false;
        _waitingTimestamps = [];
    }

    function isEnabled() { return _enabled; }

    return { enable, disable, isEnabled };
})();
