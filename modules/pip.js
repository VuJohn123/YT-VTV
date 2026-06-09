// pip.js - Auto PiP khi chuyển tab
let pipAutoEnabled = false;
function enableAutoPiP() {
    if (pipAutoEnabled) return;
    pipAutoEnabled = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
}
function disableAutoPiP() {
    if (!pipAutoEnabled) return;
    pipAutoEnabled = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
}
function onVisibilityChange() {
    if (document.hidden && videoEl && !videoEl.paused) {
        if (!document.pictureInPictureElement) {
            videoEl.requestPictureInPicture().catch(() => {});
        }
    }
}