// keyboard.js - Phím tắt

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        // Bỏ qua khi đang nhập text
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        switch (e.key) {
            case 'n': case 'N': if (State.nextUrl) window.location.href = State.nextUrl; break;
            case 'b': case 'B': if (State.previousEp?.url) window.location.href = State.previousEp.url; break;
            case 'm': case 'M': State.marathon = !State.marathon; GM_setValue('vtvUlt_marathon', State.marathon); break;
            case 'g': case 'G': recordGIF(); break;
            case 'f': case 'F': findAndReplaceFull(); break;
            case 's': case 'S': addToWatchLater(location.href, document.title); break;
        }
    });
}
