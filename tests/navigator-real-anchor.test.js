// tests/navigator-real-anchor.test.js — cải tiến mới: ưu tiên click vào
// anchor THẬT do YouTube tự render (sidebar/playlist panel) thay vì luôn tạo
// anchor mới từ đầu — xem comment TRUNG THỰC VỀ GIỚI HẠN ở navigator.js.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue } = require('./lib/tap');

function baseSetup() {
    global.log = () => {}; global.warn = () => {};
    global.URLSearchParams = require('url').URLSearchParams;
    global.MouseEvent = function () {};
    global.window = { addEventListener() {}, location: { set href(v) {} } };
}

suite('Navigator — reuse anchor thật của YouTube trước khi fallback tự tạo (navigator.js)');

test('Có anchor thật (sidebar) trỏ tới video khác → phải click ĐÚNG anchor đó, không tạo anchor mới', () => {
    baseSetup();
    global.location = { href: 'https://www.youtube.com/watch?v=OLD' };

    let realAnchorClicked = false;
    let createdNewAnchor = false;
    let hrefSetTo = null;

    class FakeAnchor {
        constructor() {
            this._href = 'https://www.youtube.com/watch?v=SOME_RELATED';
            this.isConnected = true;
        }
        get href() { return this._href; }
        setAttribute(name, val) { if (name === 'href') { this._href = val; hrefSetTo = val; } }
        getAttribute() { return this._href; }
        click() { realAnchorClicked = true; }
    }
    // Cần instance thật của HTMLAnchorElement để pass qua check
    // `a instanceof HTMLAnchorElement` trong _findReusableRealAnchor().
    global.HTMLAnchorElement = FakeAnchor;
    const realAnchor = new FakeAnchor();

    global.document = {
        addEventListener() {},
        querySelectorAll: (sel) => (sel.includes('#secondary') ? [realAnchor] : []),
        createElement: () => { createdNewAnchor = true; return { style: {}, click() {}, remove() {}, set href(v) {}, set rel(v) {}, set tabIndex(v) {} }; },
        body: { appendChild() {} },
    };

    const Navigator = loadModule('navigator.js', 'Navigator');
    Navigator.goTo('https://www.youtube.com/watch?v=NEW_TARGET');

    assertTrue(realAnchorClicked, 'Phải click vào anchor THẬT tìm thấy trên trang');
    assertEqual(createdNewAnchor, false, 'KHÔNG được tạo anchor mới khi đã có anchor thật dùng được');
    assertEqual(hrefSetTo, 'https://www.youtube.com/watch?v=NEW_TARGET', 'href của anchor thật phải được đổi sang URL đích trước khi click');
});

test('KHÔNG có anchor thật nào (theater/fullscreen ẩn sidebar) → fallback tạo anchor mới như cũ', () => {
    baseSetup();
    global.location = { href: 'https://www.youtube.com/watch?v=OLD' };
    global.HTMLAnchorElement = class {};

    let createdNewAnchor = false;
    let newAnchorClicked = false;

    global.document = {
        addEventListener() {},
        querySelectorAll: () => [], // không có anchor nào trên trang
        createElement: () => {
            createdNewAnchor = true;
            return { style: {}, click() { newAnchorClicked = true; }, remove() {}, set href(v) {}, set rel(v) {}, set tabIndex(v) {} };
        },
        body: { appendChild() {} },
    };

    const Navigator = loadModule('navigator.js', 'Navigator');
    Navigator.goTo('https://www.youtube.com/watch?v=NEW_TARGET');

    assertTrue(createdNewAnchor, 'Không có anchor thật → phải fallback tạo anchor mới (giữ đúng hành vi cũ, không mất lưới an toàn)');
    assertTrue(newAnchorClicked, 'Anchor mới tạo ra phải được click');
});

run().then(() => process.exit(process.exitCode || 0));
