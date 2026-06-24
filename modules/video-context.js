// video-context.js — Layer 2: Single owner of the <video> element
// Không module nào khác được giữ reference đến videoEl trực tiếp.
// Thay vào đó, họ lắng nghe events từ VideoContext.

const VideoContext = (() => {
    let _videoEl   = null;
    let _seriesKey = null;
    let _autoPlay  = Storage.getFeatureFlags().autoPlay;
    let _autoSkip  = Storage.getFeatureFlags().autoSkip;
    let _adDetected = false;

    let _timeInterval   = null;
    let _countdownTimer = null;
    let _redirectScheduled = false;
    let _lastTime = -1;
    let _nextUrl  = null;

    // ─── Countdown / redirect ─────────────────────────────────────────────────
    function _cancelRedirect() {
        _redirectScheduled = false;
        if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
        EventBus.emit('countdownCancel');
    }

    function _doRedirect() {
        if (_nextUrl && !_adDetected) window.location.href = _nextUrl;
    }

    function _startCountdown(sec) {
        if (!_autoPlay || !_nextUrl || _adDetected) return;
        _redirectScheduled = true;
        let rem = sec;
        EventBus.emit('countdownTick', { remaining: rem });
        if (_countdownTimer) clearInterval(_countdownTimer);
        _countdownTimer = setInterval(() => {
            rem--;
            if (rem <= 0) { clearInterval(_countdownTimer); _countdownTimer = null; _doRedirect(); }
            else EventBus.emit('countdownTick', { remaining: rem });
        }, 1000);
    }

    function _adaptiveThreshold() {
        if (!_videoEl?.duration || _videoEl.duration < AD_MAX_DURATION) return 0;
        return Math.max(5, Math.min(30, Math.floor(_videoEl.duration * 0.03)));
    }

    // ─── Video event handlers ─────────────────────────────────────────────────
    function _onLoadedMetadata() {
        const dur = _videoEl?.duration ?? 0;
        const isAd = dur > 0 && dur < AD_MAX_DURATION;
        _adDetected = isAd;
        EventBus.emit('adDetected', { detected: isAd });
        if (!isAd) EventBus.emit('videoReady', { videoEl: _videoEl, duration: dur });
    }

    function _onEnded() {
        log('[VideoContext] ended. autoPlay=', _autoPlay, 'nextUrl=', !!_nextUrl, 'ad=', _adDetected);
        EventBus.emit('videoEnded');
        if (_autoPlay && _nextUrl && !_adDetected) { _cancelRedirect(); _doRedirect(); }
    }

    function _onSeeked() {
        if (!_videoEl) return;
        const cur = _videoEl.currentTime;
        if (cur > _lastTime + 5 && _seriesKey) {
            Storage.learnSkip(_seriesKey, _lastTime, cur, _videoEl.duration);
        }
        _lastTime = cur;
        EventBus.emit('seeked', { from: _lastTime, to: cur });

        if (!_autoPlay || !_nextUrl || _redirectScheduled || _adDetected) return;
        const dur = _videoEl.duration;
        if (dur && (dur - cur) <= _adaptiveThreshold() * 2) _startCountdown(Math.floor(dur - cur));
    }

    // ─── Polling tick ─────────────────────────────────────────────────────────
    function _tick() {
        if (!_videoEl || !_autoPlay || !_nextUrl || _redirectScheduled || _adDetected) return;
        const rem = _videoEl.duration - _videoEl.currentTime;
        if (rem <= _adaptiveThreshold() && rem > 0) _startCountdown(Math.floor(rem));
    }

    // ─── Public API ───────────────────────────────────────────────────────────
    /**
     * Attach to the <video> element. Called by entry.js after navigation.
     * Retries up to 5 seconds if video not yet in DOM.
     */
    function attach(seriesKey, opts = {}) {
        _seriesKey  = seriesKey;
        _autoPlay   = opts.autoPlay  ?? _autoPlay;
        _autoSkip   = opts.autoSkip  ?? _autoSkip;
        _nextUrl    = null;
        _lastTime   = -1;
        _redirectScheduled = false;
        _adDetected = false;

        _detachListeners();

        _videoEl = document.querySelector('video.html5-main-video');
        if (!_videoEl) {
            log('[VideoContext] video not found, retrying…');
            setTimeout(() => attach(seriesKey, opts), 1000);
            return;
        }
        log('[VideoContext] attached, duration:', _videoEl.duration);

        // Start polling
        if (_timeInterval) clearInterval(_timeInterval);
        _timeInterval = setInterval(_tick, 1000);

        _videoEl.addEventListener('loadedmetadata', _onLoadedMetadata);
        _videoEl.addEventListener('ended',          _onEnded);
        _videoEl.addEventListener('seeked',         _onSeeked);
        _onLoadedMetadata(); // handle already-loaded metadata

        // Auto-skip intro
        if (_autoSkip && seriesKey) {
            setTimeout(() => {
                const d = Storage.getSkipData(seriesKey);
                if (d.introAvg && _videoEl?.currentTime < d.introAvg) {
                    log('[VideoContext] auto-skip intro to', d.introAvg);
                    _videoEl.currentTime = d.introAvg;
                }
            }, 2000);
        }
    }

    function _detachListeners() {
        if (_timeInterval) { clearInterval(_timeInterval); _timeInterval = null; }
        if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
        if (_videoEl) {
            _videoEl.removeEventListener('loadedmetadata', _onLoadedMetadata);
            _videoEl.removeEventListener('ended',          _onEnded);
            _videoEl.removeEventListener('seeked',         _onSeeked);
        }
    }

    /** Called when next episode is found, so VideoContext knows where to redirect. */
    function setNextUrl(url) { _nextUrl = url; }

    /** Expose read-only ref for modules that genuinely need it (audio-mode, pip). */
    function getVideoEl() { return _videoEl; }

    function getDuration() { return _videoEl?.duration ?? 0; }

    function cancelRedirect() { _cancelRedirect(); }

    /** Update a flag without full re-attach. */
    function setFlag(key, value) {
        if (key === 'autoPlay') _autoPlay = value;
        if (key === 'autoSkip') _autoSkip = value;
        if (key === 'adDetected') {
            _adDetected = value;
            if (value) _cancelRedirect();
        }
    }

    /** Full teardown — call before re-navigation. */
    function detach() { _detachListeners(); _videoEl = null; }

    return { attach, detach, setNextUrl, getVideoEl, getDuration, setFlag, cancelRedirect };
})();

// ─── EventBus wiring (one-way: EventBus → VideoContext) ──────────────────────
EventBus.on('nextFound', ({ url }) => VideoContext.setNextUrl(url));
EventBus.on('adDetected', ({ detected }) => VideoContext.setFlag('adDetected', detected));
EventBus.on('modeChange', ({ key, value }) => {
    if (key === 'autoPlay' || key === 'autoSkip') VideoContext.setFlag(key, value);
});
