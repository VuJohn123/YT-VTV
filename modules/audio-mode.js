// audio-mode.js - Audio Mode + Data Saver (ẩn player, đặt chất lượng thấp nhất)
let audioOverlay = null;

function initAudioMode() {
    if (!audioOverlay) {
        audioOverlay = document.createElement('div');
        audioOverlay.id = 'vtv-audio-overlay';
        audioOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:black;z-index:100;display:none;pointer-events:none;';
        // Tìm player container thực sự
        const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (player) {
            player.style.position = 'relative';
            player.appendChild(audioOverlay);
        }
    }
}

async function setLowestQuality() {
    if (!videoEl) return;
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
        settingsBtn.click(); // Đóng menu
        log('Set quality to', lowestHeight + 'p');
    } catch (e) {
        warn('Failed to set quality:', e);
    }
}

function enableAudioMode() {
    initAudioMode();
    if (audioOverlay) {
        audioOverlay.style.display = 'block';
        if (videoEl) videoEl.style.opacity = '0';
    }
    setLowestQuality();
    log('Audio Mode enabled');
}

function disableAudioMode() {
    if (audioOverlay) audioOverlay.style.display = 'none';
    if (videoEl) videoEl.style.opacity = '';
    log('Audio Mode disabled');
}