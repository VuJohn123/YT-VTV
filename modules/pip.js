// pip.js - Auto PiP khi chuyển tab

function _onVisibilityChange() {
    if (document.hidden && State.videoEl && !State.videoEl.paused) {
        if (!document.pictureInPictureElement) {
            State.videoEl.requestPictureInPicture().catch(() => {});
        }
    }
}

function enableAutoPiP() {
    if (State._pipEnabled) return;
    State._pipEnabled = true;
    document.addEventListener('visibilitychange', _onVisibilityChange);
}

function disableAutoPiP() {
    if (!State._pipEnabled) return;
    State._pipEnabled = false;
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    // Thoát PiP nếu đang active
    if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
    }
}
