// audio-mode.js - Audio mode (che video, giảm chất lượng)

function _getOrCreateOverlay() {
    // Kiểm tra overlay cũ còn attached không
    if (State._audioOverlay && State._audioOverlay.isConnected) return State._audioOverlay;

    State._audioOverlay = null;
    const player = document.querySelector('#movie_player');
    if (!player) return null;

    const overlay = document.createElement('div');
    overlay.id = 'vtv-audio-overlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:black;z-index:100;display:none;pointer-events:none;';
    player.appendChild(overlay);
    State._audioOverlay = overlay;
    return overlay;
}

function enableAudioMode() {
    const overlay = _getOrCreateOverlay();
    if (overlay) overlay.style.display = 'block';
    if (State.videoEl) {
        State.videoEl.style.width  = '1px';
        State.videoEl.style.height = '1px';
    }
    log('Audio mode enabled');
}

function disableAudioMode() {
    // Dùng _audioOverlay nếu còn connected, tìm lại trong DOM nếu không
    const overlay = (State._audioOverlay?.isConnected) ? State._audioOverlay : document.getElementById('vtv-audio-overlay');
    if (overlay) overlay.style.display = 'none';
    if (State.videoEl) {
        State.videoEl.style.width  = '';
        State.videoEl.style.height = '';
    }
    log('Audio mode disabled');
}

function toggleAudioMode() {
    State.audioMode = !State.audioMode;
    GM_setValue('vtvUlt_audioMode', State.audioMode);
    if (State.audioMode) enableAudioMode();
    else disableAudioMode();
}

// Reset overlay ref khi navigate (player bị recreate)
function resetAudioMode() {
    State._audioOverlay = null;
    if (State.audioMode) {
        // Re-apply vào player mới sau khi DOM ổn định
        setTimeout(enableAudioMode, 600);
    }
}
