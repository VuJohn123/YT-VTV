// pip.js - Auto PiP khi chuyển tab (đã sửa)
let pipAutoEnabled = false;
let pipActive = false;

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

async function onVisibilityChange() {
    if (!videoEl) return;
    if (document.hidden && !videoEl.paused) {
        if (!document.pictureInPictureElement && videoEl.requestPictureInPicture) {
            try {
                await videoEl.requestPictureInPicture();
                pipActive = true;
                log('Entered PiP');
            } catch (e) {
                warn('PiP failed:', e);
            }
        }
    } else if (!document.hidden && pipActive && document.pictureInPictureElement) {
        try {
            await document.exitPictureInPicture();
            pipActive = false;
            log('Exited PiP');
        } catch (e) {}
    }
}