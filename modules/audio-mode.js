// audio-mode.js - Audio Mode + Data Saver (tự động đặt chất lượng thấp nhất có thể)
let audioOverlay = null;
let previousQuality = null;

function initAudioMode() {
    if (!audioOverlay) {
        audioOverlay = document.createElement('div');
        audioOverlay.id = 'vtv-audio-overlay';
        audioOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:black;z-index:100;display:none;pointer-events:none;';
        const player = document.querySelector('#movie_player');
        if (player) {
            // Đảm bảo player có position relative để overlay hoạt động
            if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
            player.appendChild(audioOverlay);
        }
    }
}

async function setLowestQuality() {
    if (!videoEl) return;
    try {
        const settingsBtn = document.querySelector('.ytp-settings-button');
        if (!settingsBtn) return;
        
        // Mở menu settings
        settingsBtn.click();
        await new Promise(r => setTimeout(r, 400));
        
        // Tìm menu Quality
        const menuItems = document.querySelectorAll('.ytp-menuitem');
        let qualityMenu = null;
        for (const item of menuItems) {
            const label = item.querySelector('.ytp-menuitem-label');
            if (label && (label.textContent.includes('Chất lượng') || label.textContent.includes('Quality'))) {
                qualityMenu = item;
                break;
            }
        }
        
        if (qualityMenu) {
            qualityMenu.click();
            await new Promise(r => setTimeout(r, 400));
            
            // Tìm chất lượng thấp nhất
            const qualityOptions = document.querySelectorAll('.ytp-quality-menu .ytp-menuitem');
            let lowestOption = null;
            let lowestHeight = Infinity;
            
            for (const option of qualityOptions) {
                const label = option.querySelector('.ytp-menuitem-label');
                if (label) {
                    const text = label.textContent.trim();
                    const match = text.match(/(\d+)p/);
                    if (match) {
                        const height = parseInt(match[1]);
                        if (height < lowestHeight) {
                            lowestHeight = height;
                            lowestOption = option;
                        }
                    }
                }
            }
            
            if (lowestOption) {
                lowestOption.click();
                log('Set quality to lowest:', lowestHeight + 'p');
            }
        }
        
        // Đóng menu
        await new Promise(r => setTimeout(r, 200));
        settingsBtn.click();
    } catch (e) {
        warn('Failed to set lowest quality:', e);
    }
}

function enableAudioMode() {
    initAudioMode();
    if (audioOverlay) {
        audioOverlay.style.display = 'block';
        // Đảm bảo overlay phủ toàn bộ player
        const player = document.querySelector('#movie_player');
        if (player) {
            audioOverlay.style.width = player.offsetWidth + 'px';
            audioOverlay.style.height = player.offsetHeight + 'px';
        }
    }
    setLowestQuality();
    log('Audio Mode + Data Saver enabled (lowest quality)');
}

function disableAudioMode() {
    if (audioOverlay) {
        audioOverlay.style.display = 'none';
    }
    log('Audio Mode disabled');
}

function toggleAudioMode() {
    if (typeof audioMode !== 'undefined' && audioMode) {
        disableAudioMode();
        audioMode = false;
    } else {
        enableAudioMode();
        audioMode = true;
    }
    GM_setValue('vtvUlt_audioMode', audioMode);
}