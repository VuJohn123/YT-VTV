// buffer-monitor.js — Layer 2: Tự động giảm chất lượng khi phát hiện buffering liên tục
//
// Theo dõi sự kiện 'waiting' (buffering) trên <video>. Nếu xảy ra quá
// WAITING_THRESHOLD lần trong WINDOW_MS, tự động gọi PlayerControl.setQuality
// giảm 1 bậc — cải thiện trải nghiệm trên mạng chậm mà không cần user tự vào
// Settings đổi tay.
//
// ADAPTIVE THEO 2 NGUYÊN NHÂN KHÁC NHAU (không chỉ giả định luôn là mạng):
// 'waiting' fire khi buffer THIẾU DỮ LIỆU — đúng nghĩa network-bound. Nhưng
// máy yếu/CPU-GPU quá tải (nhiều tab/app nặng chạy nền) có thể làm RỚT FRAME
// (decode/render không kịp) NGAY CẢ KHI buffer vẫn đầy đủ — trường hợp này
// 'waiting' HOÀN TOÀN KHÔNG fire (dữ liệu có sẵn, chỉ là máy không xử lý kịp),
// nên nếu chỉ dựa vào 'waiting' sẽ bỏ sót hẳn case CPU-bound. Đã research:
// `HTMLVideoElement.getVideoPlaybackQuality()` (droppedVideoFrames/
// totalVideoFrames) là API chuẩn, Baseline widely available từ 2020, đúng
// mục đích đo tỉ lệ rớt frame — dùng làm tín hiệu CPU/decode-bound ĐỘC LẬP
// với 'waiting'. Downgrade quality vẫn là phản ứng đúng cho CẢ 2 nguyên nhân
// (ít byte hơn = đỡ mạng, ít pixel hơn = đỡ CPU decode), nhưng phân biệt rõ
// nguyên nhân giúp log/thông báo chính xác thay vì luôn đổ cho "mạng chậm"
// khi thực ra là máy quá tải — TRUNG THỰC về nguyên nhân thay vì đoán bừa 1
// lý do duy nhất.
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

    // ── CPU/decode-bound detection ───────────────────────────────────────────
    const DROP_CHECK_MS = 5_000; // đo tỉ lệ rớt frame mỗi 5s (delta, KHÔNG dùng số cộng dồn thô)
    // Ví dụ minh hoạ chính thức của MDN cho droppedVideoFrames dùng ngưỡng
    // 10% để CẢNH BÁO hiển thị cho user biết — ở đây TỰ ĐỘNG HÀNH ĐỘNG
    // (đổi quality) nên nới ngưỡng lên 15% để giảm rủi ro phản ứng thái quá
    // với dao động ngắn hạn bình thường (không có nguồn nào định nghĩa "con
    // số đúng" cho use-case tự động hoá này — đây là lựa chọn thận trọng có
    // chủ đích, không phải số nghiên cứu được, ghi rõ để không overclaim).
    const DROP_RATE_THRESHOLD = 0.15;
    const DROP_SPIKE_THRESHOLD = 2; // cần lặp lại NHIỀU LẦN trong WINDOW mới downgrade — cùng triết lý WAITING_THRESHOLD, tránh phản ứng vì 1 lần giật thoáng qua

    const QUALITY_LADDER = ['highres', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

    let _waitingTimestamps = [];
    let _dropSpikeTimestamps = [];
    let _lastDowngradeAt = 0;
    let _lastWaitingAt = 0;
    let _lastDropSpikeAt = 0;
    let _downgradeSteps = 0; // số bậc TỰ hạ — chỉ nâng lại trong phạm vi này, không bao giờ vượt mức trước khi mình can thiệp (tôn trọng lựa chọn thủ công của user)
    let _upgradeTimer = null;
    let _dropCheckTimer = null;
    let _enabled = false;
    let _attachedVideoEl = null;
    let _lastFrameSnapshot = null; // { dropped, total } — chụp tại lần _checkDropRate() trước, dùng tính DELTA (tỉ lệ trong khoảng vừa qua), không phải tỉ lệ cộng dồn từ đầu video

    function _onWaiting() {
        if (!_enabled) return;
        const now = Date.now();
        _lastWaitingAt = now;
        _waitingTimestamps.push(now);
        _waitingTimestamps = _waitingTimestamps.filter(t => now - t < WINDOW_MS);

        if (_waitingTimestamps.length >= WAITING_THRESHOLD && now - _lastDowngradeAt > COOLDOWN_MS) {
            _downgrade('network');
            _lastDowngradeAt = now;
            _waitingTimestamps = [];
        }
    }

    /** So sánh delta dropped/total frame giữa 2 lần đo gần nhất — PHẢI dùng
     * delta (không phải q.droppedVideoFrames/q.totalVideoFrames thô cộng
     * dồn), vì càng xem lâu tỉ lệ cộng dồn càng "trơ" (1 đợt rớt frame ngắn
     * giữa video 40 phút gần như không đổi tỉ lệ tổng) — delta mới phản ánh
     * đúng tình trạng NGAY LÚC NÀY. */
    function _checkDropRate() {
        if (!_enabled || !_attachedVideoEl) return;
        if (typeof _attachedVideoEl.getVideoPlaybackQuality !== 'function') return; // graceful degrade — API đã Baseline widely available nhưng vẫn feature-detect cho an toàn thay vì giả định luôn có
        const q = _attachedVideoEl.getVideoPlaybackQuality();
        const now = Date.now();

        if (_lastFrameSnapshot) {
            const dDropped = q.droppedVideoFrames - _lastFrameSnapshot.dropped;
            const dTotal = q.totalVideoFrames - _lastFrameSnapshot.total;
            // dTotal có thể âm/0 nếu counter vừa reset do đổi tập (video mới
            // load) — _attach() đã tự reset _lastFrameSnapshot khi đổi
            // <video> nên trường hợp này hiếm, nhưng vẫn tự bảo vệ ở đây
            // (bỏ qua 1 chu kỳ đo, tự khớp lại đúng ở chu kỳ kế tiếp).
            if (dTotal > 0) {
                const rate = dDropped / dTotal;
                if (rate > DROP_RATE_THRESHOLD) {
                    _lastDropSpikeAt = now;
                    _dropSpikeTimestamps.push(now);
                    _dropSpikeTimestamps = _dropSpikeTimestamps.filter(t => now - t < WINDOW_MS);
                    if (_dropSpikeTimestamps.length >= DROP_SPIKE_THRESHOLD && now - _lastDowngradeAt > COOLDOWN_MS) {
                        log('[BufferMonitor] Tỉ lệ rớt frame cao (', (rate * 100).toFixed(1) + '%', ') dù không thiếu buffer — nghi máy quá tải (CPU/GPU), không phải mạng chậm');
                        _downgrade('cpu');
                        _lastDowngradeAt = now;
                        _dropSpikeTimestamps = [];
                    }
                }
            }
        }
        _lastFrameSnapshot = { dropped: q.droppedVideoFrames, total: q.totalVideoFrames };
    }

    function _downgrade(reason) {
        const current = PlayerControl.getQuality();
        if (!current) return; // API không khả dụng, không thể biết mức hiện tại để hạ xuống 1 bậc an toàn

        const idx = QUALITY_LADDER.indexOf(current);
        if (idx === -1 || idx === QUALITY_LADDER.length - 1) return; // đã ở mức thấp nhất hoặc không nhận diện được

        const target = QUALITY_LADDER[idx + 1];
        const ok = PlayerControl.setQuality(target);
        if (ok) {
            _downgradeSteps++;
            const why = reason === 'cpu' ? 'máy đang quá tải (CPU/GPU), không phải do mạng' : 'buffering liên tục do mạng chậm';
            log('[BufferMonitor] Tự giảm chất lượng (', why, '):', current, '→', target, `(đã hạ ${_downgradeSteps} bậc)`);
            const label = reason === 'cpu'
                ? `📉 Giảm chất lượng xuống ${target} — máy đang quá tải`
                : `📉 Giảm chất lượng xuống ${target} do mạng chậm`;
            EventBus.emit('voiceLabel', { text: label });
            _scheduleUpgradeCheck();
        }
    }

    /** Thử nâng lại 1 bậc nếu mạng đã ổn định đủ lâu — chỉ nâng trong phạm vi đã tự hạ, không đụng tới lựa chọn quality gốc của user. */
    function _tryUpgrade() {
        if (!_enabled || _downgradeSteps <= 0) return;
        const now = Date.now();
        if (now - _lastWaitingAt < UPGRADE_STABLE_MS) return;    // vẫn còn buffer gần đây, chưa đủ ổn định
        // Downgrade có thể do network HOẶC cpu — bất kể lý do hạ ban đầu là
        // gì, nâng lại phải đợi CẢ HAI tín hiệu đều yên ắng đủ lâu, không chỉ
        // tín hiệu đã gây ra lần hạ gần nhất. Nếu chỉ check 1 tín hiệu: hạ vì
        // CPU quá tải, sau đó mạng vẫn ổn (vốn chưa từng là vấn đề) sẽ khiến
        // _lastWaitingAt luôn "cũ" → tưởng đủ điều kiện nâng trong khi máy
        // vẫn đang quá tải y nguyên → nâng lên rồi giật lại ngay lập tức.
        if (now - _lastDropSpikeAt < UPGRADE_STABLE_MS) return;  // vẫn còn rớt frame gần đây, chưa đủ ổn định
        if (now - _lastDowngradeAt < UPGRADE_STABLE_MS) return;  // vừa mới hạ xong, đợi thêm trước khi thử nâng

        const current = PlayerControl.getQuality();
        if (!current) return;
        const idx = QUALITY_LADDER.indexOf(current);
        if (idx <= 0) return;

        const target = QUALITY_LADDER[idx - 1];
        const ok = PlayerControl.setQuality(target);
        if (ok) {
            _downgradeSteps--;
            _lastDowngradeAt = now; // dùng chung mốc thời gian để tránh nâng liên tục dồn dập nếu vẫn còn chập chờn
            log('[BufferMonitor] Đã ổn định trở lại, tự nâng chất lượng:', current, '→', target, `(còn ${_downgradeSteps} bậc đã hạ)`);
            EventBus.emit('voiceLabel', { text: `📈 Đã ổn định, nâng chất lượng lên ${target}` });
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
        _dropSpikeTimestamps = [];
        _lastFrameSnapshot = null; // reset — droppedVideoFrames/totalVideoFrames tự reset "kể từ lần load media gần nhất" theo spec, snapshot cũ không còn liên quan tới <video> element/nguồn phát mới
        if (!_dropCheckTimer) _dropCheckTimer = setInterval(_checkDropRate, DROP_CHECK_MS);
    }

    // re-attach khi chuyển tập (video element mới) — đăng ký đúng 1 lần ở
    // module-scope, không phải bên trong enable() (xem comment ở _attach()).
    EventBus.on('videoReady', _attach);

    function enable() {
        _enabled = true;
        _waitingTimestamps = [];
        _dropSpikeTimestamps = [];
        _attach();
    }

    function disable() {
        _enabled = false;
        _waitingTimestamps = [];
        _dropSpikeTimestamps = [];
        if (_upgradeTimer) { clearInterval(_upgradeTimer); _upgradeTimer = null; }
        if (_dropCheckTimer) { clearInterval(_dropCheckTimer); _dropCheckTimer = null; }
        _lastFrameSnapshot = null;
    }

    function isEnabled() { return _enabled; }

    return {
        enable, disable, isEnabled,
        _internal: { _checkDropRate, _onWaiting, _downgrade, _tryUpgrade },
    };
})();
