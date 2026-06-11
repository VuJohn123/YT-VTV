// audio-mode.js - Audio Mode + Data Saver (ép chất lượng thấp nhất, che video)
let audioOverlay = null;
let originalVolume = 1;

function initAudioMode() {
    if (!audioOverlay) {
        audioOverlay = document.createElement('div');
        audioOverlay.id = 'vtv-audio-overlay';
        audioOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:black;z-index:100;display:none;pointer-events:none;';
        // Gắn vào player container
        const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (player) {
            player.style.position = 'relative';
            player.appendChild(audioOverlay);
        }
    }
}

function setLowestQualityViaAPI() {
    // Cách 1: Dùng player API nếu có
    if (typeof yt !== 'undefined' && yt.getPlayer) {
        try {
            const player = yt.getPlayer();
            if (player && player.setPlaybackQuality) {
                player.setPlaybackQuality('tiny'); // hoặc '144p'
                log('Set quality via yt API');
                return;
            }
        } catch(e) {}
    }
    // Cách 2: Truy cập trực tiếp video element và thay đổi src (không khả thi lắm)
    // Cách 3: Mở menu cài đặt (đã có trước)
    return setLowestQualityFromMenu();
}

async function setLowestQualityFromMenu() {
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
    initAudioMode();
    if (audioOverlay) {
        audioOverlay.style.display = 'block';
        if (videoEl) {
            // Che video
            videoEl.style.opacity = '0';
            // Lưu âm lượng hiện tại (giữ nguyên âm lượng)
            originalVolume = videoEl.volume;
        }
    }
    // Ép chất lượng thấp nhất
    setLowestQualityViaAPI();
    log('Audio Mode enabled');
}

function disableAudioMode() {
    if (audioOverlay) {
        audioOverlay.style.display = 'none';
        if (videoEl) {
            videoEl.style.opacity = '';
            // Khôi phục âm lượng (nhưng không cần thiết)
        }
    }
    log('Audio Mode disabled');
}