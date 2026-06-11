// pip.js - Auto PiP nhanh, phản ứng ngay khi chuyển tab
let pipAutoEnabled = false;
let pipActive = false;
let pipCheckInterval = null;

function enableAutoPiP() {
    if (pipAutoEnabled) return;
    pipAutoEnabled = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Kiểm tra định kỳ mỗi 2 giây để đảm bảo PiP được kích hoạt (phòng trường hợp sự kiện chậm)
    pipCheckInterval = setInterval(checkAndActivatePiP, 2000);
    log('Auto PiP enabled');
}

function disableAutoPiP() {
    if (!pipAutoEnabled) return;
    pipAutoEnabled = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (pipCheckInterval) { clearInterval(pipCheckInterval); pipCheckInterval = null; }
    // Thoát PiP nếu đang có
    if (pipActive && document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
        pipActive = false;
    }
    log('Auto PiP disabled');
}

function onVisibilityChange() {
    // Gọi ngay khi visibility thay đổi
    checkAndActivatePiP();
}

async function checkAndActivatePiP() {
    if (!videoEl || !pipAutoEnabled) return;
    // Nếu tab đang ẩn và video đang phát, và chưa có PiP
    if (document.hidden && !videoEl.paused && !document.pictureInPictureElement) {
        try {
            await videoEl.requestPictureInPicture();
            pipActive = true;
            log('Auto PiP started');
        } catch (e) {
            // Có thể bị từ chối (ví dụ video chưa có metadata), bỏ qua
        }
    }
    // Nếu tab hiện trở lại và PiP đang hoạt động, thoát PiP
    else if (!document.hidden && pipActive && document.pictureInPictureElement) {
        try {
            await document.exitPictureInPicture();
            pipActive = false;
            log('Auto PiP stopped');
        } catch (e) {}
    }
}