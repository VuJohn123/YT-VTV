// entry.js — Layer 4: Orchestrator
// Fixes:
//   - Truyền videoId vào ChannelDetect.resolve() để per-video cache đúng
//   - Dùng isVTVChannel() thay vì exact string match
//   - Truyền seriesKey vào EpisodeEngine.run()
//   - flags được re-read mỗi navigation (không stale)

(function () {
    'use strict';

    let _running = false;
    let _lastVid = null;

    window._vtvParsedInfo = null;

    // ─── One-time init ────────────────────────────────────────────────────────
    Storage.setupProfileMenu();
    Keyboard.setup();
    UI.init();

    // ─── Restore persisted feature states ────────────────────────────────────
    const _initFlags = Storage.getFeatureFlags();
    if (_initFlags.marathon)     { document.body.classList.add('vtv-marathon'); AdBlock.start(); }
    if (_initFlags.voiceEnabled) VoiceControl.start();
    if (_initFlags.pipEnabled)   AutoPiP.enable();
    if (_initFlags.audioMode)    AudioMode.enable();

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
    EventBus.on('videoReady', ({ duration }) => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode)
            Storage.addStats(window._vtvSeriesKey, window._vtvParsedInfo.episode, duration);
    });

    // Stats on ended
    EventBus.on('videoEnded', () => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode)
            Storage.addStats(window._vtvSeriesKey, window._vtvParsedInfo.episode, VideoContext.getDuration());
    });

    EventBus.on('cancelRedirect',   () => VideoContext.cancelRedirect());
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
    async function _runMain() {
        if (_running) return;
        _running = true;

        window._vtvParsedInfo = null;
        window._vtvSeriesKey  = null;
        window._vtvPrevEp     = null;

        try {
            VideoContext.cancelRedirect();
            if (!UI.panel) UI.init();
            UI.showSearching();

            // 1. Resolve channel — pass videoId for per-video dedup
            const videoId     = new URLSearchParams(location.search).get('v') || '';
            const channelName = await ChannelDetect.resolve(videoId);
            EventBus.emit('channelReady', { channelName });

            if (!isVTVChannel(channelName)) {
                UI.showWrongChannel(channelName);
                return;
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

            // 8. Episode discovery
            await EpisodeEngine.run(info, channelName, seriesKey);

        } catch (err) {
            warn('[Entry] uncaught:', err);
            EventBus.emit('error', { context: 'main', err });
        } finally {
            _running = false;
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
