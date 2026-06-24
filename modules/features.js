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
                    v.currentTime = v.duration - 0.1;
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
// ─────────────────────────────────────────────────────────────────────────────
const AudioMode = (() => {
    let _overlay         = null;
    let _prevQuality     = null;
    let _active          = false;

    function _initOverlay() {
        if (_overlay) return;
        _overlay = document.createElement('div');
        _overlay.id = 'vtv-audio-overlay';
        Object.assign(_overlay.style, {
            position: 'absolute', top: '0', left: '0',
            width: '100%', height: '100%',
            background: 'black', zIndex: '100',
            display: 'none', pointerEvents: 'none',
        });
        const player = document.querySelector('#movie_player, .html5-video-player');
        if (player) {
            if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
            player.appendChild(_overlay);
        } else {
            setTimeout(_initOverlay, 1000);
        }
    }

    async function _setLowestQuality() {
        const v = VideoContext.getVideoEl();
        if (!v) return;
        try {
            const player = window.yt?.getPlayer?.();
            if (typeof player?.getAvailableQualityLevels === 'function') {
                const available = player.getAvailableQualityLevels();
                if (available?.length) {
                    if (_prevQuality === null) _prevQuality = player.getPlaybackQuality?.() ?? null;
                    player.setPlaybackQuality(available[available.length - 1]);
                    return;
                }
            }
        } catch (e) {}
        // Fallback: settings menu
        try {
            const btn = document.querySelector('.ytp-settings-button');
            if (!btn) return;
            btn.click();
            await new Promise(r => setTimeout(r, 500));
            for (const item of document.querySelectorAll('.ytp-menuitem')) {
                if (/Chất lượng|Quality/i.test(item.querySelector('.ytp-menuitem-label')?.textContent || '')) {
                    item.click(); await new Promise(r => setTimeout(r, 300)); break;
                }
            }
            let lowest = null, lowestH = Infinity;
            for (const opt of document.querySelectorAll('.ytp-quality-menu .ytp-menuitem')) {
                const m = opt.querySelector('.ytp-menuitem-label')?.textContent.match(/(\d+)p/);
                if (m && parseInt(m[1]) < lowestH) { lowestH = parseInt(m[1]); lowest = opt; }
            }
            if (lowest) lowest.click();
            await new Promise(r => setTimeout(r, 200));
            btn.click();
        } catch (e) { warn('[AudioMode] quality fallback failed:', e); }
    }

    function enable() {
        if (_active) return;
        _active = true;
        Storage.saveFlag('audioMode', true);
        _initOverlay();
        if (_overlay) {
            _overlay.style.display = 'block';
            const v = VideoContext.getVideoEl();
            if (v) v.style.opacity = '0';
        }
        _setLowestQuality();
        log('[AudioMode] enabled');
    }

    function disable() {
        if (!_active) return;
        _active = false;
        Storage.saveFlag('audioMode', false);
        if (_overlay) {
            _overlay.style.display = 'none';
            const v = VideoContext.getVideoEl();
            if (v) v.style.opacity = '';
        }
        if (_prevQuality) {
            try { window.yt?.getPlayer?.()?.setPlaybackQuality(_prevQuality); } catch (e) {}
            _prevQuality = null;
        }
        log('[AudioMode] disabled');
    }

    EventBus.on('audioModeEnable',  enable);
    EventBus.on('audioModeDisable', disable);

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
            try { await v.requestPictureInPicture(); _active = true; } catch (e) {}
        } else if (!document.hidden && _active && document.pictureInPictureElement) {
            try { await document.exitPictureInPicture(); _active = false; } catch (e) {}
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
            document.exitPictureInPicture().catch(() => {});
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

    function _processCommand(t) {
        t = t.replace(/[.,?!]/g, '').replace(/\s+/g, ' ').trim();
        const v = VideoContext.getVideoEl();
        if (!v) return;

        // Navigation
        if (/tiếp theo|tập sau|next/i.test(t))      { if (_nextUrl) window.location.href = _nextUrl; return; }
        if (/quay lại|tập trước|back/i.test(t))     { if (_prevUrl) window.location.href = _prevUrl; return; }

        // Seek to time
        if (/tua đến|tua tới|đến phút|đến\s+\d/i.test(t)) {
            const patterns = [/(\d+)\s*phút\s*(\d+)\s*giây/, /(\d+)\s*:\s*(\d+)/, /phút\s*(\d+)/, /(\d+)\s*giây/];
            for (const p of patterns) {
                const m = t.match(p);
                if (m) {
                    const target = m[2] !== undefined ? parseInt(m[1]) * 60 + parseInt(m[2])
                        : parseInt(m[1]) * (p.toString().includes('phút') ? 60 : 1);
                    v.currentTime = Math.min(v.duration, target); return;
                }
            }
        }

        // Seek forward
        if (/tua thêm|tua nhanh|tiến\s+\d+/i.test(t)) {
            let a = 30; const m = t.match(/(\d+)\s*(phút|giây)/);
            if (m) { a = parseInt(m[1]); if (m[2].includes('phút')) a *= 60; }
            v.currentTime = Math.min(v.duration, v.currentTime + a); return;
        }
        // Seek back
        if (/chậm lại|lùi\s+\d+|tua lại\s+\d+/i.test(t)) {
            let a = 10; const m = t.match(/(\d+)\s*(phút|giây)/);
            if (m) { a = parseInt(m[1]); if (m[2].includes('phút')) a *= 60; }
            v.currentTime = Math.max(0, v.currentTime - a); return;
        }

        // Playback
        if (/dừng|tạm dừng|pause/i.test(t))                 { v.pause(); return; }
        if (/tiếp tục|phát|play|chạy/i.test(t))             { v.play(); return; }
        if (/âm lượng|volume/i.test(t)) {
            const m = t.match(/(\d+)/); if (m) v.volume = Math.min(1, parseInt(m[1]) / 100); return;
        }
        if (/tắt tiếng|mute/i.test(t))                      { v.volume = 0; return; }
        if (/bật tiếng|unmute/i.test(t))                     { v.volume = 1; return; }
        if (/toàn màn hình|fullscreen/i.test(t))             { document.querySelector('.ytp-fullscreen-button')?.click(); return; }
        if (/thoát toàn màn hình/i.test(t) && document.fullscreenElement) { document.exitFullscreen(); return; }
        if (/tăng tốc độ|nhanh hơn/i.test(t))               { v.playbackRate = Math.min(2, v.playbackRate + 0.25); return; }
        if (/giảm tốc độ|chậm hơn/i.test(t))               { v.playbackRate = Math.max(0.25, v.playbackRate - 0.25); return; }
        if (/tốc độ bình thường|bình thường/i.test(t))      { v.playbackRate = 1; return; }

        // Mode toggles via EventBus
        if (/marathon/i.test(t))                             { EventBus.emit('modeChange', { key: 'marathon',  value: !Storage.getFeatureFlags().marathon }); return; }
        if (/audio mode|chế độ nghe/i.test(t))              { EventBus.emit('modeChange', { key: 'audioMode', value: !AudioMode.isActive() }); return; }
        if (/pip|picture in picture/i.test(t))              { EventBus.emit('modeChange', { key: 'pipEnabled', value: true }); return; }

        // Social
        if (/like|thích/i.test(t))   { document.querySelector('#top-level-buttons-computed yt-icon-button:first-child button')?.click(); return; }
        if (/dislike|không thích/i.test(t)) { document.querySelector('#top-level-buttons-computed yt-icon-button:last-child button')?.click(); return; }
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
            switch (e.key) {
                case 'n': case 'N': if (_nextUrl) window.location.href = _nextUrl; break;
                case 'b': case 'B': if (_prevUrl) window.location.href = _prevUrl; break;
                case 'm': case 'M': EventBus.emit('modeChange', { key: 'marathon', value: !Storage.getFeatureFlags().marathon }); break;
                case 'g': case 'G': _recordGIF(); break;
                case 'f': case 'F': _findFull(); break;
                case 's': case 'S': Storage.addToWatchLater(location.href, document.title); break;
            }
        });
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
            window.location.href = `https://youtu.be/${full[0].videoId}`;
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
