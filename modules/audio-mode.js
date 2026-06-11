// audio-mode.js - Audio Mode + Data Saver (overlay đen, ép chất lượng thấp nhất)
let audioOverlay = null;
let qualitySetAttempts = 0;

function initAudioMode() {
    if (audioOverlay) return;
    // Tạo overlay
    audioOverlay = document.createElement('div');
    audioOverlay.id = 'vtv-audio-overlay';
    audioOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:black;z-index:100;display:none;pointer-events:none;';
    // Gắn vào player container
    const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (player) {
        // Đảm bảo player có position relative
        if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
        player.appendChild(audioOverlay);
        log('Audio overlay attached to player');
    } else {
        // Thử lại sau 1 giây
        setTimeout(initAudioMode, 1000);
    }
}

async function setLowestQuality() {
    if (!videoEl) return;
    qualitySetAttempts++;
    log(`Attempting to set lowest quality (attempt ${qualitySetAttempts})`);

    // Cách 1: Dùng player API nếu có
    if (typeof window.yt !== 'undefined' && window.yt.getPlayer && typeof window.yt.getPlayer()?.setPlaybackQuality === 'function') {
        try {
            const player = window.yt.getPlayer();
            const available = player.getAvailableQualityLevels();
            if (available && available.length) {
                const lowest = available[available.length - 1]; // thường là tiny hoặc 144p
                player.setPlaybackQuality(lowest);
                log('Set quality via yt API to', lowest);
                return;
            }
        } catch(e) {}
    }

    // Cách 2: Mở menu cài đặt và chọn chất lượng thấp nhất
    try {
        const settingsBtn = document.querySelector('.ytp-settings-button');
        if (!settingsBtn) return;
        settingsBtn.click();
        await new Promise(r => setTimeout(r, 500));

        // Tìm menu Quality
        const menuItems = document.querySelectorAll('.ytp-menuitem');
        for (const item of menuItems) {
            const label = item.querySelector('.ytp-menuitem-label');
            if (label && (label.textContent.includes('Chất lượng') || label.textContent.includes('Quality'))) {
                item.click();
                await new Promise(r => setTimeout(r, 300));
                break;
            }
        }

        // Lấy danh sách chất lượng và chọn thấp nhất
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
        if (lowest) {
            lowest.click();
            log('Set quality from menu to', lowestHeight + 'p');
        }
        await new Promise(r => setTimeout(r, 200));
        settingsBtn.click(); // Đóng menu
    } catch(e) {
        warn('Failed to set quality from menu:', e);
    }

    // Cách 3: Nếu vẫn không được, thử giả lập sự kiện click vào menu
    // Có thể thử lại sau
    if (qualitySetAttempts < 5) {
        setTimeout(setLowestQuality, 2000);
    }
}

function enableAudioMode() {
    initAudioMode();
    if (audioOverlay) {
        audioOverlay.style.display = 'block';
        if (videoEl) {
            videoEl.style.opacity = '0'; // Ẩn video
        }
    } else {
        // Nếu chưa có overlay, thử lại
        setTimeout(() => enableAudioMode(), 500);
        return;
    }
    qualitySetAttempts = 0;
    setLowestQuality();
    log('Audio Mode enabled');
}

function disableAudioMode() {
    if (audioOverlay) {
        audioOverlay.style.display = 'none';
        if (videoEl) {
            videoEl.style.opacity = '';
        }
    }
    qualitySetAttempts = 0;
    log('Audio Mode disabled');
}