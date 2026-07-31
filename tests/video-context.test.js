// tests/video-context.test.js — test self-heal của VideoContext.getVideoEl()
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue } = require('./lib/tap');

suite('VideoContext — self-heal (video-context.js)');

function makeVideoEl(name, connected = true) {
    const listeners = {};
    return {
        name, isConnected: connected, duration: 1200, currentTime: 0, readyState: 1, paused: true,
        addEventListener(evt, fn) { (listeners[evt] ||= []).push(fn); },
        removeEventListener(evt, fn) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn); },
        _listenerCount(evt) { return (listeners[evt] || []).length; },
        play() {}, pause() {},
    };
}

test('getVideoEl() tự self-heal khi video cũ bị gỡ khỏi DOM giữa chừng (root cause bug đã fix)', () => {
    let currentDomVideo = makeVideoEl('elA', true);
    const events = {};
    global.EventBus = {
        on(evt, fn) { (events[evt] ||= []).push(fn); },
        once(evt, fn) { (events[evt] ||= []).push(fn); },
        emit(evt, p) { (events[evt] || []).forEach(fn => fn(p)); },
    };
    global.log = () => {}; global.warn = () => {};
    global.AD_MAX_DURATION = 30;
    global.Storage = { getSkipData: () => null, learnSkip: () => {} };
    global.Navigator = { goTo: () => {} };
    global.document = { querySelector: (sel) => sel === 'video.html5-main-video' ? currentDomVideo : null, body: {} };
    global.MutationObserver = class { observe() {} disconnect() {} };
    global.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
    global.cancelAnimationFrame = (id) => clearTimeout(id);

    const VideoContext = loadModule('video-context.js', 'VideoContext');
    VideoContext.attach('series1', { autoPlay: false });

    // elA "chết" giữa chừng, elB xuất hiện thay thế — không qua yt-navigate-finish nào
    currentDomVideo.isConnected = false;
    const elB = makeVideoEl('elB', true);
    currentDomVideo = elB;

    let healedEventFired = false;
    global.EventBus.on('videoReady', () => { healedEventFired = true; });

    const healed = VideoContext.getVideoEl();
    assertEqual(healed && healed.name, 'elB', 'getVideoEl() phải tự tìm lại và trả về elB');
    assertTrue(healedEventFired, 'videoReady phải được emit lại khi self-heal sang video khác');
    assertTrue(!!VideoContext.getVideoEl(), 'PlayerControl.play()/pause() (dựa vào !!getVideoEl()) không còn báo sai "không tìm thấy video"');
});

run().then(() => process.exit(process.exitCode || 0));
