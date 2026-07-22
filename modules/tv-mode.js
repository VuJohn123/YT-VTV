// tv-mode.js — Layer 2: Điều khiển YouTube trên TV qua Lounge API
//
// CÁCH HOẠT ĐỘNG: YouTube app trên TV/Smart TV/Chromecast dùng 1 API nội bộ
// gọi là "Lounge API" (https://www.youtube.com/api/lounge/...) để nhận lệnh
// điều khiển từ xa — đây chính là cơ chế mà app YouTube trên điện thoại dùng
// khi bạn bấm nút "phát trên TV". Không có SDK/tài liệu chính thức cho web,
// nhưng protocol đã được cộng đồng reverse-engineer và dùng ổn định trong
// nhiều dự án mã nguồn mở qua nhiều năm (ytcast, pyytlounge, youtube-lounge-rs,
// youtube-lounge-api wiki).
//
// ⚠️ RỦI RO THẬT CẦN BIẾT: đây là API KHÔNG CÔNG KHAI, KHÔNG có tài liệu
// chính thức từ Google. Google có thể thay đổi format bất kỳ lúc nào không
// báo trước, khiến tính năng này ngừng hoạt động — khác các API khác trong
// project (SponsorBlock, PeerJS) là dịch vụ ổn định có SLA. Nếu TV Mode đột
// nhiên không hoạt động sau 1 lần update YouTube, đó là do Google đổi API
// nội bộ, không phải bug trong code này.
//
// FLOW:
//   1. User mở YouTube trên TV (Smart TV app, Chromecast, Android TV...),
//      vào Settings → "Liên kết bằng mã TV" để hiện pairing code 12 số.
//   2. User nhập code đó vào TV Mode panel trong userscript.
//   3. Script gọi get_screen để đổi pairing code → loungeToken (xác thực).
//   4. Script "bind" lần đầu kèm metadata thiết bị (app/device/capabilities)
//      — bước này khiến TV hiện "VTV Ultimate đã kết nối" trên màn hình.
//   5. Gửi lệnh (setPlaylist/pause/play/seekTo) qua cùng bind endpoint, mỗi
//      lệnh có 1 "message index" riêng (req0_, req1_, req2_...) độc lập với
//      RID (RID chỉ tăng khi request thành công, message index luôn tăng).
//
// AUTH: mọi request dùng cookie session hiện tại của user trên youtube.com
// (script chạy cùng origin, browser tự đính kèm cookie) — đây là lý do TV
// phải đã đăng nhập CÙNG tài khoản Google với trình duyệt đang chạy script,
// giống hệt yêu cầu của app YouTube thật khi "phát trên TV".

const TvMode = (() => {
    const BASE = 'https://www.youtube.com/api/lounge';

    let _loungeToken = null;
    let _screenId    = null;
    let _screenName  = null;
    let _sid          = null;
    let _gsessionid   = null;
    let _rid           = 1;   // request id — chỉ tăng khi request THÀNH CÔNG
    let _msgIndex        = 0; // message index (req0_, req1_...) — luôn tăng, độc lập với _rid
    let _connected      = false;
    const _deviceId = 'vtv-' + Math.random().toString(36).slice(2, 10);

    function _zx() { return Math.random().toString(36).slice(2, 14); }

    function _gmFetch(url, opts = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: opts.method || 'GET',
                url,
                data: opts.data,
                headers: opts.headers,
                onload: (res) => resolve(res),
                onerror: (err) => reject(err),
                ontimeout: () => reject(new Error('timeout')),
            });
        });
    }

    /**
     * Đổi pairing code (12 số hiện trên màn hình TV) lấy screenId + loungeToken.
     * @param {string} pairingCode
     * @returns {Promise<{screenId:string, name:string}>}
     */
    async function pairWithCode(pairingCode) {
        const code = pairingCode.replace(/\s|-/g, '');
        if (!/^\d{12}$/.test(code)) throw new Error('Mã ghép nối phải gồm 12 chữ số');

        const res = await _gmFetch(`${BASE}/pairing/get_screen?pairing_code=${code}`);
        if (res.status !== 200) throw new Error('Không tìm thấy TV với mã này — kiểm tra lại mã hoặc thử lấy mã mới trên TV');

        let data;
        try { data = JSON.parse(res.responseText); }
        catch (e) { throw new Error('Phản hồi không hợp lệ từ YouTube (API có thể đã thay đổi)'); }

        const screen = data.screen;
        if (!screen?.loungeToken || !screen?.screenId) throw new Error('Thiếu thông tin ghép nối trong phản hồi');

        _loungeToken = screen.loungeToken;
        _screenId    = screen.screenId;
        _screenName  = screen.name || 'TV';
        return { screenId: _screenId, name: _screenName };
    }

    /**
     * Kết nối (bind) tới lounge sau khi đã pairWithCode. Request đầu tiên cần
     * gửi kèm metadata thiết bị (app/device/capabilities) — thiếu phần này
     * là nguyên nhân phổ biến nhất khiến bind "thành công" (HTTP 200) nhưng
     * TV không thực sự hiện thông báo kết nối và không nhận lệnh sau đó.
     */
    async function connect() {
        if (!_loungeToken || !_screenId) throw new Error('Chưa ghép nối với TV — gọi pairWithCode() trước');

        _rid = 1; _msgIndex = 0;

        const bindData = new URLSearchParams({
            'app': 'web',
            'mdx-version': '3',
            'name': 'VTV Ultimate',
            'id': _deviceId,
            'device': 'REMOTE_CONTROL',
            'capabilities': 'que,dsdtr,atp',
            'method': 'setPlaylist',
            'magnaKey': 'cloudPairedDevice',
            'ui': '',
            'deviceContext': 'window_width_points=&window_height_points=&os_name=web&ms=',
            'theme': 'cl',
        }).toString();

        const url = `${BASE}/bc/bind?RID=${_rid}&VER=8&CVER=1&auth_failure_option=send_error&loungeIdToken=${encodeURIComponent(_loungeToken)}&zx=${_zx()}`;
        const res = await _gmFetch(url, { method: 'POST', data: bindData, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        if (res.status !== 200) throw new Error('Không kết nối được tới TV (mã ghép nối có thể đã hết hạn)');

        // Response là dạng "length-prefixed chunks" (mỗi chunk: 1 dòng số =
        // độ dài byte, theo sau là 1 JSON array) — không phải 1 JSON object
        // đơn thuần. Parse best-effort: tìm SID/gsessionid xuất hiện trong
        // TOÀN BỘ text trả về (chúng nằm trong 1 trong các chunk, vị trí
        // chính xác không cố định giữa các version API).
        const text = res.responseText;
        const sidMatch  = text.match(/\["c","([^"]+)"/);
        const gsidMatch = text.match(/"S","([^"]+)"/) || text.match(/gsessionid["\s:]+"([^"]+)"/);

        if (!sidMatch) throw new Error('Không parse được phiên kết nối — API Lounge có thể đã đổi format phản hồi');

        _sid        = sidMatch[1];
        _gsessionid = gsidMatch?.[1] || '';
        _rid++;
        _connected = true;
        log('[TvMode] connected to', _screenName, ', sid:', _sid);
        return true;
    }

    /**
     * Gửi 1 lệnh điều khiển tới TV.
     * @param {string} command tên lệnh Lounge API: 'setPlaylist', 'pause', 'play', 'seekTo', 'next', 'previous'
     * @param {object} extraParams tham số kèm theo (tuỳ lệnh, ví dụ {videoId, currentTime})
     */
    async function sendCommand(command, extraParams = {}) {
        if (!_connected) throw new Error('Chưa kết nối tới TV');

        const idx = _msgIndex++; // message index luôn tăng, độc lập với _rid
        const params = {
            [`req${idx}__sc`]: command,
            ...Object.fromEntries(Object.entries(extraParams).map(([k, v]) => [`req${idx}_${k}`, String(v)])),
            'count': '1',
        };
        const body = new URLSearchParams(params).toString();

        const url = `${BASE}/bc/bind?RID=${_rid}&VER=8&CVER=1&gsessionid=${_gsessionid}&SID=${_sid}&auth_failure_option=send_error&zx=${_zx()}`;
        const res = await _gmFetch(url, { method: 'POST', data: body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        if (res.status === 200) {
            _rid++; // chỉ tăng RID khi request THÀNH CÔNG (đúng theo research)
            return true;
        }
        if (res.status === 400) {
            // "Unknown SID" — phiên hết hạn, TV có thể đã ngắt kết nối. Không
            // tự động reconnect ở đây (caller quyết định retry để tránh vòng
            // lặp lỗi âm thầm), chỉ báo rõ nguyên nhân.
            _connected = false;
            throw new Error('Phiên kết nối với TV đã hết hạn — cần ghép nối lại');
        }
        throw new Error(`Lệnh thất bại (HTTP ${res.status})`);
    }

    /** Phát 1 video cụ thể trên TV, đúng chuẩn episode (dùng videoId đã parse từ URL). */
    function playVideo(videoId, startSeconds = 0) {
        return sendCommand('setPlaylist', {
            videoId, currentTime: startSeconds, currentIndex: -1, listId: '', audioOnly: 'false',
        });
    }
    function pause()  { return sendCommand('pause'); }
    function resume() { return sendCommand('play'); }
    function seekTo(seconds) { return sendCommand('seekTo', { newTime: seconds }); }
    function next()     { return sendCommand('next'); }
    function previous() { return sendCommand('previous'); }

    /** Ngắt kết nối khỏi TV — gửi tín hiệu terminate đàng hoàng thay vì chỉ bỏ mặc phiên. */
    async function disconnect() {
        if (_connected && _sid) {
            try {
                const url = `${BASE}/bc/bind?RID=${_rid}&VER=8&CVER=1&gsessionid=${_gsessionid}&SID=${_sid}&auth_failure_option=send_error&zx=${_zx()}`;
                await _gmFetch(url, {
                    method: 'POST',
                    data: 'ui=&TYPE=terminate&clientDisconnectReason=MDX_SESSION_DISCONNECT_REASON_DISCONNECTED_BY_USER',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                });
            } catch (e) { /* best-effort, không chặn việc dọn state local dù request lỗi */ }
        }
        _connected = false;
        _sid = null; _gsessionid = null; _msgIndex = 0;
    }

    function isConnected() { return _connected; }
    function getScreenId() { return _screenId; }
    function getScreenName() { return _screenName; }

    return {
        pairWithCode, connect, disconnect, isConnected, getScreenId, getScreenName,
        playVideo, pause, resume, seekTo, next, previous, sendCommand,
    };
})();
