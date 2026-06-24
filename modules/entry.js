// entry.js — Layer 4: Orchestrator / Entry point
// Thin shell: wire navigation events, call modules in order, reset cleanly.
// Tất cả business logic nằm trong các layer dưới.

(function () {
    'use strict';

    // ─── Session state (scoped to current navigation, reset each time) ────────
    let _running = false;
    let _lastVid = null;

    // Expose parsedInfo for keyboard shortcut module (read-only reference)
    window._vtvParsedInfo = null;

    // ─── One-time setup ───────────────────────────────────────────────────────
    Storage.setupProfileMenu();
    Keyboard.setup();
    UI.init();

    // Restore marathon mode
    const flags = Storage.getFeatureFlags();
    if (flags.marathon) {
        document.body.classList.add('vtv-marathon');
        AdBlock.start();
    }
    if (flags.voiceEnabled) VoiceControl.start();
    if (flags.pipEnabled)   AutoPiP.enable();
    if (flags.audioMode)    AudioMode.enable();

    // ─── EventBus wiring for cross-cutting concerns ───────────────────────────

    // When next episode is found → prefetch link
    EventBus.on('nextFound', ({ url }) => {
        const link = document.createElement('link');
        link.rel  = 'prefetch';
        link.href = url;
        document.head.appendChild(link);
    });

    // When out-of-order is dismissed → re-run
    EventBus.on('outOfOrderIgnored', () => {
        if (window._vtvSeriesKey) Storage.clearSeries(window._vtvSeriesKey);
        _runMain();
    });

    // Cancel redirect bubbles from UI cancel button
    EventBus.on('cancelRedirect', () => VideoContext.cancelRedirect());

    // Channel resolved — could be used for future analytics/logging
    EventBus.on('channelReady', ({ channelName }) => {
        log('[Entry] channel:', channelName);
    });

    // Video ended — save partial stats
    EventBus.on('videoEnded', () => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode) {
            const dur = VideoContext.getDuration();
            Storage.addStats(window._vtvSeriesKey, window._vtvParsedInfo.episode, dur);
        }
    });

    // Seeked — learning hook already handled inside VideoContext
    // Exposed on bus so future modules (e.g. heatmap) can react without patching VideoContext
    EventBus.on('seeked', ({ from, to }) => {
        log('[Entry] seeked', from, '→', to);
    });

    // Error — surface to UI
    EventBus.on('error', ({ context, err }) => {
        warn('[Entry] error in', context, err);
    });

    // Marathon mode side-effects
    EventBus.on('modeChange', ({ key, value }) => {
        if (key !== 'marathon') return;
        // AdBlock handles its own start/stop via its own EventBus listener.
        // entry.js only needs to update the class:
        document.body.classList.toggle('vtv-marathon', value);
    });

    // Stats: record duration when video is ready
    EventBus.on('videoReady', ({ duration }) => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode) {
            Storage.addStats(window._vtvSeriesKey, window._vtvParsedInfo.episode, duration);
        }
    });

    // Store series state when next is found
    EventBus.on('nextFound', ({ url, title }) => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode) {
            Storage.saveSeries(window._vtvSeriesKey, window._vtvParsedInfo.episode, url, title);
        }
    });

    // Render UI states from EpisodeEngine events
    EventBus.on('nextFound', ({ title, url, source }) => {
        const prev = window._vtvPrevEp ?? null;
        UI.showFound(title, url, source, prev);
        UI.scrollToCurrentInPlaylist();
    });
    EventBus.on('nextNotFound', () => {
        const prev = window._vtvPrevEp ?? null;
        UI.showNotFound(prev);
        UI.scrollToCurrentInPlaylist();
    });
    EventBus.on('prevFound', (prev) => {
        window._vtvPrevEp = prev;
    });
    EventBus.on('missingDetected', (missing) => {
        UI.appendMissingWarning(missing);
    });

    // ─── Main per-navigation logic ────────────────────────────────────────────
    async function _runMain() {
        if (_running) return;
        _running = true;

        // Reset nav state
        window._vtvParsedInfo = null;
        window._vtvSeriesKey  = null;
        window._vtvPrevEp     = null;

        try {
            VideoContext.cancelRedirect();

            // 1. Ensure panel is visible
            if (!UI.panel) UI.init();

            UI.showSearching();

            // 2. Wait for channel
            const channelName = await ChannelDetect.resolve();
            EventBus.emit('channelReady', { channelName });

            if (channelName !== TARGET_CHANNEL) {
                UI.showWrongChannel(channelName);
                return;
            }

            // 3. Detect video unavailability
            if (document.querySelector('ytd-message-renderer #message') ||
                document.body.innerText.includes('Video unavailable')) {
                UI.showUnavailable();
                return;
            }

            // 4. Parse title
            const rawTitle = (
                document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.getAttribute('title') ||
                document.title
            ).replace(/\s*-\s*YouTube$/, '').trim();
            log('[Entry] raw title:', rawTitle);

            const info = parseTitle(rawTitle);

            if (!info.episode) {
                // Not a recognizable episode — show YouTube autoplay suggestion
                const ap = getYouTubeAutoplay();
                if (ap) UI.showAutoplay(ap.title, ap.url);
                else    UI.showUnrecognized();
                return;
            }

            window._vtvParsedInfo = info;
            const seriesKey       = `${info.series}|S${info.season ?? 0}`;
            window._vtvSeriesKey  = seriesKey;

            EventBus.emit('episodeFound', { info, seriesKey });

            // 5. History
            Storage.addToHistory(seriesKey, info.episode, location.href, rawTitle);

            // 6. Out-of-order guard
            const stored = Storage.getSeries(seriesKey);
            if (stored) {
                const last = stored.lastEp;
                if (info.episode !== last && info.episode !== last + 1) {
                    UI.showOutOfOrder(info.episode, last + 1, stored.nextUrl);
                    return;
                }
            }

            // 7. Attach VideoContext to <video> element
            VideoContext.attach(seriesKey, {
                autoPlay: flags.autoPlay,
                autoSkip: flags.autoSkip,
            });

            // 8. Episode discovery (async — fires events when ready)
            await EpisodeEngine.run(info, channelName);

        } catch (err) {
            warn('[Entry] uncaught error in main:', err);
            EventBus.emit('error', { context: 'main', err });
        } finally {
            // Always release the lock — even on thrown exceptions
            _running = false;
        }
    }

    // ─── Navigation detection ─────────────────────────────────────────────────
    function _onNavigate() {
        if (location.pathname !== '/watch') return;
        const vid = new URLSearchParams(location.search).get('v');
        if (vid === _lastVid) return;

        // Debounce: confirm URL hasn't changed again in 800ms (SPA navigation quirk)
        setTimeout(() => {
            if (new URLSearchParams(location.search).get('v') !== vid) return;
            _lastVid = vid;

            // Detach old video listeners before new navigation
            VideoContext.detach();

            _runMain();
        }, 800);
    }

    document.addEventListener('yt-navigate-finish', _onNavigate);

    // ─── Initial page load ────────────────────────────────────────────────────
    if (location.pathname === '/watch') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(_runMain, 500));
        } else {
            setTimeout(_runMain, 500);
        }
    }

    // ─── Cleanup on unload ────────────────────────────────────────────────────
    window.addEventListener('beforeunload', () => {
        AdBlock.stop();
        VoiceControl.stop();
        VideoContext.detach();
    });

})();
