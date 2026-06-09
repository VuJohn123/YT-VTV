// keyboard.js - Phím tắt
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        switch (e.key) {
            case 'n': case 'N': if (nextUrl) window.location.href = nextUrl; break;
            case 'b': case 'B': if (previousEp?.url) window.location.href = previousEp.url; break;
            case 'm': case 'M': marathon = !marathon; GM_setValue('vtvUlt_marathon', marathon); break;
            case 'g': case 'G': recordGIF(); break;
            case 'f': case 'F': findAndReplaceFull(); break;
            case 's': case 'S': addToWatchLater(location.href, document.title); break;
        }
    });
}