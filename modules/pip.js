let pipAutoEnabled = false;
function enableAutoPiP() {
    if (pipAutoEnabled) return;
    pipAutoEnabled = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
    log('Auto PiP enabled');
}
function disableAutoPiP() {
    if (!pipAutoEnabled) return;
    pipAutoEnabled = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    log('Auto PiP disabled');
}
function onVisibilityChange() {
    if (document.hidden && videoEl && !videoEl.paused) {
        if (!document.pictureInPictureElement) videoEl.requestPictureInPicture().catch(() => {});
    }
}