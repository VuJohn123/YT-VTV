function startAdBlocking() {
    if (adObserver) return;
    log('Ad blocking activated');
    adSkipInterval = setInterval(() => {
        try {
            const skips = ['.ytp-skip-ad-button', 'button[aria-label*="Skip"]', 'button[aria-label*="Bỏ qua"]'];
            for (const sel of skips) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetParent !== null) { btn.click(); log('Skipped ad'); break; }
            }
            const vp = document.querySelector('ytd-player');
            if (vp?.shadowRoot) {
                const sb = vp.shadowRoot.querySelector('.ytp-skip-ad-button');
                if (sb && sb.offsetParent !== null) { sb.click(); log('Skipped ad (shadow)'); }
            }
            if (videoEl && videoEl.duration && videoEl.duration < AD_MAX_DURATION && videoEl.duration > 0) {
                adVideoDetected = true;
                cancelRedirect();
                videoEl.currentTime = videoEl.duration - 0.1;
            } else adVideoDetected = false;
        } catch(e) {}
    }, 2000);

    const hideAds = () => {
        document.querySelectorAll('ytd-display-ad-renderer,ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer,ytd-banner-promo-renderer,ytd-statement-banner-renderer,.ytp-ad-overlay-container,.ytp-ad-player-overlay,.video-ads,#player-ads,#masthead-ad,#offer-module,#premium-offer,.ytd-rich-item-renderer-promo,ytd-merch-shelf-renderer,ytd-action-companion-ad-renderer').forEach(el => { el.style.display = 'none'; });
        document.querySelectorAll('iframe[src*="doubleclick"],iframe[src*="googleads"],iframe[src*="adservice"]').forEach(el => el.style.display = 'none');
    };
    adObserver = new MutationObserver(hideAds);
    adObserver.observe(document.body, { childList: true, subtree: true }); // KHÔNG dùng attributes:true (quá tốn hiệu năng)
    hideAds();
}

function stopAdBlocking() {
    if (adSkipInterval) { clearInterval(adSkipInterval); adSkipInterval = null; }
    if (adObserver) { adObserver.disconnect(); adObserver = null; }
    adVideoDetected = false;
}