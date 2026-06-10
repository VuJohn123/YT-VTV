// ==UserScript==
// @name         VTV Giải Trí Ultimate
// @namespace    https://github.com/VuJohn123/YT-VTV
// @version      8.0
// @description  Popup UI, voice nâng cấp, fix tìm tập. Marathon, PiP, audio mode...
// @author       VuJohn123
// @match        https://www.youtube.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        unsafeWindow
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/utils.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/channel-detect.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/search.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/episode-navigator.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/storage.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/adblock.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/smart-features.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/keyboard.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/detectors.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/audio-mode.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/pip.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/virtual-playlist.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/stats.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/missing-detector.js
// @updateURL    https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/vtv-ultimate.user.js
// @downloadURL  https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/vtv-ultimate.user.js
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    let popupWindow = null;
    let popupReady = false;
    const messageQueue = [];

    function sendToPopup(msg) {
        if (popupWindow && popupReady) {
            popupWindow.postMessage({ type: 'vtv-cmd', data: msg }, '*');
        } else {
            messageQueue.push(msg);
        }
    }

    function openPopup() {
        if (popupWindow && !popupWindow.closed) {
            popupWindow.focus();
            return;
        }
        const url = 'https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/ui-popup.html';
        popupWindow = window.open(url, 'vtv_popup', 'width=400,height=600,resizable,scrollbars=no,status=no,location=no,toolbar=no,menubar=no');
        if (!popupWindow) {
            log('Popup bị chặn, hãy cho phép popup cho trang này.');
            return;
        }
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'vtv-ready') {
                popupReady = true;
                log('Popup ready');
                while (messageQueue.length) {
                    popupWindow.postMessage({ type: 'vtv-cmd', data: messageQueue.shift() }, '*');
                }
            } else if (e.data && e.data.type === 'vtv-action') {
                handlePopupAction(e.data.data);
            }
        });
    }

    function handlePopupAction(action) {
        log('Popup action:', action);
        switch (action.action) {
            case 'skip': if (nextUrl) window.location.href = nextUrl; break;
            case 'prev': if (previousEp?.url) window.location.href = previousEp.url; break;
            case 'cancel': cancelRedirect(); break;
            case 'toggleAuto': autoPlay = action.value; GM_setValue('vtvUlt_auto', autoPlay); break;
            case 'toggleMarathon': marathon = action.value; GM_setValue('vtvUlt_marathon', marathon); if (marathon) { document.body.classList.add('vtv-marathon'); startAdBlocking(); } else { document.body.classList.remove('vtv-marathon'); stopAdBlocking(); } break;
            case 'toggleAutoSkip': autoSkip = action.value; GM_setValue('vtvUlt_autoskip', autoSkip); break;
            case 'toggleVoice': voiceEnabled = action.value; GM_setValue('vtvUlt_voice', voiceEnabled); if (voiceEnabled) startVoiceControl(); else stopVoiceControl(); break;
            case 'toggleAudio': audioMode = action.value; GM_setValue('vtvUlt_audioMode', audioMode); if (audioMode) enableAudioMode(); else disableAudioMode(); break;
            case 'togglePiP': pipEnabled = action.value; GM_setValue('vtvUlt_pip', pipEnabled); if (pipEnabled) enableAutoPiP(); else disableAutoPiP(); break;
            case 'goCorrect': if (action.url) window.location.href = action.url; break;
            case 'stay': clearSeries(seriesKey); main(); break;
            case 'manualSearch': handleManualSearch(action.query); break;
        }
    }

    async function handleManualSearch(query) {
        const results = await searchYT(query);
        sendToPopup({ action: 'showManualResults', results });
    }

    async function main() {
        cancelRedirect();
        nextUrl = null; nextTitle = ''; previousEp = null; episodeList = [];
        adVideoDetected = false;

        channelName = await waitForChannel();
        if (channelName !== TARGET_CHANNEL) {
            sendToPopup({ action: 'setTitle', text: '❌ Sai kênh' });
            sendToPopup({ action: 'setBody', html: `<div>Kênh hiện tại: ${channelName || 'không xác định'}</div>` });
            return;
        }

        const rawTitle = (document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.getAttribute('title') || document.title)
            .replace(/\s*-\s*YouTube$/, '').trim();
        log('Raw title:', rawTitle);

        if (document.querySelector('ytd-message-renderer #message') || document.body.innerText.includes('Video unavailable')) {
            sendToPopup({ action: 'setTitle', text: '⚠️ Video không khả dụng' });
            sendToPopup({ action: 'setBody', html: '<div>Video bị gỡ hoặc riêng tư.</div>' });
            return;
        }

        const info = parseTitle(rawTitle);
        if (!info.episode) {
            const ap = getYouTubeAutoplay();
            if (ap) {
                sendToPopup({ action: 'showAutoplay', title: ap.title, url: ap.url, toggles: { autoPlay, marathon, autoSkip, voiceEnabled, audioMode, pipEnabled } });
                nextUrl = ap.url; nextTitle = ap.title;
            } else {
                sendToPopup({ action: 'setTitle', text: '❌ Không nhận dạng được tập phim' });
            }
            setupMonitoring();
            return;
        }

        parsedInfo = info;
        seriesKey = `${info.series}|S${info.season ?? 0}`;
        addToHistory(seriesKey, info.episode, location.href, rawTitle);

        const stored = getStoredSeries(seriesKey);
        if (stored) {
            const lastWatched = stored.lastEp;
            if (info.episode === lastWatched) {
                log('Reload');
            } else if (info.episode === lastWatched + 1) {
                log('Next');
            } else {
                sendToPopup({ action: 'showOutOfOrder', current: info.episode, expected: lastWatched + 1, url: stored.nextUrl });
                return;
            }
        }

        const epType = detectEpisodeType(rawTitle);
        let desc = '';
        try { desc = (unsafeWindow.ytInitialPlayerResponse?.videoDetails?.shortDescription) || ''; } catch(e) {}
        const genres = detectGenres(desc);
        updateSeriesStats(seriesKey, videoEl?.duration || 0);

        previousEp = await findPrevious(info, channelName);
        episodeList = await findEpisodeList(info, channelName);
        const next = await findNext(info, channelName);

        if (next) {
            nextUrl = next.url; nextTitle = next.title;
            const link = document.createElement('link'); link.rel = 'prefetch'; link.href = nextUrl; document.head.appendChild(link);
            storeSeries(seriesKey, info.episode, nextUrl, nextTitle);
            sendToPopup({ action: 'showFound', title: nextTitle, url: nextUrl, source: next.source, previousEp, episodeList, toggles: { autoPlay, marathon, autoSkip, voiceEnabled, audioMode, pipEnabled } });
        } else {
            sendToPopup({ action: 'showNotFound', toggles: { autoPlay, marathon, autoSkip, voiceEnabled, audioMode, pipEnabled } });
            const ap = getYouTubeAutoplay();
            if (ap) { nextUrl = ap.url; nextTitle = ap.title; }
        }

        const missing = detectMissingEpisodes(episodeList);
        if (missing.episodes.length || missing.segments.length) {
            sendToPopup({ action: 'showMissing', missing });
        }

        setupMonitoring();
        scrollToCurrentInPlaylist();

        if (voiceEnabled) startVoiceControl();
        if (audioMode) enableAudioMode();
        if (pipEnabled) enableAutoPiP();
    }

    function onNavigate() {
        if (location.pathname !== '/watch') return;
        const vid = new URLSearchParams(location.search).get('v');
        if (vid === lastVid) return;
        lastVid = vid;
        main();
    }

    setupProfiles();
    setupKeyboardShortcuts();
    openPopup();
    document.addEventListener('yt-navigate-finish', onNavigate);

    if (location.pathname === '/watch') {
        const checkPopupInterval = setInterval(() => {
            if (popupReady) {
                clearInterval(checkPopupInterval);
                main();
            }
        }, 500);
    }
    if (marathon) { document.body.classList.add('vtv-marathon'); startAdBlocking(); }
    window.addEventListener('beforeunload', () => {
        stopAdBlocking();
        if (voiceRecognition) voiceRecognition.stop();
    });
})();