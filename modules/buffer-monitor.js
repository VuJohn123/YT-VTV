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
    // Trước đây chỉ giảm quality, KHÔNG BAO GIỜ tự nâng lại — user bị kẹt ở
    // mức thấp vĩnh viễn dù mạng đã ổn định trở lại, phải tự vào Settings đổi
    // tay. Thêm: nếu không buffer suốt UPGRADE_STABLE_MS, thử nâng lại 1 bậc.
    const UPGRADE_STABLE_MS   = 3 * 60_000; // 3 phút không buffer coi là mạng đã ổn
    const UPGRADE_CHECK_MS    = 30_000;     // tần suất kiểm tra điều kiện nâng lại

    const QUALITY_LADDER = ['highres', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

    let _waitingTimestamps = [];
    let _lastDowngradeAt = 0;
    let _lastWaitingAt = 0;
    let _downgradeSteps = 0; // số bậc TỰ hạ — chỉ nâng lại trong phạm vi này, không bao giờ vượt mức trước khi mình can thiệp (tôn trọng lựa chọn thủ công của user)
    let _upgradeTimer = null;
    let _enabled = false;
    let _attachedVideoEl = null;

    function _onWaiting() {
        if (!_enabled) return;
        const now = Date.now();
        _lastWaitingAt = now;
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
            _downgradeSteps++;
            log('[BufferMonitor] Buffering liên tục, tự giảm chất lượng:', current, '→', target, `(đã hạ ${_downgradeSteps} bậc)`);
            EventBus.emit('voiceLabel', { text: `📉 Giảm chất lượng xuống ${target} do mạng chậm` });
            _scheduleUpgradeCheck();
        }
    }

    /** Thử nâng lại 1 bậc nếu mạng đã ổn định đủ lâu — chỉ nâng trong phạm vi đã tự hạ, không đụng tới lựa chọn quality gốc của user. */
    function _tryUpgrade() {
        if (!_enabled || _downgradeSteps <= 0) return;
        const now = Date.now();
        if (now - _lastWaitingAt < UPGRADE_STABLE_MS) return;   // vẫn còn buffer gần đây, chưa đủ ổn định
        if (now - _lastDowngradeAt < UPGRADE_STABLE_MS) return; // vừa mới hạ xong, đợi thêm trước khi thử nâng

        const current = PlayerControl.getQuality();
        if (!current) return;
        const idx = QUALITY_LADDER.indexOf(current);
        if (idx <= 0) return;

        const target = QUALITY_LADDER[idx - 1];
        const ok = PlayerControl.setQuality(target);
        if (ok) {
            _downgradeSteps--;
            _lastDowngradeAt = now; // dùng chung mốc thời gian để tránh nâng liên tục dồn dập nếu vẫn còn chập chờn
            log('[BufferMonitor] Mạng ổn định trở lại, tự nâng chất lượng:', current, '→', target, `(còn ${_downgradeSteps} bậc đã hạ)`);
            EventBus.emit('voiceLabel', { text: `📈 Mạng ổn định, nâng chất lượng lên ${target}` });
        }
    }

    function _scheduleUpgradeCheck() {
        if (_upgradeTimer) return;
        _upgradeTimer = setInterval(() => {
            if (!_enabled || _downgradeSteps <= 0) { clearInterval(_upgradeTimer); _upgradeTimer = null; return; }
            _tryUpgrade();
        }, UPGRADE_CHECK_MS);
    }

    function _attach() {
        // Gác cổng bằng _enabled — hàm này đăng ký 1 lần duy nhất ở
        // module-scope (xem cuối enable() bên dưới) nên vẫn fire kể cả khi
        // BufferMonitor đang tắt. Hiện tại chưa có UI toggle bật/tắt tính
        // năng này (chỉ enable() 1 lần khi script khởi động), nên bug "N lần
        // đăng ký chồng" chưa xảy ra trên thực tế — nhưng sửa trước theo
        // cùng pattern đã áp dụng ở WatchParty/AudioMode/AutoPiP để phòng
        // ngừa nếu sau này có người thêm toggle cho tính năng này.
        if (!_enabled) return;
        const v = VideoContext.getVideoEl();
        if (!v || v === _attachedVideoEl) return;
        _attachedVideoEl = v;
        v.addEventListener('waiting', _onWaiting);
        // Tập mới → YouTube tự set lại quality mặc định, state "đã hạ mấy bậc"
        // của tập cũ không còn ý nghĩa, tránh nâng/hạ nhầm dựa trên counter cũ.
        _downgradeSteps = 0;
        _waitingTimestamps = [];
    }

    // re-attach khi chuyển tập (video element mới) — đăng ký đúng 1 lần ở
    // module-scope, không phải bên trong enable() (xem comment ở _attach()).
    EventBus.on('videoReady', _attach);

    function enable() {
        _enabled = true;
        _waitingTimestamps = [];
        _attach();
    }

    function disable() {
        _enabled = false;
        _waitingTimestamps = [];
        if (_upgradeTimer) { clearInterval(_upgradeTimer); _upgradeTimer = null; }
    }

    function isEnabled() { return _enabled; }

    return { enable, disable, isEnabled };
})();
