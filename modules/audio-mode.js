let audioOverlay = null;
function initAudioMode() {
    if (!audioOverlay) {
        audioOverlay = document.createElement('div');
        audioOverlay.id = 'vtv-audio-overlay';
        audioOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:black;z-index:100;display:none;';
        const player = document.querySelector('#movie_player');
        if (player) player.appendChild(audioOverlay);
    }
}
function enableAudioMode() {
    initAudioMode();
    if (audioOverlay) audioOverlay.style.display = 'block';
    if (videoEl) { videoEl.style.width = '1px'; videoEl.style.height = '1px'; }
    log('Audio mode enabled');
}
function disableAudioMode() {
    if (audioOverlay) audioOverlay.style.display = 'none';
    if (videoEl) { videoEl.style.width = ''; videoEl.style.height = ''; }
    log('Audio mode disabled');
}
function toggleAudioMode() {
    if (audioMode) { disableAudioMode(); audioMode = false; }
    else { enableAudioMode(); audioMode = true; }
    GM_setValue('vtvUlt_audioMode', audioMode);
}