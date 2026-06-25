// video-context.js — Layer 2: Single owner of the <video> element
// Perf: dùng requestAnimationFrame thay vì setInterval 1s cho polling,
// tránh double attach khi YouTube re-renders video element.

const VideoContext = (() => {
    let _videoEl    = null;
    let _seriesKey  = null;
    let _autoPlay   = true;
    let _autoSkip   = false;
    let _adDetected = false;
    let _nextUrl    = null;
    let _lastTime   = -1;
    let _redirectScheduled = false;
    let _cdTotal    = 0;

    let _rafId       = null;
    let _cdInterval  = null;
    let _attachTimer = null;

    // ─── Redirect ─────────────────────────────────────────────────────────────
    function _cancelRedirect() {
        _redirectScheduled = false;
        if (_cdInterval) { clearInterval(_cdInterval); _cdInterval = null; }
        EventBus.emit('countdownCancel');
    }

    function _startCountdown(seconds) {
        if (!_autoPlay || !_nextUrl || _redirectScheduled || _adDetected || seconds <= 0) return;
        _redirectScheduled = true;
        _cdTotal = seconds;
        let rem = seconds;
        EventBus.emit('countdownStart', { total: seconds });
        EventBus.emit('countdownTick',  { remaining: rem, total: seconds });
        _cdInterval = setInterval(() => {
            rem--;
            EventBus.emit('countdownTick', { remaining: rem, total: _cdTotal });
            if (rem <= 0) {
                clearInterval(_cdInterval); _cdInterval = null;
                if (_nextUrl && !_adDetected) window.location.href = _nextUrl;
            }
        }, 1000);
    }

    function _threshold() {
        const d = _videoEl?.duration;
        if (!d || d < AD_MAX_DURATION) return 0;
        return Math.max(5, Math.min(25, Math.floor(d * 0.025)));
    }

    // ─── RAF polling (replaces setInterval 1s — more precise, no jank) ───────
    let _lastRafTime = 0;
    function _rafTick(now) {
        _rafId = requestAnimationFrame(_rafTick);
        // Throttle: check every ~800ms
        if (now - _lastRafTime < 800) return;
        _lastRafTime = now;

        if (!_videoEl || !_autoPlay || !_nextUrl || _redirectScheduled || _adDetected) return;
        const rem = (_videoEl.duration || 0) - _videoEl.currentTime;
        if (rem > 0 && rem <= _threshold()) _startCountdown(Math.floor(rem));
    }

    // ─── Video events ─────────────────────────────────────────────────────────
    function _onMeta() {
        const dur  = _videoEl?.duration ?? 0;
        const isAd = dur > 0 && dur < AD_MAX_DURATION;
        _adDetected = isAd;
        EventBus.emit('adDetected', { detected: isAd });
        if (!isAd) EventBus.emit('videoReady', { videoEl: _videoEl, duration: dur });
    }

    function _onEnded() {
        EventBus.emit('videoEnded');
        if (_autoPlay && _nextUrl && !_adDetected) {
            _cancelRedirect();
            window.location.href = _nextUrl;
        }
    }

    function _onSeeked() {
        if (!_videoEl) return;
        const cur = _videoEl.currentTime;
        if (_lastTime >= 0 && Math.abs(cur - _lastTime) > 5 && _seriesKey) {
            Storage.learnSkip(_seriesKey, _lastTime, cur, _videoEl.duration);
        }
        _lastTime = cur;
        EventBus.emit('seeked', { from: _lastTime, to: cur });

        // User scrubbed near end → start countdown
        if (!_autoPlay || !_nextUrl || _redirectScheduled || _adDetected) return;
        const rem = (_videoEl.duration || 0) - cur;
        if (rem > 0 && rem <= _threshold() * 2) _startCountdown(Math.floor(rem));
    }

    // ─── Attach ───────────────────────────────────────────────────────────────
    function _doAttach() {
        const el = document.querySelector('video.html5-main-video');
        if (!el) {
            // Retry up to 5s total (called from attach with retries)
            return false;
        }
        _videoEl = el;
        log('[VideoContext] attached, dur:', el.duration?.toFixed(1));

        el.addEventListener('loadedmetadata', _onMeta);
        el.addEventListener('ended',          _onEnded);
        el.addEventListener('seeked',         _onSeeked);
        if (el.readyState >= 1) _onMeta(); // already loaded

        // Auto-skip intro
        if (_autoSkip && _seriesKey) {
            const d = Storage.getSkipData(_seriesKey);
            if (d?.introAvg && el.currentTime < d.introAvg) {
                setTimeout(() => {
                    if (_videoEl && _videoEl.currentTime < d.introAvg) {
                        _videoEl.currentTime = d.introAvg;
                        log('[VideoContext] auto-skipped intro to', d.introAvg);
                    }
                }, 2000);
            }
        }

        if (_rafId) cancelAnimationFrame(_rafId);
        _rafId = requestAnimationFrame(_rafTick);
        return true;
    }

    function attach(seriesKey, opts = {}) {
        _seriesKey  = seriesKey;
        _autoPlay   = opts.autoPlay ?? _autoPlay;
        _autoSkip   = opts.autoSkip ?? _autoSkip;
        _nextUrl    = null; _lastTime = -1;
        _redirectScheduled = false; _adDetected = false;

        _detachListeners();

        let attempts = 0;
        const _try = () => {
            if (_doAttach()) return;
            if (++attempts < 10) _attachTimer = setTimeout(_try, 600);
            else warn('[VideoContext] video element not found after retries');
        };
        _try();
    }

    function _detachListeners() {
        if (_rafId)      { cancelAnimationFrame(_rafId); _rafId = null; }
        if (_cdInterval) { clearInterval(_cdInterval); _cdInterval = null; }
        if (_attachTimer){ clearTimeout(_attachTimer); _attachTimer = null; }
        if (_videoEl) {
            _videoEl.removeEventListener('loadedmetadata', _onMeta);
            _videoEl.removeEventListener('ended',          _onEnded);
            _videoEl.removeEventListener('seeked',         _onSeeked);
        }
    }

    function detach()        { _detachListeners(); _videoEl = null; }
    function setNextUrl(url) { _nextUrl = url; }
    function getVideoEl()    { return _videoEl; }
    function getDuration()   { return _videoEl?.duration ?? 0; }
    function cancelRedirect(){ _cancelRedirect(); }
    function setFlag(k, v)   {
        if (k === 'autoPlay')   _autoPlay   = v;
        if (k === 'autoSkip')   _autoSkip   = v;
        if (k === 'adDetected') { _adDetected = v; if (v) _cancelRedirect(); }
    }

    return { attach, detach, setNextUrl, getVideoEl, getDuration, cancelRedirect, setFlag };
})();

EventBus.on('nextFound',    ({ url })        => VideoContext.setNextUrl(url));
EventBus.on('adDetected',   ({ detected })   => VideoContext.setFlag('adDetected', detected));
EventBus.on('modeChange',   ({ key, value }) => {
    if (key === 'autoPlay' || key === 'autoSkip') VideoContext.setFlag(key, value);
});
