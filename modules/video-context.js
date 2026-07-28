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
    let _lateObserver = null; // MutationObserver dự phòng khi video chưa xuất hiện sau retry cố định

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
                if (_nextUrl && !_adDetected) Navigator.goTo(_nextUrl);
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

        // Self-heal chủ động: nếu _videoEl đã bị gỡ khỏi DOM (extension khác
        // như YouTube-JS-Engine-Tamer / Playback-Position-Saver thao tác lại
        // player) mà không thông qua yt-navigate-finish, phát hiện ngay ở đây
        // thay vì đợi tới lần getVideoEl() kế tiếp bị gọi.
        if (_videoEl && !_videoEl.isConnected) {
            const el = document.querySelector('video.html5-main-video');
            if (el) _rebind(el); else _videoEl = null;
        }

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
            Navigator.goTo(_nextUrl);
        }
    }

    function _onSeeked() {
        if (!_videoEl) return;
        const cur = _videoEl.currentTime;
        if (_lastTime >= 0 && Math.abs(cur - _lastTime) > 5 && _seriesKey) {
            Storage.learnSkip(_seriesKey, _lastTime, cur, _videoEl.duration);
        }
        const from = _lastTime;
        _lastTime = cur;
        EventBus.emit('seeked', { from, to: cur });

        // User scrubbed near end → start countdown
        if (!_autoPlay || !_nextUrl || _redirectScheduled || _adDetected) return;
        const rem = (_videoEl.duration || 0) - cur;
        if (rem > 0 && rem <= _threshold() * 2) _startCountdown(Math.floor(rem));
    }

    // ─── Attach / Rebind ───────────────────────────────────────────────────────
    /**
     * Gắn listener lên 1 <video> element và cập nhật _videoEl. Dùng chung cho
     * cả attach lần đầu (_doAttach) VÀ self-heal (khi _videoEl bị null hoá
     * hoặc mất kết nối DOM ngoài ý muốn — xem getVideoEl()/_rafTick()).
     * KHÔNG reset _seriesKey/_nextUrl/_lastTime — giữ nguyên state playlist
     * hiện có, vì self-heal thường xảy ra GIỮA 1 tập phim, không phải chuyển
     * tập (chuyển tập thật sự đi qua attach() ở entry.js, nơi state được
     * reset đầy đủ).
     */
    function _rebind(el) {
        if (_videoEl && _videoEl !== el) {
            _videoEl.removeEventListener('loadedmetadata', _onMeta);
            _videoEl.removeEventListener('ended',          _onEnded);
            _videoEl.removeEventListener('seeked',         _onSeeked);
        }
        const wasHealing = !!_videoEl && _videoEl !== el;
        _videoEl = el;
        el.addEventListener('loadedmetadata', _onMeta);
        el.addEventListener('ended',          _onEnded);
        el.addEventListener('seeked',         _onSeeked);
        if (el.readyState >= 1) _onMeta(); // already loaded

        if (_rafId) cancelAnimationFrame(_rafId);
        _rafId = requestAnimationFrame(_rafTick);

        if (wasHealing) {
            // Video element thực sự đã đổi tham chiếu (không chỉ là lần
            // attach đầu) — báo lại videoReady để các module SPA-aware khác
            // (WatchParty, AudioMode, ChapterDetector, BufferMonitor, AutoPiP)
            // re-attach theo đúng nguyên tắc #3, tránh chúng cầm tham chiếu
            // <video> cũ đã chết.
            warn('[VideoContext] self-heal: video element đã đổi/mất tham chiếu, gắn lại thành công');
            EventBus.emit('videoReady', { videoEl: el, duration: el.duration || 0 });
        } else {
            log('[VideoContext] attached, dur:', el.duration?.toFixed(1));
        }
    }

    function _doAttach() {
        const el = document.querySelector('video.html5-main-video');
        if (!el) return false; // Retry (called from attach with retries, or via MutationObserver fallback)
        _rebind(el);

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
        return true;
    }

    /**
     * Fallback khi video không xuất hiện sau các lần retry cố định (6s) của
     * attach(). Trước đây tại đây script BỎ CUỘC vĩnh viễn cho tới lần
     * yt-navigate-finish kế tiếp — đây chính là root cause của bug "⚠️ Không
     * tìm thấy video" dù user đang xem phim bình thường: nếu extension khác
     * (YouTube-JS-Engine-Tamer, YouTube-Playback-Position-Saver...) khiến
     * YouTube dựng lại <video> chậm hơn 6s, hoặc can thiệp DOM khiến
     * selector không khớp đúng lúc retry cuối, _videoEl bị kẹt ở null mãi
     * mãi dù video thật sự đã phát được. Dùng MutationObserver không giới
     * hạn thời gian để bắt được video bất kể nó xuất hiện trễ bao lâu.
     */
    function _watchForLateVideo() {
        if (_lateObserver) _lateObserver.disconnect();
        _lateObserver = new MutationObserver(() => {
            const el = document.querySelector('video.html5-main-video');
            if (el) {
                _lateObserver.disconnect();
                _lateObserver = null;
                _doAttach();
            }
        });
        _lateObserver.observe(document.body, { childList: true, subtree: true });
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
            if (++attempts < 10) { _attachTimer = setTimeout(_try, 600); return; }
            warn('[VideoContext] video element not found after 6s retry — chuyển sang MutationObserver không giới hạn thời gian');
            _watchForLateVideo();
        };
        _try();
    }

    function _detachListeners() {
        if (_rafId)      { cancelAnimationFrame(_rafId); _rafId = null; }
        if (_cdInterval) { clearInterval(_cdInterval); _cdInterval = null; }
        if (_attachTimer){ clearTimeout(_attachTimer); _attachTimer = null; }
        if (_lateObserver){ _lateObserver.disconnect(); _lateObserver = null; }
        if (_videoEl) {
            _videoEl.removeEventListener('loadedmetadata', _onMeta);
            _videoEl.removeEventListener('ended',          _onEnded);
            _videoEl.removeEventListener('seeked',         _onSeeked);
        }
    }

    function detach()        { _detachListeners(); _videoEl = null; }
    function setNextUrl(url) { _nextUrl = url; }
    /**
     * Self-heal on demand: nếu _videoEl null/mất kết nối DOM tại thời điểm
     * gọi (ví dụ VoiceControl vừa bấm phím V ngay lúc _rafTick's 800ms
     * throttle chưa kịp check), thử tìm lại NGAY trước khi trả null — không
     * đợi tick tiếp theo. Đây là lớp phòng thủ cuối cùng đảm bảo
     * PlayerControl.play()/pause() (dựa hoàn toàn vào hàm này) không báo sai
     * "không tìm thấy video" khi video thực sự đang tồn tại trên trang.
     */
    function getVideoEl() {
        if (_videoEl && _videoEl.isConnected) return _videoEl;
        const el = document.querySelector('video.html5-main-video');
        if (el) _rebind(el);
        else if (_videoEl) _videoEl = null; // tham chiếu cũ chết hẳn, không tìm được thay thế
        return _videoEl;
    }
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
