// network-optimizer.js - Tự động tăng buffer, điều chỉnh chất lượng khi mạng kém
let originalPlaybackRate = 1;

function optimizeConnection() {
    // Đặt preload = auto
    if (videoEl) {
        videoEl.preload = 'auto';
        // Tăng buffer bằng cách seek nhẹ? Không thể ép, nhưng có thể giảm playback khi mạng kém
        // Dùng Network Information API nếu có
        if (navigator.connection) {
            navigator.connection.addEventListener('change', onConnectionChange);
            onConnectionChange(); // Kiểm tra ngay
        }
    }
    // Pre-fetch video tiếp theo (đã có trong main) nhưng có thể tăng số lượng
}

function onConnectionChange() {
    if (!navigator.connection) return;
    const connection = navigator.connection;
    log('Network type:', connection.effectiveType, 'downlink:', connection.downlink, 'rtt:', connection.rtt);
    // Nếu mạng quá kém (2g, slow-2g) thì giảm chất lượng
    if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
        if (videoEl && videoEl.playbackRate === 1) {
            // Tạm giảm tốc độ phát để giảm tải băng thông? Có thể không cần.
            // Thay đổi chất lượng về 144p
            if (typeof enableAudioMode === 'function' && !audioMode) {
                log('Auto-enabling Audio Mode due to poor network');
                enableAudioMode();
            }
        }
    } else if (audioMode && (connection.effectiveType === '4g' || connection.downlink > 1)) {
        // Nếu mạng tốt trở lại và đang ở audio mode, có thể không tự tắt (để người dùng quyết định)
    }
}

// Hàm tăng buffer thủ công: tạm dừng 1 giây để buffer thêm (có thể gây giật)
function forceBuffer() {
    if (!videoEl) return;
    const currentTime = videoEl.currentTime;
    videoEl.pause();
    setTimeout(() => {
        videoEl.currentTime = currentTime;
        videoEl.play();
    }, 2000);
}

// Gọi khi script khởi tạo
if (location.pathname === '/watch') {
    setTimeout(optimizeConnection, 2000);
}