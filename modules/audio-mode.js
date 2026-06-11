// audio-mode.js - Audio Mode + Data Saver (chỉ can thiệp khi bật, khôi phục khi tắt)
let audioOverlay = null;
let previousQuality = null;

function initAudioMode() {
    if (audioOverlay) return;
    audioOverlay = document.createElement('div');
    audioOverlay.id = 'vtv-audio-overlay';
    audioOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:black;z-index:100;display:none;pointer-events:none;';
    const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (player) {
        if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
        player.appendChild(audioOverlay);
    } else {
        setTimeout(initAudioMode, 1000);
    }
}

async function setLowestQuality() {
    if (!audioMode || !videoEl) return; // chỉ hạ chất lượng khi Audio Mode đang bật
    if (previousQuality === null && typeof window.yt?.getPlayer?.().getPlaybackQuality === 'function') {
        try { previousQuality = window.yt.getPlayer().getPlaybackQuality(); } catch(e) {}
    }
    // thử API player trước
    try {
        if (typeof window.yt?.getPlayer?.().setPlaybackQuality === 'function') {
            const available = window.yt.getPlayer().getAvailableQualityLevels();
            if (available && available.length) {
                const lowest = available[available.length - 1];
                window.yt.getPlayer().setPlaybackQuality(lowest);
                log('Set quality via yt API to', lowest);
                return;
            }
        }
    } catch(e) {}
    // fallback: mở menu cài đặt
    try {
        const settingsBtn = document.querySelector('.ytp-settings-button');
        if (!settingsBtn) return;
        settingsBtn.click();
        await new Promise(r => setTimeout(r, 500));
        const menuItems = document.querySelectorAll('.ytp-menuitem');
        for (const item of menuItems) {
            const label = item.querySelector('.ytp-menuitem-label');
            if (label && (label.textContent.includes('Chất lượng') || label.textContent.includes('Quality'))) {
                item.click();
                await new Promise(r => setTimeout(r, 300));
                break;
            }
        }
        const qualityOptions = document.querySelectorAll('.ytp-quality-menu .ytp-menuitem');
        let lowest = null, lowestHeight = Infinity;
        for (const opt of qualityOptions) {
            const label = opt.querySelector('.ytp-menuitem-label');
            if (label) {
                const match = label.textContent.match(/(\d+)p/);
                if (match) {
                    const h = parseInt(match[1]);
                    if (h < lowestHeight) { lowestHeight = h; lowest = opt; }
                }
            }
        }
        if (lowest) lowest.click();
        await new Promise(r => setTimeout(r, 200));
        settingsBtn.click();
        log('Set quality from menu to', lowestHeight + 'p');
    } catch(e) {
        warn('Failed to set quality from menu:', e);
    }
}

function enableAudioMode() {
    if (audioMode) return;
    audioMode = true;
    GM_setValue('vtvUlt_audioMode', audioMode);
    initAudioMode();
    if (audioOverlay) {
        audioOverlay.style.display = 'block';
        if (videoEl) videoEl.style.opacity = '0';
    }
    setLowestQuality();
    log('Audio Mode enabled');
}

function disableAudioMode() {
    if (!audioMode) return;
    audioMode = false;
    GM_setValue('vtvUlt_audioMode', audioMode);
    if (audioOverlay) {
        audioOverlay.style.display = 'none';
        if (videoEl) videoEl.style.opacity = '';
    }
    if (previousQuality && typeof window.yt?.getPlayer?.().setPlaybackQuality === 'function') {
        try { window.yt.getPlayer().setPlaybackQuality(previousQuality); log('Restored quality to', previousQuality); } catch(e) {}
    }
    previousQuality = null;
    log('Audio Mode disabled');
}