// adblock.js - Chặn quảng cáo YouTube

const AD_SELECTORS = [
    'ytd-display-ad-renderer', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer',
    'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer',
    'ytd-banner-promo-renderer', 'ytd-statement-banner-renderer',
    '.ytp-ad-overlay-container', '.ytp-ad-player-overlay', '.video-ads',
    '#player-ads', '#masthead-ad', '#offer-module', '#premium-offer',
    '.ytd-rich-item-renderer-promo', 'ytd-merch-shelf-renderer',
    'ytd-action-companion-ad-renderer',
].join(',');

const AD_IFRAME_SELECTORS = [
    'iframe[src*="doubleclick"]',
    'iframe[src*="googleads"]',
    'iframe[src*="adservice"]',
].join(',');

const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    'button[aria-label*="Skip"]',
    'button[aria-label*="Bỏ qua"]',
];

function hideAdElements() {
    document.querySelectorAll(AD_SELECTORS).forEach(el => { el.style.display = 'none'; });
    document.querySelectorAll(AD_IFRAME_SELECTORS).forEach(el => { el.style.display = 'none'; });
}

function startAdBlocking() {
    if (State.adObserver) return;
    log('Ad blocking activated');

    State.adSkipInterval = setInterval(() => {
        try {
            // Click nút skip nếu có
            for (const sel of SKIP_SELECTORS) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetParent !== null) { btn.click(); log('Skipped ad'); break; }
            }
            // Shadow DOM (một số YouTube layout)
            const vp = document.querySelector('ytd-player');
            if (vp?.shadowRoot) {
                const sb = vp.shadowRoot.querySelector('.ytp-skip-ad-button');
                if (sb && sb.offsetParent !== null) { sb.click(); log('Skipped ad (shadow)'); }
            }
            // Phát hiện video quảng cáo ngắn
            // Chỉ coi là ad nếu KHÔNG phải kênh đích (tránh cancel nhầm trailer hợp lệ)
            if (State.videoEl?.duration > 0 && State.videoEl.duration < AD_MAX_DURATION
                && State.channelName !== TARGET_CHANNEL) {
                State.adVideoDetected = true;
                cancelRedirect();
                State.videoEl.currentTime = State.videoEl.duration - 0.1;
            } else {
                State.adVideoDetected = false;
            }
        } catch(e) {}
    }, 200);

    // Chỉ observe childList + subtree — bỏ attributes để giảm tải CPU
    State.adObserver = new MutationObserver(hideAdElements);
    State.adObserver.observe(document.body, { childList: true, subtree: true });
    hideAdElements();
}

function stopAdBlocking() {
    if (State.adSkipInterval) { clearInterval(State.adSkipInterval); State.adSkipInterval = null; }
    if (State.adObserver)     { State.adObserver.disconnect();        State.adObserver = null; }
    State.adVideoDetected = false;
}
