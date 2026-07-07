// watch-party.js — Layer 2: Đồng bộ playback giữa nhiều tab cùng máy
//
// Dùng BroadcastChannel API (hỗ trợ mọi trình duyệt hiện đại, không cần
// server/polling) để đồng bộ play/pause/seek giữa các tab đang mở CÙNG video
// trên cùng máy — tiện khi gia đình xem chung nhiều màn hình/tab.
//
// CHỐNG ECHO LOOP: mỗi tab có 1 _instanceId ngẫu nhiên. Khi nhận message,
// nếu message đến từ chính mình (do BroadcastChannel đôi khi echo lại trong
// cùng context tuỳ trình duyệt) hoặc tabId trùng, bỏ qua. Khi TỰ áp dụng 1
// hành động nhận từ tab khác, tạm thời đặt cờ "_applyingRemote" để không phát
// lại sự kiện đó ra channel (tránh vòng lặp vô hạn A→B→A→B...).
//
// PHẠM VI: chỉ đồng bộ khi các tab đang ở ĐÚNG CÙNG videoId — tab đang xem
// video khác sẽ bỏ qua message, không bị nhảy sang video của tab khác.

const WatchParty = (() => {
    const CHANNEL_NAME = 'vtv-ultimate-watch-party';
    const _instanceId = Math.random().toString(36).slice(2);
    let _channel = null;
    let _enabled = false;
    let _applyingRemote = false;
    let _lastBroadcastAt = 0;
    const THROTTLE_MS = 400; // tránh spam broadcast mỗi frame khi seek kéo thanh trượt

    function _currentVideoId() { return new URLSearchParams(location.search).get('v') || ''; }

    function _send(type, payload) {
        if (!_channel || _applyingRemote) return; // không echo lại hành động vừa nhận từ tab khác
        const now = Date.now();
        if (type === 'seek' && now - _lastBroadcastAt < THROTTLE_MS) return;
        _lastBroadcastAt = now;
        try {
            _channel.postMessage({ type, payload, videoId: _currentVideoId(), from: _instanceId, ts: now });
        } catch (e) { warn('[WatchParty] Lỗi gửi message:', e); }
    }

    function _onMessage(evt) {
        const { type, payload, videoId, from } = evt.data || {};
        if (from === _instanceId) return; // tự gửi tự nhận (một số trình duyệt echo trong cùng context)
        if (videoId !== _currentVideoId()) return; // tab khác đang xem video khác, không đồng bộ nhầm

        const v = VideoContext.getVideoEl();
        if (!v) return;

        _applyingRemote = true;
        try {
            switch (type) {
                case 'play':  PlayerControl.play();  break;
                case 'pause': PlayerControl.pause(); break;
                case 'seek':  PlayerControl.seekTo(payload.time); break;
                case 'rate':  PlayerControl.setRate(payload.rate); break;
            }
            EventBus.emit('voiceLabel', { text: '🔗 Đồng bộ từ tab khác' });
        } finally {
            // Reset cờ ở microtask sau, không phải ngay lập tức — để các event
            // handler khác (play/pause/timeupdate) do hành động trên trigger
            // ra không bị hiểu nhầm là hành động CỦA USER và broadcast ngược lại.
            setTimeout(() => { _applyingRemote = false; }, 50);
        }
    }

    let _attachedVideoEl = null;

    function _attachVideoListeners() {
        const v = VideoContext.getVideoEl();
        if (!v || v === _attachedVideoEl) return; // đã attach đúng element này rồi
        _attachedVideoEl = v;
        v.addEventListener('play',  () => _send('play', {}));
        v.addEventListener('pause', () => _send('pause', {}));
        v.addEventListener('seeked', () => _send('seek', { time: v.currentTime }));
        v.addEventListener('ratechange', () => _send('rate', { rate: v.playbackRate }));
    }

    function enable() {
        if (_enabled) return;
        _enabled = true;
        if (typeof BroadcastChannel === 'undefined') {
            warn('[WatchParty] BroadcastChannel không được hỗ trợ trên trình duyệt này');
            return;
        }
        _channel = new BroadcastChannel(CHANNEL_NAME);
        _channel.addEventListener('message', _onMessage);

        _attachVideoListeners();
        // Re-attach mỗi khi video element mới sẵn sàng (SPA nav sang tập khác
        // tạo/thay <video> element — listener cũ đã bị detach cùng element cũ,
        // không tự động chuyển sang element mới nếu không lắng nghe event này).
        EventBus.on('videoReady', _attachVideoListeners);
    }

    function disable() {
        _enabled = false;
        if (_channel) { _channel.close(); _channel = null; }
        _attachedVideoEl = null;
    }

    function isEnabled() { return _enabled; }
    function isSupported() { return typeof BroadcastChannel !== 'undefined'; }

    return { enable, disable, isEnabled, isSupported };
})();
