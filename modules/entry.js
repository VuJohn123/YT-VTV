// entry.js — Layer 4: Orchestrator
// Fixes:
//   - Truyền videoId vào ChannelDetect.resolve() để per-video cache đúng
//   - Dùng isVTVChannel() thay vì exact string match
//   - Truyền seriesKey vào EpisodeEngine.run()
//   - flags được re-read mỗi navigation (không stale)

(function () {
    'use strict';

    let _runToken = 0; // tăng dần mỗi lần _runMain được gọi; dùng để huỷ run cũ
    let _lastVid  = null;

    window._vtvParsedInfo = null;

    // ─── One-time init ────────────────────────────────────────────────────────
    Storage.runMigrations(); // PHẢI chạy trước khi đọc bất kỳ flag nào bên dưới
    Storage.setupProfileMenu();
    Keyboard.setup();
    UI.init();

    GM_registerMenuCommand('🐛 Xem log lỗi', () => HistoryViewer.openErrorLog());

    // ─── Restore persisted feature states ────────────────────────────────────
    const _initFlags = Storage.getFeatureFlags();
    if (_initFlags.marathon)     { document.body.classList.add('vtv-marathon'); AdBlock.start(); }
    if (_initFlags.voiceEnabled) VoiceControl.start();
    if (_initFlags.pipEnabled)   AutoPiP.enable();
    if (_initFlags.audioMode)    AudioMode.enable();
    if (_initFlags.watchParty)   WatchParty.enable();

    // ─── Global EventBus wires (registered once) ──────────────────────────────

    // Prefetch next episode link
    EventBus.on('nextFound', ({ url }) => {
        const link = document.createElement('link');
        link.rel = 'prefetch'; link.href = url;
        document.head.appendChild(link);
    });

    // Save series progress
    EventBus.on('nextFound', ({ url, title }) => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode)
            Storage.saveSeries(window._vtvSeriesKey, window._vtvParsedInfo.episode, url, title);
    });

    // Stats on videoReady
    const _askedContinuePrompt = new Set();
    EventBus.on('videoReady', ({ duration }) => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode)
            Storage.addStats(window._vtvSeriesKey, window._vtvParsedInfo.episode, duration);

        // TV Mode: nếu đang kết nối với 1 TV, tự động phát video hiện tại
        // trên TV luôn — đúng chuẩn episode (TV luôn theo sát tập đang xem
        // trong trình duyệt, không cần user tự thao tác lại trên TV).
        if (TvMode.isConnected()) {
            const videoId = new URLSearchParams(location.search).get('v');
            const v = VideoContext.getVideoEl();
            if (videoId) {
                TvMode.playVideo(videoId, v?.currentTime || 0).catch(err => {
                    warn('[TvMode] Không sync được tập lên TV:', err.message);
                    EventBus.emit('voiceLabel', { text: '📺 Lỗi đồng bộ TV: ' + err.message });
                });
            }
        }

        // Continue-where-left-off: nếu có vị trí dở của TẬP KHÁC (không phải
        // tập đang mở), hỏi user có muốn xem nốt tập đó không. Chỉ hỏi 1 lần
        // mỗi lần vào trang (không lặp lại hỏi mỗi khi videoReady fire lại).
        const seriesKey = window._vtvSeriesKey;
        if (seriesKey && !_askedContinuePrompt.has(seriesKey)) {
            _askedContinuePrompt.add(seriesKey);
            const lastPos = Storage.getLastPosition(seriesKey);
            if (lastPos && lastPos.episode !== window._vtvParsedInfo?.episode) {
                UI.showContinuePrompt(lastPos);
            }
        }
    });

    // Lưu vị trí xem dở định kỳ (5s) — đủ để resume gần đúng mà không ghi
    // GM storage quá thường xuyên (mỗi lần ghi có chi phí I/O, không cần lưu
    // mỗi frame như _rafTick vốn phục vụ mục đích khác — auto-next countdown).
    setInterval(() => {
        const v = VideoContext.getVideoEl();
        const seriesKey = window._vtvSeriesKey;
        const episode   = window._vtvParsedInfo?.episode;
        if (!v || !seriesKey || !episode || v.paused) return;
        Storage.saveLastPosition(seriesKey, episode, v.currentTime, v.duration || 0, location.href);
    }, 5000);

    // Stats on ended
    EventBus.on('videoEnded', () => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode)
            Storage.addStats(window._vtvSeriesKey, window._vtvParsedInfo.episode, VideoContext.getDuration());
    });

    EventBus.on('cancelRedirect',   () => VideoContext.cancelRedirect());

    // Continue-where-left-off: navigate tới URL đã lưu, seek tới vị trí cũ
    // ngay khi video mới sẵn sàng. Dùng `once` để tự huỷ sau 1 lần — tránh
    // seek nhầm vào lần videoReady tiếp theo (ví dụ user tự chuyển tập khác
    // ngay sau đó) không liên quan gì tới yêu cầu continue này.
    EventBus.on('continueRequested', (lastPos) => {
        if (!lastPos?.url) return;
        EventBus.once('videoReady', () => {
            // Đợi 1 khoảng ngắn cho video thực sự có thể seek (readyState đủ),
            // tương tự cách auto-skip intro trong video-context.js đã làm.
            setTimeout(() => PlayerControl.seekTo(lastPos.currentTime), 500);
        });
        Navigator.goTo(lastPos.url);
    });
    EventBus.on('outOfOrderIgnored', () => {
        if (window._vtvSeriesKey) Storage.clearSeries(window._vtvSeriesKey);
        _runMain();
    });

    // UI rendering from engine events
    EventBus.on('prevFound',       (prev) => { window._vtvPrevEp = prev; });
    EventBus.on('nextFound',       ({ title, url, source }) => {
        UI.showFound(title, url, source, window._vtvPrevEp ?? null);
        UI.scrollToCurrentInPlaylist();
    });
    EventBus.on('nextNotFound',    () => {
        UI.showNotFound(window._vtvPrevEp ?? null);
        UI.scrollToCurrentInPlaylist();
    });
    EventBus.on('missingDetected', (m) => UI.appendMissingWarning(m));

    EventBus.on('modeChange', ({ key, value }) => {
        if (key === 'marathon') document.body.classList.toggle('vtv-marathon', value);
    });
    EventBus.on('channelReady', ({ channelName }) => log('[Entry] channel:', channelName));
    EventBus.on('seeked',       ({ from, to }) => log('[Entry] seeked', from, '→', to));
    EventBus.on('error',        ({ context, err }) => warn('[Entry] error in', context, err));

    // ─── Main per-navigation ──────────────────────────────────────────────────
    // Dùng run-token thay vì boolean guard: nếu navigation mới xảy ra trong lúc
    // run trước còn đang await (channel resolve, search, v.v.), run cũ tự huỷ
    // ở checkpoint gần nhất thay vì bị bỏ qua hoàn toàn (bug cũ: _running=true
    // khiến navigation B bị nuốt mất nếu nó tới trong lúc _runMain(A) đang await).
    async function _runMain() {
        const myToken = ++_runToken;
        const _stale  = () => myToken !== _runToken;

        window._vtvParsedInfo = null;
        window._vtvSeriesKey  = null;
        window._vtvPrevEp     = null;

        try {
            VideoContext.cancelRedirect();
            if (!UI.panel) UI.init();
            UI.showSearching();

            // 0. Attach NGAY LẬP TỨC (seriesKey=null) — TRƯỚC KHI biết đây có
            // phải VTV hay không. Trước đây VideoContext.attach() chỉ được
            // gọi SAU KHI xác nhận VTV + parse được tên tập (bước 7 cũ) —
            // nghĩa là các tính năng KHÔNG phụ thuộc VTV (PiP, Audio Mode,
            // Chapter Detector, Buffer Monitor, điều khiển voice cơ bản như
            // tạm dừng/tua/âm lượng) tuy hiện toggle "đã bật" nhưng KHÔNG BAO
            // GIỜ thực sự nhận được video để điều khiển nếu đang xem video
            // không phải VTV hoặc tiêu đề không parse được tên tập — toggle
            // bật mà vô tác dụng. Gọi attach() 2 lần cho CÙNG 1 video (ở đây
            // và lại ở bước 7 khi seriesKey thật đã biết) AN TOÀN: attach()
            // tự _detachListeners() trước khi re-attach nên không tạo listener
            // trùng; các module nghe 'videoReady' (PiP/AudioMode/WatchParty)
            // đã tự idempotent-check (bỏ qua nếu đã attach
            // đúng video rồi) nên không bị ảnh hưởng bởi lần attach thứ 2.
            VideoContext.attach(null, { autoPlay: false, autoSkip: false });

            // 1. Resolve channel — pass videoId for per-video dedup
            const videoId = new URLSearchParams(location.search).get('v') || '';
            const channel = await ChannelDetect.resolve(videoId); // {name, id}
            if (_stale()) return; // navigation mới đã xảy ra trong lúc await
            const channelName = channel.name;
            EventBus.emit('channelReady', { channelName, channelId: channel.id });

            if (!isVTVChannel(channelName, channel.id)) {
                UI.showWrongChannel(channelName);
                return; // VideoContext vẫn đã attach ở bước 0 — PiP/Audio/Voice/Buffer-monitor vẫn hoạt động bình thường
            }

            // 2. Video unavailability
            if (document.querySelector('ytd-message-renderer #message') ||
                document.body.innerText.includes('Video unavailable')) {
                UI.showUnavailable();
                return;
            }

            // 3. Parse title
            const rawTitle = (
                document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.getAttribute('title') ||
                document.title
            ).replace(/\s*-\s*YouTube$/, '').trim();

            const info = parseTitle(rawTitle);
            if (!info.episode) {
                const ap = getYouTubeAutoplay();
                if (ap) UI.showAutoplay(ap.title, ap.url);
                else    UI.showUnrecognized();
                return;
            }

            window._vtvParsedInfo = info;
            const seriesKey       = `${info.series}|S${info.season ?? 0}`;
            window._vtvSeriesKey  = seriesKey;
            EventBus.emit('episodeFound', { info, seriesKey });

            // 4. History
            Storage.addToHistory(seriesKey, info.episode, location.href, rawTitle);

            // 5. Out-of-order guard
            const stored = Storage.getSeries(seriesKey);
            if (stored?.lastEp) {
                const last = stored.lastEp;
                if (info.episode !== last && info.episode !== last + 1) {
                    UI.showOutOfOrder(info.episode, last + 1, stored.nextUrl);
                    return;
                }
            }

            // 6. Re-read flags each navigation (user may have toggled)
            const flags = Storage.getFeatureFlags();

            // 7. Attach video context
            VideoContext.attach(seriesKey, { autoPlay: flags.autoPlay, autoSkip: flags.autoSkip });

            // 7b. SponsorBlock — luôn disable trước (segment của video cũ
            // không được áp dụng nhầm sang video mới), rồi enable lại nếu
            // user đã bật tính năng này.
            SponsorBlock.disable();
            if (flags.sponsorBlock) SponsorBlock.enable(videoId);

            // 8. Episode discovery (nhiều await bên trong — check lại sau khi xong)
            await EpisodeEngine.run(info, channelName, seriesKey);
            if (_stale()) return;

        } catch (err) {
            if (_stale()) return; // lỗi từ 1 run đã bị huỷ, không cần báo
            warn('[Entry] uncaught:', err);
            Storage.logError('Entry:_runMain', err?.message || String(err));
            EventBus.emit('error', { context: 'main', err });
        }
    }

    // ─── SPA navigation detection ─────────────────────────────────────────────
    function _onNavigate() {
        if (location.pathname !== '/watch') return;
        const vid = new URLSearchParams(location.search).get('v');
        if (vid === _lastVid) return;

        // Debounce SPA double-fire
        const captured = vid;
        setTimeout(() => {
            if (new URLSearchParams(location.search).get('v') !== captured) return;
            _lastVid = captured;
            VideoContext.detach();
            _runMain();
        }, 600);
    }

    document.addEventListener('yt-navigate-finish', _onNavigate);

    // ─── Menu commands ──────────────────────────────────────────────────────
    GM_registerMenuCommand('📺 Xem lịch sử & Export', () => HistoryViewer.open());

    // Auto-downgrade quality khi buffering liên tục — bật mặc định vì rủi ro
    // thấp (chỉ hoạt động khi PlayerControl.getQuality() khả dụng, tự no-op
    // an toàn nếu không) và lợi ích rõ ràng (giảm giật lag trên mạng chậm).
    BufferMonitor.enable();

    // ─── Initial load ─────────────────────────────────────────────────────────
    if (location.pathname === '/watch') {
        const kick = () => setTimeout(_runMain, 600);
        document.readyState === 'loading'
            ? document.addEventListener('DOMContentLoaded', kick)
            : kick();
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────
    window.addEventListener('beforeunload', () => {
        AdBlock.stop();
        VoiceControl.stop();
        VideoContext.detach();
        ChannelDetect.clearCache();
    });

})();
