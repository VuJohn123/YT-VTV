// watch-party.js — Layer 2: Đồng bộ playback giữa nhiều tab/máy
//
// HAI TẦNG ĐỘC LẬP, có thể bật cùng lúc:
//
// 1. LOCAL (BroadcastChannel) — đồng bộ giữa các TAB CÙNG MÁY, cùng trình
//    duyệt. Không cần server, độ trễ gần như 0, luôn hoạt động. Đây là tầng
//    gốc đã có từ trước.
//
// 2. REMOTE (PeerJS/WebRTC) — đồng bộ giữa NHIỀU MÁY cùng mạng LAN hoặc khác
//    mạng qua internet. Đây là P2P THẬT (WebRTC data channel), không phải giả
//    lập — dữ liệu truyền thẳng giữa 2 trình duyệt sau khi thiết lập kết nối,
//    không đi qua server nào để relay data.
//
//    Vẫn cần 1 "signaling server" chỉ để 2 peer TÌM THẤY NHAU lúc đầu (trao
//    đổi SDP offer/answer) — không có cách nào tự discover peer trên mạng chỉ
//    bằng JS trình duyệt (giới hạn bảo mật cố ý của web platform, không phải
//    hạn chế của code này). Dùng PeerJS Cloud (0.peerjs.com) — server miễn phí
//    công khai do nhóm PeerJS vận hành, chỉ dùng để broker kết nối ban đầu.
//
//    GIỚI HẠN THẬT CẦN BIẾT: nếu cả 2 máy đều sau NAT đối xứng nghiêm ngặt
//    (một số mạng doanh nghiệp/di động), kết nối P2P trực tiếp có thể thất
//    bại vì không có TURN server relay đi kèm (TURN server miễn phí đáng tin
//    cậy không tồn tại — mọi TURN server free đều rất giới hạn băng thông).
//    Với 2 máy CÙNG MẠNG LAN (đúng use-case bạn cần), tỷ lệ thành công rất
//    cao vì cùng router/NAT.

const WatchParty = (() => {
    const THROTTLE_MS = 400; // tránh spam broadcast mỗi frame khi seek kéo thanh trượt
    const _instanceId = Math.random().toString(36).slice(2);

    let _enabled       = false;
    let _applyingRemote = false;
    let _lastBroadcastAt = 0;
    let _attachedVideoEl = null;
    // Mặc định KHÔNG tự chuyển tập theo nhau (an toàn hơn — mỗi tab/máy độc
    // lập chọn video riêng). User phải chủ động bật setFollowNav(true) mới
    // có hành vi "1 tab chuyển tập, các tab khác trong phòng tự chuyển theo".
    let _followNav      = false;

    function _currentVideoId() { return new URLSearchParams(location.search).get('v') || ''; }

    // ─── Local tier (BroadcastChannel, cùng máy) ───────────────────────────
    const CHANNEL_NAME = 'vtv-ultimate-watch-party';
    let _localChannel = null;
    let _localEnabled  = false;

    function _localSend(msg) {
        if (!_localChannel) return;
        try { _localChannel.postMessage(msg); } catch (e) { warn('[WatchParty] local send lỗi:', e); }
    }

    function enableLocal() {
        if (_localEnabled) return;
        if (typeof BroadcastChannel === 'undefined') {
            warn('[WatchParty] BroadcastChannel không được hỗ trợ trên trình duyệt này');
            return;
        }
        _localEnabled = true;
        _localChannel = new BroadcastChannel(CHANNEL_NAME);
        _localChannel.addEventListener('message', (evt) => _handleIncoming(evt.data));
        log('[WatchParty] local tier (cùng máy) enabled');
    }

    function disableLocal() {
        _localEnabled = false;
        if (_localChannel) { _localChannel.close(); _localChannel = null; }
    }

    // ─── Remote tier (PeerJS/WebRTC, nhiều máy) ────────────────────────────
    let _peer = null;
    let _connections = new Map(); // peerId → DataConnection
    let _roomId = null;
    let _isHost = false;

    function _remoteBroadcast(msg) {
        for (const conn of _connections.values()) {
            if (conn.open) { try { conn.send(msg); } catch (e) { /* peer có thể vừa disconnect */ } }
        }
    }

    function _wireConnection(conn) {
        conn.on('data', (data) => _handleIncoming(data));
        conn.on('close', () => {
            _connections.delete(conn.peer);
            EventBus.emit('voiceLabel', { text: '🔗 1 người rời phòng' });
        });
        conn.on('error', (e) => warn('[WatchParty] connection error:', e));
        _connections.set(conn.peer, conn);
    }

    /**
     * Tạo phòng mới (host). Trả về room code ngắn để chia sẻ cho người khác.
     * @returns {Promise<string>} room code (6 ký tự, dễ đọc/gõ qua điện thoại/lời nói)
     */
    function createRoom() {
        return new Promise((resolve, reject) => {
            if (typeof Peer === 'undefined') {
                reject(new Error('PeerJS chưa load được — kiểm tra kết nối mạng'));
                return;
            }
            // Room code ngắn, dễ đọc: loại bỏ ký tự dễ nhầm (0/O, 1/I/l)
            const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];

            _peer = new Peer('vtv-' + code, { host: '0.peerjs.com', port: 443, path: '/', secure: true });
            _peer.on('open', () => {
                _isHost = true;
                _roomId = code;
                log('[WatchParty] phòng đã tạo:', code);
                resolve(code);
            });
            _peer.on('connection', (conn) => {
                _wireConnection(conn);
                EventBus.emit('voiceLabel', { text: '🔗 Có người vào phòng' });
            });
            _peer.on('error', (e) => {
                warn('[WatchParty] peer error:', e);
                if (e.type === 'unavailable-id') reject(new Error('Mã phòng bị trùng, thử lại'));
                else reject(e);
            });
        });
    }

    /**
     * Vào phòng đã có bằng room code.
     * @param {string} code
     * @returns {Promise<void>}
     */
    function joinRoom(code) {
        return new Promise((resolve, reject) => {
            if (typeof Peer === 'undefined') {
                reject(new Error('PeerJS chưa load được — kiểm tra kết nối mạng'));
                return;
            }
            const myId = 'vtv-guest-' + Math.random().toString(36).slice(2, 8);
            _peer = new Peer(myId, { host: '0.peerjs.com', port: 443, path: '/', secure: true });
            _peer.on('open', () => {
                const conn = _peer.connect('vtv-' + code.toUpperCase());
                conn.on('open', () => {
                    _isHost = false;
                    _roomId = code.toUpperCase();
                    _wireConnection(conn);
                    log('[WatchParty] đã vào phòng:', code);
                    resolve();
                });
                conn.on('error', (e) => reject(e));
                // Timeout: nếu không mở được kết nối trong 8s, coi như phòng
                // không tồn tại hoặc host đã rời — báo lỗi rõ ràng thay vì
                // treo vô thời hạn không phản hồi gì cho user.
                setTimeout(() => { if (!conn.open) reject(new Error('Không kết nối được — kiểm tra lại mã phòng')); }, 8000);
            });
            _peer.on('error', (e) => reject(e));
        });
    }

    function leaveRoom() {
        for (const conn of _connections.values()) { try { conn.close(); } catch (e) {} }
        _connections.clear();
        if (_peer) { try { _peer.destroy(); } catch (e) {} _peer = null; }
        _roomId = null;
        _isHost = false;
    }

    function getRoomInfo() {
        return { roomId: _roomId, isHost: _isHost, peerCount: _connections.size };
    }

    // ─── Shared sync logic (dùng chung cho cả 2 tầng) ──────────────────────
    function _broadcastAll(type, payload) {
        if (_applyingRemote) return; // không echo lại hành động vừa nhận từ nơi khác
        const now = Date.now();
        if (type === 'seek' && now - _lastBroadcastAt < THROTTLE_MS) return;
        _lastBroadcastAt = now;

        const msg = { type, payload, videoId: _currentVideoId(), from: _instanceId, ts: now };
        _localSend(msg);
        _remoteBroadcast(msg);
    }

    function _handleIncoming(msg) {
        const { type, payload, videoId, from } = msg || {};
        if (!type || from === _instanceId) return; // tự gửi tự nhận

        // 'nav' là loại message DUY NHẤT không cần videoId khớp trước — chính
        // nó dùng để đồng bộ videoId giữa các tab/máy (đây là câu trả lời cho
        // "sync tab kéo nhau kiểu gì": khi 1 tab chuyển tập, nó broadcast 'nav'
        // kèm URL đích, các tab khác trong phòng tự Navigator.goTo() theo).
        if (type === 'nav') {
            if (!payload?.url || !_followNav) return; // chỉ tự chuyển nếu user đã bật tuỳ chọn "theo nhau"
            _applyingRemote = true;
            Navigator.goTo(payload.url);
            setTimeout(() => { _applyingRemote = false; }, 500); // navigation cần nhiều thời gian hơn play/pause/seek để hoàn tất
            return;
        }

        if (videoId !== _currentVideoId()) return; // phía kia đang xem video khác, không đồng bộ nhầm

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
            EventBus.emit('voiceLabel', { text: '🔗 Đồng bộ' });
        } finally {
            // Reset cờ ở microtask sau, không phải ngay lập tức — để các event
            // handler khác (play/pause/timeupdate) do hành động trên trigger
            // ra không bị hiểu nhầm là hành động CỦA USER và broadcast ngược lại.
            setTimeout(() => { _applyingRemote = false; }, 50);
        }
    }

    function _attachVideoListeners() {
        // Listener này giờ đăng ký VĨNH VIỄN ở module-scope (xem comment ở
        // enable() bên dưới) nên fire cả khi WatchParty chưa từng được bật —
        // phải tự gác cổng bằng _enabled, nếu không sẽ gắn native DOM
        // listener (play/pause/seeked/ratechange) lên MỌI video kể cả khi
        // tính năng đang tắt hẳn (lãng phí, dù vô hại vì kênh broadcast rỗng).
        if (!_enabled) return;
        const v = VideoContext.getVideoEl();
        if (!v || v === _attachedVideoEl) return; // đã attach đúng element này rồi
        _attachedVideoEl = v;
        v.addEventListener('play',  () => _broadcastAll('play', {}));
        v.addEventListener('pause', () => _broadcastAll('pause', {}));
        v.addEventListener('seeked', () => _broadcastAll('seek', { time: v.currentTime }));
        v.addEventListener('ratechange', () => _broadcastAll('rate', { rate: v.playbackRate }));
    }

    // Broadcast 'nav' mỗi khi video mới sẵn sàng — đây là tín hiệu cho các
    // tab/máy khác trong phòng biết URL đích để tự chuyển theo (nếu họ đã
    // bật _followNav). Không broadcast khi _applyingRemote=true — tránh vòng
    // lặp (chính navigation này là do NHẬN lệnh nav từ nơi khác, không phải
    // do user tự chuyển tập). Không broadcast khi !_enabled — hàm này được
    // đăng ký 1 LẦN DUY NHẤT ở module-scope (xem cuối enable() bên dưới) nên
    // vẫn tồn tại kể cả sau khi disable(), phải tự gác cổng bằng _enabled.
    function _broadcastNav() {
        if (!_enabled || _applyingRemote) return;
        const msg = { type: 'nav', payload: { url: location.href }, from: _instanceId, ts: Date.now() };
        _localSend(msg);
        _remoteBroadcast(msg);
    }

    // ─── Public API ─────────────────────────────────────────────────────────
    // BUG ĐÃ SỬA ("1 phát ba cái"): trước đây EventBus.on('videoReady', ...)
    // được gọi BÊN TRONG enable() — mỗi lần user bật lại WatchParty (sau khi
    // đã tắt), 1 listener MỚI được đăng ký chồng lên listener(s) cũ (EventBus
    // không tự huỷ khi disable() chạy, và disable() vốn cũng không gọi
    // EventBus.off()). Bật/tắt N lần → N listener trùng nhau cùng tồn tại →
    // 1 lần videoReady thật sự (chuyển tập) làm broadcast 'nav' bắn ra N lần
    // liên tiếp cho cùng 1 URL, khiến tab/máy khác trong phòng tự
    // Navigator.goTo() N lần dồn dập. Sửa: đăng ký listener đúng 1 LẦN DUY
    // NHẤT ở module-scope (chạy khi file được require, giống hệt cách
    // video-context.js/entry.js wire EventBus 1 lần ở top-level), enable()/
    // disable() chỉ còn bật/tắt cờ _enabled — mọi handler tự gác cổng bằng
    // cờ này thay vì được thêm/xoá theo vòng đời bật-tắt.
    EventBus.on('videoReady', _attachVideoListeners);
    EventBus.on('videoReady', _broadcastNav);

    function enable() {
        if (_enabled) return;
        _enabled = true;
        enableLocal();
        _attachVideoListeners();
    }

    function disable() {
        _enabled = false;
        disableLocal();
        leaveRoom();
        _attachedVideoEl = null;
    }

    /**
     * Bật/tắt hành vi "tự chuyển tập theo nhau" — mặc định TẮT (an toàn).
     * Khi bật, mỗi lần 1 tab/máy trong phòng chuyển sang video khác, mọi
     * tab/máy khác trong phòng đã bật followNav sẽ tự Navigator.goTo() theo.
     */
    function setFollowNav(value) { _followNav = !!value; }
    function getFollowNav() { return _followNav; }

    function isEnabled() { return _enabled; }
    function isLocalSupported()  { return typeof BroadcastChannel !== 'undefined'; }
    function isRemoteSupported() { return typeof Peer !== 'undefined' && typeof RTCPeerConnection !== 'undefined'; }

    return {
        enable, disable, isEnabled,
        setFollowNav, getFollowNav,
        isLocalSupported, isRemoteSupported,
        createRoom, joinRoom, leaveRoom, getRoomInfo,
    };
})();
