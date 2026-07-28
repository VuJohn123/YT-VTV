// features.js — Layer 3: Feature modules (event-driven, self-contained)
// Mỗi feature register listeners trên EventBus và manage lifecycle của riêng mình.
// Không giữ cross-feature references.

// ─────────────────────────────────────────────────────────────────────────────
// ADBLOCK
// ─────────────────────────────────────────────────────────────────────────────
const AdBlock = (() => {
    let _observer   = null;
    let _interval   = null;

    const AD_SELECTORS = [
        'ytd-display-ad-renderer', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer',
        'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer',
        'ytd-banner-promo-renderer', 'ytd-statement-banner-renderer',
        '.ytp-ad-overlay-container', '.ytp-ad-player-overlay', '.video-ads',
        '#player-ads', '#masthead-ad', '#offer-module', '#premium-offer',
        '.ytd-rich-item-renderer-promo', 'ytd-merch-shelf-renderer',
        'ytd-action-companion-ad-renderer',
        'iframe[src*="doubleclick"]', 'iframe[src*="googleads"]', 'iframe[src*="adservice"]',
    ].join(',');

    function _hideAds() {
        document.querySelectorAll(AD_SELECTORS).forEach(el => { el.style.display = 'none'; });
    }

    function _skipAdButtons() {
        const skips = ['.ytp-skip-ad-button', 'button[aria-label*="Skip"]', 'button[aria-label*="Bỏ qua"]'];
        for (const sel of skips) {
            const btn = document.querySelector(sel);
            if (btn?.offsetParent !== null) { btn.click(); break; }
        }
        const vp = document.querySelector('ytd-player');
        if (vp?.shadowRoot) {
            const sb = vp.shadowRoot.querySelector('.ytp-skip-ad-button');
            if (sb?.offsetParent !== null) sb.click();
        }
    }

    function start() {
        if (_observer) return;
        log('[AdBlock] start');
        _interval = setInterval(() => {
            try {
                _skipAdButtons();
                // Fast-forward short ad videos
                const v = VideoContext.getVideoEl();
                if (v?.duration > 0 && v.duration < AD_MAX_DURATION) {
                    EventBus.emit('adDetected', { detected: true });
                    PlayerControl.seekTo(v.duration - 0.1);
                } else {
                    EventBus.emit('adDetected', { detected: false });
                }
            } catch (e) {}
        }, 2000);
        _observer = new MutationObserver(_hideAds);
        _observer.observe(document.body, { childList: true, subtree: true });
        _hideAds();
    }

    function stop() {
        if (_interval) { clearInterval(_interval); _interval = null; }
        if (_observer) { _observer.disconnect(); _observer = null; }
    }

    // Marathon mode toggle drives adblock
    EventBus.on('modeChange', ({ key, value }) => {
        if (key !== 'marathon') return;
        if (value) { document.body.classList.add('vtv-marathon'); start(); }
        else        { document.body.classList.remove('vtv-marathon'); stop(); }
    });

    return { start, stop };
})();


// ─────────────────────────────────────────────────────────────────────────────
// AUDIO MODE
// Quality control via internal movie_player API (no UI interaction needed).
// Restore path: saves quality label string → restores exact same label.
// ─────────────────────────────────────────────────────────────────────────────
const AudioMode = (() => {
    let _overlay     = null;
    let _prevQuality = null;   // e.g. 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'
    let _active      = false;
    let _styleTag    = null;

    // ── Overlay ────────────────────────────────────────────────────────────
    function _initOverlay() {
        if (_overlay) return;
        _overlay = document.createElement('div');
        _overlay.id = 'vtv-audio-overlay';
        Object.assign(_overlay.style, {
            position: 'absolute', inset: '0',
            background: '#000', zIndex: '100',
            display: 'none', pointerEvents: 'none',
        });
        const player = document.querySelector('#movie_player, .html5-video-player');
        if (player) {
            if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
            player.appendChild(_overlay);
        } else {
            setTimeout(_initOverlay, 800);
        }
    }

    // "TRULY" audio mode — tiết kiệm tài nguyên THẬT SỰ, không chỉ ẩn bằng
    // opacity. GIỚI HẠN THẬT CẦN BIẾT: trình duyệt KHÔNG có API chuẩn nào để
    // tắt hẳn việc decode video track khi <video> vẫn đang play — đây là giới
    // hạn cứng của HTML5 media pipeline (network requests cho video segments
    // trong adaptive streaming HLS/DASH vẫn xảy ra, JS không override được).
    // Những gì làm được và ĐÃ áp dụng ở đây:
    //   1. visibility:hidden + kích thước 1x1px thay vì chỉ opacity:0 — Chrome
    //      compositor thực sự loại bỏ video khỏi paint/composite layer khi ẩn
    //      đúng cách này, tiết kiệm GPU đáng kể so với chỉ set opacity (vẫn
    //      giữ nguyên compositing layer dù không nhìn thấy).
    //   2. Quality thấp nhất — giảm bitrate video track cần decode/tải, dù
    //      không tắt hẳn (xem PlayerControl.getLowestQuality()).
    //   3. Tắt CSS animation/transition toàn trang qua injected <style> — một
    //      số theme/overlay của YouTube có animation chạy nền tốn CPU dù
    //      không liên quan trực tiếp tới video.
    function _injectPerfCSS() {
        if (_styleTag) return;
        _styleTag = document.createElement('style');
        _styleTag.id = 'vtv-audio-mode-perf-css';
        _styleTag.textContent = `
            /* Tắt mọi animation/transition khi Audio Mode bật — giảm CPU cho
               việc paint lại các hiệu ứng không cần thiết khi không xem hình. */
            ytd-app *, ytd-app *::before, ytd-app *::after {
                animation-play-state: paused !important;
                transition: none !important;
            }
            /* Class do CHÍNH SCRIPT gán trực tiếp lên element mà
               VideoContext.getVideoEl() trả về (nguồn đáng tin cậy duy nhất
               — không đoán selector nội bộ của YouTube, có thể sai hoặc đổi
               giữa các version). !important vì YouTube's internal player có
               thể tự resize <video> qua ResizeObserver khi container đổi kích
               thước (fullscreen toggle, resize window...), có thể ghi đè lại
               inline style nếu không dùng !important. */
            video.vtv-audio-mode-hidden {
                visibility: hidden !important;
                width: 1px !important;
                height: 1px !important;
            }
        `;
        document.head.appendChild(_styleTag);
    }
    function _removePerfCSS() {
        if (_styleTag) { _styleTag.remove(); _styleTag = null; }
    }

    function _applyHiddenClass() {
        const v = VideoContext.getVideoEl();
        if (v && _active) v.classList.add('vtv-audio-mode-hidden');
    }

    function enable() {
        if (_active) return;
        _active = true;
        Storage.saveFlag('audioMode', true);

        // Save current quality before lowering — dùng PlayerControl thay vì tự
        // viết lại logic get/set quality (xem player-control.js).
        const cur = PlayerControl.getQuality();
        if (cur && cur !== 'tiny' && cur !== 'small') _prevQuality = cur;

        const lowest = PlayerControl.getLowestQuality();
        PlayerControl.setQuality(lowest);

        _initOverlay();
        if (_overlay) _overlay.style.display = 'block';

        _injectPerfCSS();
        _applyHiddenClass();
        // Video element có thể đổi khi chuyển tập (SPA nav) — re-apply class
        // ẩn cho element MỚI mỗi lần videoReady fire, tương tự pattern đã
        // dùng ở WatchParty/BufferMonitor cho cùng vấn đề.
        EventBus.on('videoReady', _applyHiddenClass);

        log('[AudioMode] TRULY enabled — quality:', lowest, ', video compositing thực sự bị loại bỏ (không chỉ opacity:0)');
    }

    function disable() {
        if (!_active) return;
        _active = false;
        Storage.saveFlag('audioMode', false);

        // Restore quality — if no saved quality, fallback to 'auto'
        const restoreTo = _prevQuality ?? 'auto';
        const ok = PlayerControl.setQuality(restoreTo);

        // If setQuality failed or player not ready yet, retry once after 1s
        if (!ok) {
            setTimeout(() => PlayerControl.setQuality(restoreTo), 1000);
        }
        _prevQuality = null;

        if (_overlay) _overlay.style.display = 'none';

        // Xoá class ẩn khỏi video HIỆN TẠI (nếu còn tồn tại — có thể null
        // nếu đang giữa 2 lần chuyển tập).
        const v = VideoContext.getVideoEl();
        if (v) v.classList.remove('vtv-audio-mode-hidden');

        _removePerfCSS();

        log('[AudioMode] disabled, restored quality to:', restoreTo);
    }

    EventBus.on('audioModeEnable',  enable);
    EventBus.on('audioModeDisable', disable);
    // Re-apply on navigation (quality resets on new video)
    EventBus.on('videoReady', () => { if (_active) { setTimeout(() => PlayerControl.setQuality(PlayerControl.getLowestQuality()), 800); } });

    return { enable, disable, isActive: () => _active };
})();

// ─────────────────────────────────────────────────────────────────────────────
// AUTO PiP
// ─────────────────────────────────────────────────────────────────────────────
const AutoPiP = (() => {
    let _enabled  = false;
    let _active   = false;
    let _interval = null;
    let _attachedVideoEl = null;

    async function _check() {
        const v = VideoContext.getVideoEl();
        if (!v || !_enabled) return;
        if (document.hidden && !v.paused && !document.pictureInPictureElement) {
            await PlayerControl.enterPiP(); // _active được set qua event 'enterpictureinpicture', không set thủ công ở đây nữa
        } else if (!document.hidden && _active && document.pictureInPictureElement) {
            await PlayerControl.exitPiP(); // _active được clear qua event 'leavepictureinpicture'
        }
    }

    /**
     * Lắng nghe enterpictureinpicture/leavepictureinpicture TRỰC TIẾP trên
     * <video> element — theo đúng khuyến nghị chính thức của MDN để track
     * trạng thái PiP chính xác, thay vì chỉ dựa vào polling interval. Quan
     * trọng nhất: bắt được trường hợp user TỰ đóng PiP window bằng nút X
     * (không qua code của script) — trước đây _active sẽ bị KẸT ở true dù
     * PiP thực tế đã đóng, khiến lần _check() tiếp theo hiểu sai trạng thái.
     */
    function _attachPipEvents() {
        const v = VideoContext.getVideoEl();
        if (!v || v === _attachedVideoEl) return;
        _attachedVideoEl = v;
        v.addEventListener('enterpictureinpicture', () => { _active = true; });
        v.addEventListener('leavepictureinpicture', () => { _active = false; });
    }

    function enable() {
        if (_enabled) return;
        _enabled = true;
        Storage.saveFlag('pip', true);
        document.addEventListener('visibilitychange', _check);
        _interval = setInterval(_check, 2000);
        _attachPipEvents();
        // Re-attach khi video element mới sẵn sàng (SPA nav sang tập khác).
        EventBus.on('videoReady', _attachPipEvents);
        log('[AutoPiP] enabled (event-driven, PIP chuẩn theo khuyến nghị MDN)');
    }

    function disable() {
        if (!_enabled) return;
        _enabled = false;
        Storage.saveFlag('pip', false);
        document.removeEventListener('visibilitychange', _check);
        if (_interval) { clearInterval(_interval); _interval = null; }
        if (_active && document.pictureInPictureElement) {
            PlayerControl.exitPiP();
            _active = false;
        }
        log('[AutoPiP] disabled');
    }

    EventBus.on('pipEnable',  enable);
    EventBus.on('pipDisable', disable);

    return { enable, disable };
})();


// ─────────────────────────────────────────────────────────────────────────────
// NETWORK OPTIMIZER
// ─────────────────────────────────────────────────────────────────────────────
const NetworkOptimizer = (() => {
    let _listenerAdded = false;

    function _onConnectionChange() {
        const conn = navigator.connection;
        if (!conn) return;
        log('[NetOpt] type:', conn.effectiveType, 'downlink:', conn.downlink);
        if ((conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') && !AudioMode.isActive()) {
            log('[NetOpt] poor network → audio mode');
            AudioMode.enable();
        }
    }

    function optimize() {
        const v = VideoContext.getVideoEl();
        if (!v) return;
        v.preload = 'auto';
        if (navigator.connection && !_listenerAdded) {
            navigator.connection.addEventListener('change', _onConnectionChange);
            _listenerAdded = true;
            _onConnectionChange();
        }
    }

    // Run 2 seconds after episode is found
    EventBus.on('episodeFound', () => setTimeout(optimize, 2000));

    return { optimize };
})();


// ─────────────────────────────────────────────────────────────────────────────
// VOICE CONTROL
// ─────────────────────────────────────────────────────────────────────────────
const VoiceControl = (() => {
    const PT_KEY = 'v';
    let _sr           = null;
    let _enabled      = false;
    let _recording    = false;
    let _stopping     = false;
    let _pendingStart = false;
    let _initialized  = false;

    // Globals shared with navigation (set via events)
    let _nextUrl = null;
    let _prevUrl = null;

    EventBus.on('nextFound', ({ url }) => { _nextUrl = url; });
    EventBus.on('prevFound', ({ url }) => { _prevUrl = url; });

    function _destroy() {
        if (_sr) {
            _sr.onresult = null; _sr.onerror = null; _sr.onend = null;
            try { _sr.abort(); } catch (e) {}
            _sr = null;
        }
        _recording = _stopping = _pendingStart = _initialized = false;
    }

    function _init() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { warn('[Voice] Web Speech API not supported'); return; }
        _destroy();
        _sr = new SR();
        _sr.lang            = 'vi-VN';
        _sr.continuous      = false;
        _sr.interimResults  = false;
        _sr.maxAlternatives = 3; // thử nhiều lựa chọn nhận diện thay vì chỉ 1 — giảm tỷ lệ unrecognized khi audio bị nhiễu (mic bắt lẫn tiếng phim)
        _initialized = true;

        _sr.onresult = (e) => {
            if (!_recording) return;

            // Gom TẤT CẢ alternatives của mỗi kết quả final, không chỉ [0]
            // (alternative có độ tin cậy cao nhất theo Speech API, nhưng khi
            // audio bị nhiễu — ví dụ tiếng phim lẫn vào mic — alternative đầu
            // đôi khi sai còn alternative thứ 2-3 lại đúng ý user).
            const alternatives = [];
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (!e.results[i].isFinal) continue;
                for (let j = 0; j < e.results[i].length; j++) {
                    alternatives.push(e.results[i][j].transcript);
                }
            }
            if (!alternatives.length) return;

            const primary = alternatives[0].toLowerCase().trim();
            if (!primary || primary.length >= 80) return;

            log('[Voice] command:', primary, alternatives.length > 1 ? `(+${alternatives.length - 1} alt)` : '');
            EventBus.emit('voiceLabel', { text: primary });
            _processCommand(primary, alternatives.slice(1));
            setTimeout(() => EventBus.emit('voiceLabel', { text: '' }), 1500);
        };
        _sr.onerror = (e) => {
            _stopping = false;
            if (e.error === 'aborted' || e.error === 'no-speech') {
                _recording = false;
                _unduckAudio(); // khôi phục volume trước khi (có thể) retry, tránh duck chồng lấn
                if (_pendingStart && _enabled) { _pendingStart = false; _startRecording(); }
                return;
            }
            warn('[Voice] error:', e.error);
            EventBus.emit('voiceLabel', { text: 'Lỗi: ' + e.error });
            _recording = false;
            _unduckAudio(); // lỗi khác cũng phải khôi phục volume — trước đây thiếu bước này khiến volume kẹt ở mức đã duck vĩnh viễn nếu lỗi xảy ra
        };
        _sr.onend = () => {
            _recording = _stopping = false;
            _unduckAudio();
            EventBus.emit('voiceLabel', { text: '' });
            if (_pendingStart && _enabled) { _pendingStart = false; _startRecording(); }
        };
    }

    let _duckedVolume = null; // volume gốc trước khi duck, để khôi phục đúng

    /**
     * Audio ducking: giảm tạm âm lượng video trong lúc ghi âm lệnh, tránh mic
     * bắt nhầm tiếng thoại/nhạc phim phát ra từ loa lẫn vào giọng user (đặc
     * biệt khi không dùng tai nghe). Không mute hẳn (0%) vì mute có thể kích
     * hoạt logic khác không mong muốn (ví dụ UI hiển thị icon loa tắt tiếng)
     * — chỉ hạ xuống mức rất nhỏ đủ để giảm nhiễu mà vẫn nghe lờ mờ được.
     */
    function _duckAudio() {
        const vol = PlayerControl.getVolume();
        if (vol > 0.08) { // chỉ duck nếu volume hiện tại đủ lớn để gây nhiễu thật
            _duckedVolume = vol;
            PlayerControl.setVolume(0.05);
        }
    }
    function _unduckAudio() {
        if (_duckedVolume !== null) {
            PlayerControl.setVolume(_duckedVolume);
            _duckedVolume = null;
        }
    }

    function _startRecording() {
        if (!_enabled || _recording) return;
        if (_stopping) { _pendingStart = true; return; }
        if (!_sr || !_initialized) _init();
        if (!_sr) return;
        _recording = true;
        _duckAudio();
        try {
            _sr.start();
            EventBus.emit('voiceLabel', { text: '🎤 Đang nghe...' });
        } catch (e) {
            _recording = false;
            _unduckAudio();
            _init();
            if (_sr) { try { _sr.start(); _recording = true; _duckAudio(); } catch (e2) { warn('[Voice] start failed:', e2); } }
        }
    }

    function _stopRecording() {
        _pendingStart = false;
        if (!_recording) return;
        _recording = false; _stopping = true;
        _unduckAudio();
        try { _sr?.abort(); } catch (e) { _stopping = false; }
        EventBus.emit('voiceLabel', { text: '' });
    }

    /**
     * Tạo regex với "word boundary" nhận diện ĐÚNG ký tự tiếng Việt có dấu.
     * JavaScript's \b chỉ coi [A-Za-z0-9_] là "word character" — mọi ký tự
     * tiếng Việt có dấu (đ, ê, ô, õ, rõ, dừng...) bị \w BỎ SÓT, khiến \b đặt
     * sai vị trí biên và regex fail khi từ khoá bắt đầu/kết thúc bằng ký tự
     * có dấu. Đây là bug thật đã xác nhận qua test: /\b(đứng lại)\b/.test('đứng
     * lại nhé') trả về false SAI (phải true) trước khi có hàm này.
     * Dùng \p{L}\p{N} (Unicode property escape, flag 'u') thay cho \w để
     * nhận diện đúng MỌI chữ cái/số bất kể ngôn ngữ.
     * @param {string} pattern - phần bên trong (...) của regex, ví dụ 'dừng|tạm dừng|pause'
     * @returns {RegExp}
     */
    function _re(pattern) {
        return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu');
    }

    function _processCommand(raw, fallbackAlternatives = []) {
        // Normalize: lowercase, chuẩn hoá số thập phân kiểu VN (1,5 → 1.5)
        // TRƯỚC khi xoá dấu câu, rồi mới xoá phần còn lại. Thứ tự này quan
        // trọng: xoá dấu phẩy trước khi xử lý sẽ biến "1,5" thành "15" (sai
        // hoàn toàn giá trị số) — bug thật đã xảy ra với lệnh "tốc độ phát
        // lên 1,5" bị hiểu thành 15x thay vì 1.5x.
        const t = raw.toLowerCase()
            .replace(/(\d),(\d)/g, '$1.$2')      // "1,5" → "1.5" (số thập phân VN)
            .replace(/[.,?!;:'"…]/g, (m, offset, str) => {
                // Giữ lại dấu chấm nếu nó đang nằm GIỮA 2 chữ số (số thập phân
                // đã chuẩn hoá ở bước trên), chỉ xoá dấu câu thật sự (cuối câu,
                // liệt kê...).
                const before = str[offset - 1], after = str[offset + 1];
                if (m === '.' && /\d/.test(before) && /\d/.test(after)) return m;
                return '';
            })
            .replace(/\s+/g, ' ')
            .trim();

        const v   = VideoContext.getVideoEl();
        const dur = v?.duration ?? 0;

        // ── Helpers ──────────────────────────────────────────────────────
        // Dùng PlayerControl (internal function layer dùng chung) thay vì tự
        // thao tác trực tiếp lên <video> — đảm bảo clamp/snap nhất quán với
        // Keyboard shortcuts và UI panel, và tự đồng bộ UI Settings menu của
        // YouTube khi có thể (xem player-control.js).
        const _seek   = (s) => PlayerControl.seekTo(s);
        const _vol    = (n) => PlayerControl.setVolume(n);
        const _rate   = (r) => PlayerControl.setRate(r);
        const _notify = (msg) => EventBus.emit('voiceLabel', { text: '✓ ' + msg });

        // Parse time expression: "5 phút 30 giây" / "5:30" / "phút 5" / "30 giây" / "5p30"
        function _parseTime(s) {
            let m;
            if ((m = s.match(/(\d+)\s*phút\s*(\d+)/)))       return +m[1]*60 + +m[2];
            if ((m = s.match(/(\d+)\s*:\s*(\d+)/)))           return +m[1]*60 + +m[2];
            if ((m = s.match(/(\d+)\s*p\s*(\d+)/)))           return +m[1]*60 + +m[2];
            if ((m = s.match(/phút\s*(\d+)/)))                return +m[1]*60;
            if ((m = s.match(/(\d+)\s*phút/)))                return +m[1]*60;
            if ((m = s.match(/(\d+)\s*giây/)))                return +m[1];
            if ((m = s.match(/(\d+)/)))                       return +m[1];
            return null;
        }

        // Parse amount with unit: "30 giây" → 30, "2 phút" → 120, bare "45" → 45
        function _parseAmount(s, defSec = 30) {
            let m;
            if ((m = s.match(/(\d+)\s*phút/)))  return +m[1] * 60;
            if ((m = s.match(/(\d+)\s*giây/)))  return +m[1];
            if ((m = s.match(/(\d+)/)))          return +m[1];
            return defSec;
        }

        // ── 1. NAVIGATION ────────────────────────────────────────────────
        if (_re('tiếp theo|tập sau|tập kế|xem tiếp|chuyển tiếp|next').test(t)) {
            if (_nextUrl) { _notify('Chuyển tập tiếp theo'); Navigator.goTo(_nextUrl); }
            else _notify('Không tìm thấy tập tiếp theo');
            return;
        }
        if (_re('quay lại|tập trước|back|trước đó|quay về').test(t)) {
            if (_prevUrl) { _notify('Quay lại tập trước'); Navigator.goTo(_prevUrl); }
            else _notify('Không có tập trước');
            return;
        }
        if (_re('tải lại|reload|làm mới').test(t)) { _notify('Tải lại trang'); location.reload(); return; }

        // ── 2. SEEK — absolute ────────────────────────────────────────────
        if (_re('tua đến|đến phút|tới phút|nhảy đến|đến giây|tua tới').test(t)) {
            const sec = _parseTime(t);
            if (sec !== null) { _seek(sec); _notify(`Tua đến ${sec}s`); }
            return;
        }
        // "bắt đầu", "đầu phim", "từ đầu"
        if (_re('từ đầu|đầu phim|bắt đầu lại|quay đầu').test(t)) { _seek(0); _notify('Về đầu'); return; }
        // "cuối phim", "cuối video"
        if (_re('cuối phim|cuối video|kết thúc|tới cuối').test(t)) { _seek(dur - 3); _notify('Tới cuối'); return; }
        // "giữa phim"
        if (_re('giữa phim|giữa video').test(t)) { _seek(dur / 2); _notify('Đến giữa'); return; }

        // ── 3. SEEK — relative forward ────────────────────────────────────
        // Bug đã sửa: "tua 10 phút" không khớp pattern cũ (chỉ có "tua nhanh/
        // tua thêm", không có "tua" trần) → lệnh bị rơi qua không xử lý. Thêm
        // "tua" trần vào đây, NHƯNG loại trừ "tua lại/tua lùi" (thuộc mục 4 —
        // lùi) bằng negative lookahead ngay trong cụm từ để tránh nuốt nhầm
        // lệnh lùi khi 2 khối được test theo thứ tự forward trước.
        if (_re('tua nhanh|tua thêm|bỏ qua|skip|tiến lên|nhảy qua').test(t) ||
            (_re('tua').test(t) && !/tua\s*(lại|lùi)/.test(t))) {
            // Nếu transcript hiện tại KHÔNG có số (ví dụ Web Speech API nhận
            // sai "30 giây" thành "iso" — lỗi thật đã ghi nhận), thử các
            // alternative khác của cùng lượt ghi âm xem có bản nào chứa số
            // trước khi đành mặc định 30s. Trước đây luôn mặc định ngay lập
            // tức dù alternative kế có thể chứa đúng con số user nói.
            if (!/\d/.test(t)) {
                const altIdx = fallbackAlternatives.findIndex(a => /\d/.test(a));
                if (altIdx !== -1) return _processCommand(fallbackAlternatives[altIdx], fallbackAlternatives.slice(altIdx + 1));
            }
            const a = _parseAmount(t, 30);
            PlayerControl.seekBy(a); _notify(`+${a}s`); return;
        }
        // Short: "5 giây" / "1 phút" without explicit direction → treat as forward
        if (/^(\d+\s*(giây|phút))$/.test(t)) {
            const a = _parseAmount(t, 10);
            PlayerControl.seekBy(a); _notify(`+${a}s`); return;
        }

        // ── 4. SEEK — relative backward ───────────────────────────────────
        if (_re('tua lại|tua lùi|lùi lại|lùi về|xem lại|rewind|quay lại \d').test(t)) {
            if (!/\d/.test(t)) {
                const altIdx = fallbackAlternatives.findIndex(a => /\d/.test(a));
                if (altIdx !== -1) return _processCommand(fallbackAlternatives[altIdx], fallbackAlternatives.slice(altIdx + 1));
            }
            const a = _parseAmount(t, 10);
            PlayerControl.seekBy(-a); _notify(`−${a}s`); return;
        }

        // ── 5. PLAY / PAUSE ───────────────────────────────────────────────
        // ── 5. PLAY / PAUSE ───────────────────────────────────────────────
        if (_re('dừng|tạm dừng|pause|ngừng|đứng lại').test(t)) {
            const ok = PlayerControl.pause();
            _notify(ok ? 'Dừng' : '⚠️ Không tìm thấy video để dừng'); return;
        }
        // Loại trừ "phát" khi đứng sau "tốc độ" (ví dụ "tăng tốc độ phát lên
        // 1,5") — đó là lệnh đổi tốc độ, không phải lệnh play. Trước đây regex
        // này match nhầm và return sớm, khiến lệnh đổi tốc độ không bao giờ
        // chạy tới được nhánh PLAYBACK SPEED phía dưới.
        if (!/tốc độ\s*phát/.test(t) && _re('phát|play|tiếp tục|chạy|chơi|bắt đầu').test(t)) {
            const ok = PlayerControl.play();
            _notify(ok ? 'Phát' : '⚠️ Không tìm thấy video để phát'); return;
        }
        // Toggle
        if (_re('toggle|bật tắt phát').test(t)) {
            PlayerControl.togglePlay(); _notify('Toggle'); return;
        }

        // ── 6. VOLUME ─────────────────────────────────────────────────────
        if (_re('tắt tiếng|im lặng|mute').test(t))                { PlayerControl.mute(); _notify('Tắt tiếng'); return; }
        if (_re('bật tiếng|unmute|bỏ tắt tiếng').test(t))         { PlayerControl.unmute(); _vol(PlayerControl.getVolume() || 0.8); _notify('Bật tiếng'); return; }
        if (_re('tăng âm|to hơn|lớn hơn').test(t)) {
            const step = _parseAmount(t, 10) / 100;
            _vol((v?.volume ?? 0.5) + step); _notify(`Âm lượng +${Math.round(step*100)}%`); return;
        }
        if (_re('giảm âm|nhỏ hơn|bé hơn').test(t)) {
            const step = _parseAmount(t, 10) / 100;
            _vol((v?.volume ?? 0.5) - step); _notify(`Âm lượng −${Math.round(step*100)}%`); return;
        }
        if (_re('âm lượng|volume').test(t)) {
            const m = t.match(/(\d+)/);
            if (m) { _vol(+m[1] / 100); _notify(`Âm lượng ${m[1]}%`); }
            return;
        }
        // Percentage shorthand "50 phần trăm"
        if (/(\d+)\s*phần trăm/.test(t)) {
            const m = t.match(/(\d+)\s*phần trăm/);
            _vol(+m[1] / 100); _notify(`Âm lượng ${m[1]}%`); return;
        }

        // ── 7. PLAYBACK SPEED ─────────────────────────────────────────────
        if (_re('bình thường|tốc độ bình thường|1x|normal speed').test(t)) { _rate(1);    _notify('1x'); return; }

        // Exact: "tốc độ 1.5" / "1.5x" / "hai lần" — kiểm tra TRƯỚC nhánh
        // "nhanh hơn/tăng tốc" (tương đối, không có số), vì câu như "tăng tốc
        // độ phát lên 1,5" chứa substring "tăng tốc" (bên trong "tăng tốc
        // độ") nên sẽ bị nhánh tương đối nuốt mất nếu nó chạy trước — mất số
        // 1.5 cụ thể mà user đã nói rõ.
        {
            const wordMap = { 'nửa': 0.5, 'một': 1, 'một rưỡi': 1.5, 'hai': 2, 'ba': 3 };
            for (const [word, val] of Object.entries(wordMap)) {
                if (t.includes(word + ' lần') || t.includes(word + 'x')) { _rate(val); _notify(val + 'x'); return; }
            }
            const m = t.match(/(?:tốc độ|speed)\D*?(\d+(?:\.\d+)?)/);
            if (m) { _rate(+m[1]); _notify(m[1] + 'x'); return; }
            const m2 = t.match(/(\d+(?:\.\d+)?)\s*x\b/);
            if (m2) { _rate(+m2[1]); _notify(m2[1] + 'x'); return; }
        }

        if (_re('nhanh hơn|tăng tốc').test(t)) {
            const m = t.match(/(\d+(?:\.\d+)?)\s*x/);
            const step = m ? +m[1] : PlayerControl.getRate() + 0.25;
            _rate(step); _notify(step + 'x'); return;
        }
        if (_re('chậm hơn|giảm tốc').test(t)) {
            const cur = PlayerControl.getRate();
            _rate(cur - 0.25); _notify((cur - 0.25).toFixed(2) + 'x'); return;
        }

        // ── 8. FULLSCREEN ─────────────────────────────────────────────────
        if (_re('toàn màn hình|fullscreen|phóng to màn hình').test(t)) {
            PlayerControl.toggleFullscreen(); _notify('Toàn màn hình'); return;
        }
        if (_re('thoát toàn màn|thu nhỏ màn|exit fullscreen').test(t)) {
            PlayerControl.exitFullscreen(); _notify('Thoát toàn màn'); return;
        }

        // ── 9. SUBTITLE / CAPTION ─────────────────────────────────────────
        if (_re('phụ đề|subtitle|caption|cc').test(t)) {
            document.querySelector('.ytp-subtitles-button')?.click(); _notify('Toggle phụ đề'); return;
        }

        // ── 10. QUALITY ───────────────────────────────────────────────────
        // Sửa bug cũ: "720" và "1080" trước đây bị gộp chung 1 nhánh, luôn set
        // 1080p bất kể user nói số nào. Giờ tách riêng để set đúng resolution.
        if (_re('1080p?|full ?hd').test(t)) {
            const ok = PlayerControl.setQuality(1080); _notify(ok ? '1080p' : 'Không đổi được chất lượng'); return;
        }
        if (/\b(720p?|(?<!full ?)hd)\b/.test(t)) {
            const ok = PlayerControl.setQuality(720); _notify(ok ? '720p' : 'Không đổi được chất lượng'); return;
        }
        if (_re('chất lượng thấp|tiết kiệm data|360p?').test(t)) {
            const ok = PlayerControl.setQuality(360); _notify(ok ? '360p' : 'Không đổi được chất lượng'); return;
        }
        if (_re('144p?|240p?').test(t)) {
            const m = t.match(/144|240/);
            const ok = PlayerControl.setQuality(+m[0]); _notify(ok ? m[0] + 'p' : 'Không đổi được chất lượng'); return;
        }
        if (_re('tự động|auto quality|chất lượng tự động').test(t)) {
            const ok = PlayerControl.setQuality('auto'); _notify(ok ? 'Auto' : 'Không đổi được chất lượng'); return;
        }

        // ── 11. THEATER / MINI PLAYER ─────────────────────────────────────
        if (_re('rạp|theater|cinema|chế độ rạp').test(t)) {
            document.querySelector('.ytp-size-button')?.click(); _notify('Theater mode'); return;
        }
        if (_re('thu nhỏ cửa sổ|mini player|mini').test(t)) {
            document.querySelector('.ytp-miniplayer-button')?.click(); _notify('Mini player'); return;
        }

        // ── 12. PiP ───────────────────────────────────────────────────────
        if (_re('pip|picture in picture|màn hình nổi|nổi').test(t)) {
            PlayerControl.togglePiP(); _notify('PiP'); return;
        }

        // ── 13. MODE TOGGLES ──────────────────────────────────────────────
        if (_re('bỏ qua quảng cáo tài trợ|sponsor block|sponsorblock|skip sponsor').test(t)) {
            const nv = !Storage.getFeatureFlags().sponsorBlock;
            Storage.saveFlag('sponsorBlock', nv);
            const vid = new URLSearchParams(location.search).get('v');
            nv ? SponsorBlock.enable(vid) : SponsorBlock.disable();
            _notify('SponsorBlock ' + (nv ? 'ON' : 'OFF')); return;
        }
        // Lưu ý: flag/gm key 'marathon' được giữ tên cũ để không phá dữ liệu
        // user đã lưu, nhưng bản chất đây là AdBlock toggle (xem AdBlock module).
        // 'marathon'/'xem liên tục' giữ lại cho backward-compat với người dùng
        // cũ đã quen câu lệnh, nhưng thêm từ khoá đúng bản chất để tránh nhầm.
        if (_re('marathon|xem liên tục|chặn quảng cáo|chặn qc|bỏ quảng cáo').test(t)) {
            const nv = !Storage.getFeatureFlags().marathon;
            Storage.saveFlag('marathon', nv);
            EventBus.emit('modeChange', { key: 'marathon', value: nv });
            _notify('Chặn quảng cáo ' + (nv ? 'ON' : 'OFF')); return;
        }
        if (_re('audio mode|chế độ nghe|chỉ nghe|nghe thôi').test(t)) {
            const nv = !AudioMode.isActive();
            EventBus.emit(nv ? 'audioModeEnable' : 'audioModeDisable');
            _notify('Audio Mode ' + (nv ? 'ON' : 'OFF')); return;
        }
        if (_re('tự động chuyển|auto next|tự chuyển').test(t)) {
            const nv = !Storage.getFeatureFlags().autoPlay;
            Storage.saveFlag('auto', nv);
            EventBus.emit('modeChange', { key: 'autoPlay', value: nv });
            _notify('Tự chuyển ' + (nv ? 'ON' : 'OFF')); return;
        }
        if (_re('auto skip|tự bỏ qua|bỏ intro').test(t)) {
            const nv = !Storage.getFeatureFlags().autoSkip;
            Storage.saveFlag('autoskip', nv);
            EventBus.emit('modeChange', { key: 'autoSkip', value: nv });
            _notify('Auto Skip ' + (nv ? 'ON' : 'OFF')); return;
        }

        // ── 14. SOCIAL ────────────────────────────────────────────────────
        if (_re('thích|like|tim').test(t) && !/không thích/.test(t)) {
            document.querySelector('#top-level-buttons-computed yt-icon-button:first-child button')?.click();
            _notify('Đã like'); return;
        }
        if (_re('không thích|dislike').test(t)) {
            document.querySelector('#top-level-buttons-computed yt-icon-button:nth-child(2) button')?.click();
            _notify('Dislike'); return;
        }
        if (_re('đăng ký|subscribe').test(t)) {
            document.querySelector('#subscribe-button button, ytd-subscribe-button-renderer button')?.click();
            _notify('Subscribe'); return;
        }
        if (_re('chia sẻ|share').test(t)) {
            document.querySelector('#share-button button, button[aria-label*="Share"]')?.click();
            _notify('Share'); return;
        }

        // ── 15. WATCH LATER ───────────────────────────────────────────────
        if (_re('xem sau|save|lưu lại|bookmark').test(t)) {
            Storage.addToWatchLater(location.href, document.title);
            _notify('Đã lưu vào Xem sau'); return;
        }

        // ── 16. SCREENSHOT / CLIP ─────────────────────────────────────────
        if (_re('chụp màn|screenshot|chụp ảnh').test(t)) {
            if (!v) return;
            const c = document.createElement('canvas');
            c.width = v.videoWidth; c.height = v.videoHeight;
            c.getContext('2d').drawImage(v, 0, 0);
            const a = document.createElement('a');
            a.download = `VTV_${Date.now()}.png`;
            a.href = c.toDataURL('image/png');
            a.click();
            _notify('Chụp màn hình'); return;
        }

        // ── 17. LOOP ──────────────────────────────────────────────────────
        if (_re('lặp lại|loop|phát lại').test(t)) {
            if (v) { v.loop = !v.loop; _notify('Loop ' + (v.loop ? 'ON' : 'OFF')); }
            return;
        }

        // ── 18. INFO / STATUS ─────────────────────────────────────────────
        if (_re('thời gian|còn bao lâu|bao lâu nữa').test(t)) {
            if (!v) return;
            const rem = Math.round(dur - v.currentTime);
            const m = Math.floor(rem/60), s = rem%60;
            _notify(`Còn ${m}p${s}s`); return;
        }
        if (_re('tốc độ hiện tại|đang chạy bao nhanh').test(t)) {
            _notify(`${PlayerControl.getRate()}x`); return;
        }
        if (_re('âm lượng hiện tại|volume mấy').test(t)) {
            _notify(`${Math.round(PlayerControl.getVolume()*100)}%`); return;
        }

        // ── 19. SCROLL PAGE ───────────────────────────────────────────────
        if (_re('cuộn xuống|scroll down').test(t))  { window.scrollBy(0, 300); _notify('Cuộn xuống'); return; }
        if (_re('cuộn lên|scroll up').test(t))      { window.scrollBy(0, -300); _notify('Cuộn lên'); return; }
        if (_re('lên đầu trang|top').test(t))       { window.scrollTo(0,0); _notify('Lên đầu trang'); return; }

        // ── 20. PANEL HIDE/SHOW ───────────────────────────────────────────
        if (_re('ẩn bảng|ẩn panel|đóng panel').test(t)) {
            document.getElementById('vtv-panel')?.classList.add('vtv-hidden');
            document.getElementById('vtv-fab')?.classList.add('vtv-show');
            _notify('Ẩn bảng'); return;
        }
        if (_re('hiện bảng|mở panel|hiện panel').test(t)) {
            document.getElementById('vtv-panel')?.classList.remove('vtv-hidden');
            document.getElementById('vtv-fab')?.classList.remove('vtv-show');
            _notify('Hiện bảng'); return;
        }

        // ── 21. DETECTIVE — suy luận ý định GIÁN TIẾP ──────────────────────
        // Khác 20 nhóm trên (match từ khoá LỆNH trực tiếp: "tạm dừng", "tua
        // tới"...), nhóm này DIỄN GIẢI câu nói đời thường không phải lệnh rõ
        // ràng, suy ra hành động phù hợp. Đặt CUỐI CÙNG (chỉ chạy khi không
        // command trực tiếp nào match) để không cướp mất câu lệnh rõ ràng —
        // ví dụ "to hơn" (lệnh trực tiếp, đã match ở nhóm VOLUME) không bao
        // giờ rơi xuống đây; chỉ câu như "nghe không rõ" (không phải lệnh,
        // là than phiền) mới cần suy luận.
        //
        // Mỗi rule đều có ĐIỀU KIỆN NGỮ CẢNH THU HẸP để giảm false positive
        // (ví dụ "ồn quá" phải đi kèm ý than phiền về ÂM LƯỢNG, không phải
        // bình luận nội dung phim ồn ào — dù ranh giới này không hoàn hảo
        // 100%, đây là giới hạn cố hữu của rule-based NLP, không phải AI thật
        // hiểu ngữ nghĩa).
        {
            // Than phiền nghe không rõ / ồn → có thể do TV/loa nhỏ, gợi ý tăng
            // âm lượng HOẶC bật phụ đề (không tự làm cả 2 để tránh áp đặt).
            if (_re('nghe không rõ|nghe không được|không nghe rõ|nghe khó quá').test(t)) {
                PlayerControl.setVolume(Math.min(1, PlayerControl.getVolume() + 0.2));
                _notify('🔍 Đã tăng âm lượng — nói "phụ đề" nếu vẫn khó nghe'); return;
            }
            if (_re('ồn quá|to quá|nhức tai|chói tai').test(t)) {
                PlayerControl.setVolume(Math.max(0, PlayerControl.getVolume() - 0.2));
                _notify('🔍 Đã giảm âm lượng'); return;
            }

            // Than phiền buồn ngủ/mệt → không tự pause (có thể user chỉ đang
            // tâm sự, tự ý dừng video giữa chừng là áp đặt quá mức), chỉ gợi
            // ý nhẹ nhàng qua notify.
            if (_re('buồn ngủ quá|mệt quá|díp mắt rồi').test(t)) {
                _notify('🔍 Nói "tạm dừng" nếu muốn nghỉ, mình sẽ nhớ vị trí đang xem'); return;
            }

            // Than phiền giật/lag → khả năng cao do quality cao/mạng chậm,
            // chủ động hạ 1 bậc quality (đã có BufferMonitor tự động, nhưng
            // đây phản hồi NGAY theo yêu cầu thay vì đợi đủ ngưỡng buffering).
            if (_re('giật quá|lag quá|đứng hình|khựng lại|chậm quá').test(t)) {
                const avail = PlayerControl.getAvailableQualities();
                const ladder = ['hd1080', 'hd720', 'large', 'medium', 'small'];
                const cur = PlayerControl.getQuality();
                const idx = ladder.indexOf(cur);
                const target = idx >= 0 && idx < ladder.length - 1 ? ladder[idx + 1] : 'medium';
                const ok = PlayerControl.setQuality(target);
                _notify(ok ? `🔍 Đã giảm chất lượng xuống ${target} cho mượt hơn` : '🔍 Không tự giảm được chất lượng, thử tự chỉnh trong Settings'); return;
            }

            // Hỏi "đang xem gì" / "phim gì đây" → trả lời bằng info đã parse
            // được (không phải lệnh điều khiển, là câu hỏi thông tin).
            if (_re('đang xem gì|phim gì đây|phim gì vậy|đây là phim gì').test(t)) {
                const info = window._vtvParsedInfo;
                _notify(info ? `🔍 ${info.series} — Tập ${info.episode}` : '🔍 Chưa nhận diện được tên phim'); return;
            }

            // Hỏi "còn bao lâu nữa hết tập" → tính từ currentTime/duration.
            if (_re('còn bao lâu|sắp hết chưa|bao lâu nữa hết').test(t)) {
                const vv = VideoContext.getVideoEl();
                if (vv?.duration) {
                    const remain = Math.round(vv.duration - vv.currentTime);
                    const mins = Math.floor(remain / 60), secs = remain % 60;
                    _notify(`🔍 Còn ${mins} phút ${secs} giây`);
                } else {
                    _notify('🔍 Chưa xác định được thời lượng');
                }
                return;
            }

            // "Bỏ lỡ gì không / tóm tắt lại" → không có khả năng tóm tắt nội
            // dung thật (cần hiểu video, ngoài khả năng rule-based), nhưng
            // trung thực báo rõ giới hạn thay vì im lặng bỏ qua như 1 lệnh
            // không nhận diện được — người dùng biết đây là giới hạn thật,
            // không phải lỗi.
            if (_re('tóm tắt|bỏ lỡ gì không|vừa nãy nói gì').test(t)) {
                _notify('🔍 Xin lỗi, mình chưa thể tóm tắt nội dung video — chỉ điều khiển phát/tua/âm lượng'); return;
            }
        }

        // Unrecognized với alternative hiện tại — nếu còn alternative khác từ
        // Speech API chưa thử (do audio bị nhiễu khiến lựa chọn đầu sai),
        // thử tiếp thay vì báo lỗi ngay. Chỉ báo "❓ unrecognized" thật sự khi
        // đã thử HẾT mọi alternative mà không cái nào match được lệnh nào.
        if (fallbackAlternatives.length > 0) {
            const [next, ...rest] = fallbackAlternatives;
            log('[Voice] alternative đầu không match, thử:', next);
            return _processCommand(next, rest);
        }

        log('[Voice] unrecognized command:', t);
        EventBus.emit('voiceLabel', { text: '❓ ' + raw });
        setTimeout(() => EventBus.emit('voiceLabel', { text: '' }), 2000);
    }

    // Keyboard binding (push-to-talk)
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() !== PT_KEY || e.repeat || !_enabled) return;
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
        e.preventDefault();
        _startRecording();
    });
    document.addEventListener('keyup', (e) => {
        if (e.key.toLowerCase() === PT_KEY) _stopRecording();
    });

    function start() {
        _enabled = true;
        Storage.saveFlag('voice', true);
        if (!_initialized) _init();
        log('[Voice] enabled (push-to-talk: hold V)');
    }

    function stop() {
        _enabled = false;
        Storage.saveFlag('voice', false);
        _destroy();
        EventBus.emit('voiceLabel', { text: '' });
    }

    EventBus.on('voiceStart', start);
    EventBus.on('voiceStop',  stop);

    return { start, stop };
})();


// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────────
const Keyboard = (() => {
    let _nextUrl = null;
    let _prevUrl = null;

    EventBus.on('nextFound', ({ url }) => { _nextUrl = url; });
    EventBus.on('prevFound', ({ url }) => { _prevUrl = url; });

    function setup() {
        document.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;

            // Marathon toggle: dùng Shift+M thay vì M trơn, vì M là phím mute
            // NATIVE của YouTube — dùng M trơn sẽ khiến cả 2 handler chạy cùng
            // lúc (vừa mute vừa toggle marathon), rất khó hiểu cho user.
            if (e.shiftKey && (e.key === 'm' || e.key === 'M')) {
                const nv = !Storage.getFeatureFlags().marathon;
                Storage.saveFlag('marathon', nv);
                EventBus.emit('modeChange', { key: 'marathon', value: nv });
                return;
            }

            // Quality cycle: Shift+Q — KHÔNG trùng phím native nào của YouTube
            // (YouTube không có shortcut đổi resolution mặc định), an toàn để thêm.
            if (e.shiftKey && (e.key === 'q' || e.key === 'Q')) {
                _cycleQuality();
                return;
            }

            switch (e.key) {
                case 'n': case 'N': if (_nextUrl) Navigator.goTo(_nextUrl); break;
                case 'b': case 'B': if (_prevUrl) Navigator.goTo(_prevUrl); break;
                case 'g': case 'G': _recordGIF(); break;
                case 's': case 'S': Storage.addToWatchLater(location.href, document.title); break;
            }
            // "Tìm bản Full": Shift+F thay vì F trơn — F trơn là fullscreen
            // NATIVE của YouTube, dùng trùng sẽ mở dialog "tìm bản Full" mỗi
            // lần user chỉ muốn bật fullscreen bình thường.
            if (e.shiftKey && (e.key === 'f' || e.key === 'F')) _findFull();
        });
    }

    // Cycle qua các mốc quality phổ biến (auto → 1080 → 720 → 360 → auto...).
    // Dùng PlayerControl.getAvailableQualities() để chỉ cycle qua resolution
    // THẬT SỰ có sẵn cho video này (một số video không có 1080p), tránh set
    // vô ích vào resolution không tồn tại.
    const _QUALITY_CYCLE = ['auto', 'hd1080', 'hd720', 'medium'];
    let _qualityCycleIdx = 0;
    function _cycleQuality() {
        const available = PlayerControl.getAvailableQualities();
        // Giới hạn số lần thử = độ dài cycle, tránh vòng lặp vô hạn nếu mọi
        // resolution trong cycle đều không có sẵn cho video này (ví dụ API
        // getAvailableQualities() trả về rỗng do lỗi/version khác).
        for (let i = 0; i < _QUALITY_CYCLE.length; i++) {
            _qualityCycleIdx = (_qualityCycleIdx + 1) % _QUALITY_CYCLE.length;
            const target = _QUALITY_CYCLE[_qualityCycleIdx];
            if (available.length && target !== 'auto' && !available.includes(target)) continue; // thử mốc kế
            const ok = PlayerControl.setQuality(target);
            EventBus.emit('voiceLabel', { text: ok ? `Chất lượng: ${target}` : 'Không đổi được chất lượng' });
            return;
        }
        // Không mốc nào hợp lệ (available rỗng hoặc lỗi) — vẫn thử set mốc hiện tại,
        // để không im lặng hoàn toàn khi user bấm phím.
        const ok = PlayerControl.setQuality(_QUALITY_CYCLE[_qualityCycleIdx]);
        EventBus.emit('voiceLabel', { text: ok ? 'Đã đổi chất lượng' : 'Không đổi được chất lượng' });
    }

    async function _recordGIF() {
        const v = VideoContext.getVideoEl();
        if (!v?.captureStream) return alert('Không hỗ trợ quay video');
        const mr = new MediaRecorder(v.captureStream(), { mimeType: 'video/webm' });
        const chunks = [];
        mr.ondataavailable = e => chunks.push(e.data);
        mr.onstop = () => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
            a.download = `VTV_${Date.now()}.webm`;
            a.click();
        };
        mr.start(); setTimeout(() => mr.stop(), 10000);
        alert('Đang quay 10 giây...');
    }

    async function _findFull() {
        const info = window._vtvParsedInfo;
        if (!info) return;
        const res  = await Search.search(`${info.series} tập ${info.episode}`);
        const full = res.filter(v => {
            const p = parseTitle(v.title);
            return p?.episode === info.episode && p.series === info.series && v.title.toLowerCase().includes('full');
        });
        if (full.length && confirm(`Tìm thấy bản Full: ${full[0].title}. Chuyển sang?`)) {
            Navigator.goTo(`https://youtu.be/${full[0].videoId}`);
        }
    }

    return { setup };
})();


// ─────────────────────────────────────────────────────────────────────────────
// AGE BYPASS (utility, no EventBus wiring needed)
// ─────────────────────────────────────────────────────────────────────────────
async function bypassAgeRestriction(videoId) {
    const methods = [
        { name: 'Embed (YouTube)',       url: `https://www.youtube.com/embed/${videoId}?autoplay=1` },
        { name: 'YouTube NoCookie',      url: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1` },
        { name: 'Invidious (snopyta)',   url: `https://invidious.snopyta.org/watch?v=${videoId}` },
        { name: 'Piped',                 url: `https://piped.video/watch?v=${videoId}` },
    ];
    for (const method of methods) {
        try {
            if ((await fetch(method.url, { method: 'HEAD' })).ok) {
                if (confirm(`Mở bằng: ${method.name}?`)) { window.location.href = method.url; return; }
            }
        } catch (e) {}
    }
}
