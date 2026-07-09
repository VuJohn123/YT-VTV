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
        const v = VideoContext.getVideoEl();
        if (v) v.style.opacity = '0';

        log('[AudioMode] enabled, quality:', lowest, '(was:', _prevQuality, ')');
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
        const v = VideoContext.getVideoEl();
        if (v) v.style.opacity = '';

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

    async function _check() {
        const v = VideoContext.getVideoEl();
        if (!v || !_enabled) return;
        if (document.hidden && !v.paused && !document.pictureInPictureElement) {
            if (await PlayerControl.enterPiP()) _active = true;
        } else if (!document.hidden && _active && document.pictureInPictureElement) {
            if (await PlayerControl.exitPiP()) _active = false;
        }
    }

    function enable() {
        if (_enabled) return;
        _enabled = true;
        Storage.saveFlag('pip', true);
        document.addEventListener('visibilitychange', _check);
        _interval = setInterval(_check, 2000);
        log('[AutoPiP] enabled');
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
        _sr.maxAlternatives = 1;
        _initialized = true;

        _sr.onresult = (e) => {
            if (!_recording) return;
            let transcript = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) transcript += e.results[i][0].transcript;
            }
            transcript = transcript.toLowerCase().trim();
            if (transcript && transcript.length < 80) {
                log('[Voice] command:', transcript);
                EventBus.emit('voiceLabel', { text: transcript });
                _processCommand(transcript);
                setTimeout(() => EventBus.emit('voiceLabel', { text: '' }), 1500);
            }
        };
        _sr.onerror = (e) => {
            _stopping = false;
            if (e.error === 'aborted' || e.error === 'no-speech') {
                _recording = false;
                if (_pendingStart && _enabled) { _pendingStart = false; _startRecording(); }
                return;
            }
            warn('[Voice] error:', e.error);
            EventBus.emit('voiceLabel', { text: 'Lỗi: ' + e.error });
            _recording = false;
        };
        _sr.onend = () => {
            _recording = _stopping = false;
            EventBus.emit('voiceLabel', { text: '' });
            if (_pendingStart && _enabled) { _pendingStart = false; _startRecording(); }
        };
    }

    function _startRecording() {
        if (!_enabled || _recording) return;
        if (_stopping) { _pendingStart = true; return; }
        if (!_sr || !_initialized) _init();
        if (!_sr) return;
        _recording = true;
        try {
            _sr.start();
            EventBus.emit('voiceLabel', { text: '🎤 Đang nghe...' });
        } catch (e) {
            _recording = false;
            _init();
            if (_sr) { try { _sr.start(); _recording = true; } catch (e2) { warn('[Voice] start failed:', e2); } }
        }
    }

    function _stopRecording() {
        _pendingStart = false;
        if (!_recording) return;
        _recording = false; _stopping = true;
        try { _sr?.abort(); } catch (e) { _stopping = false; }
        EventBus.emit('voiceLabel', { text: '' });
    }

    function _processCommand(raw) {
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
        if (/\b(tiếp theo|tập sau|tập kế|xem tiếp|chuyển tiếp|next)\b/.test(t)) {
            if (_nextUrl) { _notify('Chuyển tập tiếp theo'); Navigator.goTo(_nextUrl); }
            else _notify('Không tìm thấy tập tiếp theo');
            return;
        }
        if (/\b(quay lại|tập trước|back|trước đó|quay về)\b/.test(t)) {
            if (_prevUrl) { _notify('Quay lại tập trước'); Navigator.goTo(_prevUrl); }
            else _notify('Không có tập trước');
            return;
        }
        if (/\b(tải lại|reload|làm mới)\b/.test(t)) { _notify('Tải lại trang'); location.reload(); return; }

        // ── 2. SEEK — absolute ────────────────────────────────────────────
        if (/\b(tua đến|đến phút|tới phút|nhảy đến|đến giây|tua tới)\b/.test(t)) {
            const sec = _parseTime(t);
            if (sec !== null) { _seek(sec); _notify(`Tua đến ${sec}s`); }
            return;
        }
        // "bắt đầu", "đầu phim", "từ đầu"
        if (/\b(từ đầu|đầu phim|bắt đầu lại|quay đầu)\b/.test(t)) { _seek(0); _notify('Về đầu'); return; }
        // "cuối phim", "cuối video"
        if (/\b(cuối phim|cuối video|kết thúc|tới cuối)\b/.test(t)) { _seek(dur - 3); _notify('Tới cuối'); return; }
        // "giữa phim"
        if (/\b(giữa phim|giữa video)\b/.test(t)) { _seek(dur / 2); _notify('Đến giữa'); return; }

        // ── 3. SEEK — relative forward ────────────────────────────────────
        if (/\b(tua nhanh|tua thêm|bỏ qua|skip|tiến lên|nhảy qua)\b/.test(t)) {
            const a = _parseAmount(t, 30);
            PlayerControl.seekBy(a); _notify(`+${a}s`); return;
        }
        // Short: "5 giây" / "1 phút" without explicit direction → treat as forward
        if (/^(\d+\s*(giây|phút))$/.test(t)) {
            const a = _parseAmount(t, 10);
            PlayerControl.seekBy(a); _notify(`+${a}s`); return;
        }

        // ── 4. SEEK — relative backward ───────────────────────────────────
        if (/\b(tua lại|lùi lại|lùi về|xem lại|rewind|quay lại \d)\b/.test(t)) {
            const a = _parseAmount(t, 10);
            PlayerControl.seekBy(-a); _notify(`−${a}s`); return;
        }

        // ── 5. PLAY / PAUSE ───────────────────────────────────────────────
        if (/\b(dừng|tạm dừng|pause|ngừng|đứng lại)\b/.test(t))   { PlayerControl.pause(); _notify('Dừng'); return; }
        // Loại trừ "phát" khi đứng sau "tốc độ" (ví dụ "tăng tốc độ phát lên
        // 1,5") — đó là lệnh đổi tốc độ, không phải lệnh play. Trước đây regex
        // này match nhầm và return sớm, khiến lệnh đổi tốc độ không bao giờ
        // chạy tới được nhánh PLAYBACK SPEED phía dưới.
        if (!/tốc độ\s*phát/.test(t) && /\b(phát|play|tiếp tục|chạy|chơi|bắt đầu)\b/.test(t)) {
            PlayerControl.play();  _notify('Phát'); return;
        }
        // Toggle
        if (/\b(toggle|bật tắt phát)\b/.test(t)) {
            PlayerControl.togglePlay(); _notify('Toggle'); return;
        }

        // ── 6. VOLUME ─────────────────────────────────────────────────────
        if (/\b(tắt tiếng|im lặng|mute)\b/.test(t))                { PlayerControl.mute(); _notify('Tắt tiếng'); return; }
        if (/\b(bật tiếng|unmute|bỏ tắt tiếng)\b/.test(t))         { PlayerControl.unmute(); _vol(PlayerControl.getVolume() || 0.8); _notify('Bật tiếng'); return; }
        if (/\b(tăng âm|to hơn|lớn hơn)\b/.test(t)) {
            const step = _parseAmount(t, 10) / 100;
            _vol((v?.volume ?? 0.5) + step); _notify(`Âm lượng +${Math.round(step*100)}%`); return;
        }
        if (/\b(giảm âm|nhỏ hơn|bé hơn)\b/.test(t)) {
            const step = _parseAmount(t, 10) / 100;
            _vol((v?.volume ?? 0.5) - step); _notify(`Âm lượng −${Math.round(step*100)}%`); return;
        }
        if (/\b(âm lượng|volume)\b/.test(t)) {
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
        if (/\b(bình thường|tốc độ bình thường|1x|normal speed)\b/.test(t)) { _rate(1);    _notify('1x'); return; }

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

        if (/\b(nhanh hơn|tăng tốc)\b/.test(t)) {
            const m = t.match(/(\d+(?:\.\d+)?)\s*x/);
            const step = m ? +m[1] : PlayerControl.getRate() + 0.25;
            _rate(step); _notify(step + 'x'); return;
        }
        if (/\b(chậm hơn|giảm tốc)\b/.test(t)) {
            const cur = PlayerControl.getRate();
            _rate(cur - 0.25); _notify((cur - 0.25).toFixed(2) + 'x'); return;
        }

        // ── 8. FULLSCREEN ─────────────────────────────────────────────────
        if (/\b(toàn màn hình|fullscreen|phóng to màn hình)\b/.test(t)) {
            PlayerControl.toggleFullscreen(); _notify('Toàn màn hình'); return;
        }
        if (/\b(thoát toàn màn|thu nhỏ màn|exit fullscreen)\b/.test(t)) {
            PlayerControl.exitFullscreen(); _notify('Thoát toàn màn'); return;
        }

        // ── 9. SUBTITLE / CAPTION ─────────────────────────────────────────
        if (/\b(phụ đề|subtitle|caption|cc)\b/.test(t)) {
            document.querySelector('.ytp-subtitles-button')?.click(); _notify('Toggle phụ đề'); return;
        }

        // ── 10. QUALITY ───────────────────────────────────────────────────
        // Sửa bug cũ: "720" và "1080" trước đây bị gộp chung 1 nhánh, luôn set
        // 1080p bất kể user nói số nào. Giờ tách riêng để set đúng resolution.
        if (/\b(1080p?|full ?hd)\b/.test(t)) {
            const ok = PlayerControl.setQuality(1080); _notify(ok ? '1080p' : 'Không đổi được chất lượng'); return;
        }
        if (/\b(720p?|(?<!full ?)hd)\b/.test(t)) {
            const ok = PlayerControl.setQuality(720); _notify(ok ? '720p' : 'Không đổi được chất lượng'); return;
        }
        if (/\b(chất lượng thấp|tiết kiệm data|360p?)\b/.test(t)) {
            const ok = PlayerControl.setQuality(360); _notify(ok ? '360p' : 'Không đổi được chất lượng'); return;
        }
        if (/\b(144p?|240p?)\b/.test(t)) {
            const m = t.match(/144|240/);
            const ok = PlayerControl.setQuality(+m[0]); _notify(ok ? m[0] + 'p' : 'Không đổi được chất lượng'); return;
        }
        if (/\b(tự động|auto quality|chất lượng tự động)\b/.test(t)) {
            const ok = PlayerControl.setQuality('auto'); _notify(ok ? 'Auto' : 'Không đổi được chất lượng'); return;
        }

        // ── 11. THEATER / MINI PLAYER ─────────────────────────────────────
        if (/\b(rạp|theater|cinema|chế độ rạp)\b/.test(t)) {
            document.querySelector('.ytp-size-button')?.click(); _notify('Theater mode'); return;
        }
        if (/\b(thu nhỏ cửa sổ|mini player|mini)\b/.test(t)) {
            document.querySelector('.ytp-miniplayer-button')?.click(); _notify('Mini player'); return;
        }

        // ── 12. PiP ───────────────────────────────────────────────────────
        if (/\b(pip|picture in picture|màn hình nổi|nổi)\b/.test(t)) {
            PlayerControl.togglePiP(); _notify('PiP'); return;
        }

        // ── 13. MODE TOGGLES ──────────────────────────────────────────────
        if (/\b(bỏ qua quảng cáo tài trợ|sponsor block|sponsorblock|skip sponsor)\b/.test(t)) {
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
        if (/\b(marathon|xem liên tục|chặn quảng cáo|chặn qc|bỏ quảng cáo)\b/.test(t)) {
            const nv = !Storage.getFeatureFlags().marathon;
            Storage.saveFlag('marathon', nv);
            EventBus.emit('modeChange', { key: 'marathon', value: nv });
            _notify('Chặn quảng cáo ' + (nv ? 'ON' : 'OFF')); return;
        }
        if (/\b(audio mode|chế độ nghe|chỉ nghe|nghe thôi)\b/.test(t)) {
            const nv = !AudioMode.isActive();
            EventBus.emit(nv ? 'audioModeEnable' : 'audioModeDisable');
            _notify('Audio Mode ' + (nv ? 'ON' : 'OFF')); return;
        }
        if (/\b(tự động chuyển|auto next|tự chuyển)\b/.test(t)) {
            const nv = !Storage.getFeatureFlags().autoPlay;
            Storage.saveFlag('auto', nv);
            EventBus.emit('modeChange', { key: 'autoPlay', value: nv });
            _notify('Tự chuyển ' + (nv ? 'ON' : 'OFF')); return;
        }
        if (/\b(auto skip|tự bỏ qua|bỏ intro)\b/.test(t)) {
            const nv = !Storage.getFeatureFlags().autoSkip;
            Storage.saveFlag('autoskip', nv);
            EventBus.emit('modeChange', { key: 'autoSkip', value: nv });
            _notify('Auto Skip ' + (nv ? 'ON' : 'OFF')); return;
        }

        // ── 14. SOCIAL ────────────────────────────────────────────────────
        if (/\b(thích|like|tim)\b/.test(t) && !/không thích/.test(t)) {
            document.querySelector('#top-level-buttons-computed yt-icon-button:first-child button')?.click();
            _notify('Đã like'); return;
        }
        if (/\b(không thích|dislike)\b/.test(t)) {
            document.querySelector('#top-level-buttons-computed yt-icon-button:nth-child(2) button')?.click();
            _notify('Dislike'); return;
        }
        if (/\b(đăng ký|subscribe)\b/.test(t)) {
            document.querySelector('#subscribe-button button, ytd-subscribe-button-renderer button')?.click();
            _notify('Subscribe'); return;
        }
        if (/\b(chia sẻ|share)\b/.test(t)) {
            document.querySelector('#share-button button, button[aria-label*="Share"]')?.click();
            _notify('Share'); return;
        }

        // ── 15. WATCH LATER ───────────────────────────────────────────────
        if (/\b(xem sau|save|lưu lại|bookmark)\b/.test(t)) {
            Storage.addToWatchLater(location.href, document.title);
            _notify('Đã lưu vào Xem sau'); return;
        }

        // ── 16. SCREENSHOT / CLIP ─────────────────────────────────────────
        if (/\b(chụp màn|screenshot|chụp ảnh)\b/.test(t)) {
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
        if (/\b(lặp lại|loop|phát lại)\b/.test(t)) {
            if (v) { v.loop = !v.loop; _notify('Loop ' + (v.loop ? 'ON' : 'OFF')); }
            return;
        }

        // ── 18. INFO / STATUS ─────────────────────────────────────────────
        if (/\b(thời gian|còn bao lâu|bao lâu nữa)\b/.test(t)) {
            if (!v) return;
            const rem = Math.round(dur - v.currentTime);
            const m = Math.floor(rem/60), s = rem%60;
            _notify(`Còn ${m}p${s}s`); return;
        }
        if (/\b(tốc độ hiện tại|đang chạy bao nhanh)\b/.test(t)) {
            _notify(`${PlayerControl.getRate()}x`); return;
        }
        if (/\b(âm lượng hiện tại|volume mấy)\b/.test(t)) {
            _notify(`${Math.round(PlayerControl.getVolume()*100)}%`); return;
        }

        // ── 19. SCROLL PAGE ───────────────────────────────────────────────
        if (/\b(cuộn xuống|scroll down)\b/.test(t))  { window.scrollBy(0, 300); _notify('Cuộn xuống'); return; }
        if (/\b(cuộn lên|scroll up)\b/.test(t))      { window.scrollBy(0, -300); _notify('Cuộn lên'); return; }
        if (/\b(lên đầu trang|top)\b/.test(t))       { window.scrollTo(0,0); _notify('Lên đầu trang'); return; }

        // ── 20. PANEL HIDE/SHOW ───────────────────────────────────────────
        if (/\b(ẩn bảng|ẩn panel|đóng panel)\b/.test(t)) {
            document.getElementById('vtv-panel')?.classList.add('vtv-hidden');
            document.getElementById('vtv-fab')?.classList.add('vtv-show');
            _notify('Ẩn bảng'); return;
        }
        if (/\b(hiện bảng|mở panel|hiện panel)\b/.test(t)) {
            document.getElementById('vtv-panel')?.classList.remove('vtv-hidden');
            document.getElementById('vtv-fab')?.classList.remove('vtv-show');
            _notify('Hiện bảng'); return;
        }

        // Unrecognized
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
