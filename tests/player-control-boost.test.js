// tests/player-control-boost.test.js — test setRateExact (tốc độ tự do) và
// setVolumeBoost (0-200%)
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue, assertFalse } = require('./lib/tap');

suite('PlayerControl — free speed & volume boost (player-control.js)');

function setupMocks() {
    global.log = () => {}; global.warn = () => {};
    const fakeVideo = { volume: 1, muted: false, playbackRate: 1 };
    global.VideoContext = { getVideoEl: () => fakeVideo };
    global.document = { getElementById: () => null };
    let gain = 1, graphActive = false;
    global.AudioGraph = {
        attach: (v) => { graphActive = true; },
        setGain: (g) => { gain = Math.max(0, Math.min(2, g)); },
        getGain: () => gain,
        isGraphActive: () => graphActive,
    };
    return { fakeVideo, getGain: () => gain };
}

test('setRateExact: vượt qua giới hạn 2x của setRate thường (tự do tới 8x)', () => {
    const { fakeVideo } = setupMocks();
    const PlayerControl = loadModule('player-control.js', 'PlayerControl', global);
    const r = PlayerControl.setRateExact(5);
    assertTrue(r.ok);
    assertEqual(r.rate, 5);
    assertEqual(fakeVideo.playbackRate, 5);
});

test('setRateExact: clamp tối đa 8x, cảnh báo mute trên 4x', () => {
    setupMocks();
    const PlayerControl = loadModule('player-control.js', 'PlayerControl', global);
    const r = PlayerControl.setRateExact(20);
    assertEqual(r.rate, 8, 'phải bị clamp ở 8');
    assertTrue(r.audioMuted, 'phải cảnh báo audio bị mute (>4x là giới hạn thật của Chrome)');
});

test('setVolumeBoost: ≤100% dùng thẳng video.volume, KHÔNG cần AudioGraph', () => {
    const { fakeVideo } = setupMocks();
    const PlayerControl = loadModule('player-control.js', 'PlayerControl', global);
    const r = PlayerControl.setVolumeBoost(70);
    assertTrue(r.ok);
    assertFalse(r.usedWebAudio, 'không cần Web Audio API cho ≤100%');
    assertEqual(fakeVideo.volume, 0.7);
});

test('setVolumeBoost: >100% dùng AudioGraph gain, video.volume giữ ở 1.0', () => {
    const { fakeVideo, getGain } = setupMocks();
    const PlayerControl = loadModule('player-control.js', 'PlayerControl', global);
    const r = PlayerControl.setVolumeBoost(150);
    assertTrue(r.ok);
    assertTrue(r.usedWebAudio, 'phải dùng Web Audio API cho >100%');
    assertEqual(fakeVideo.volume, 1, 'video.volume giữ ở 1.0, gain đảm nhiệm boost');
    assertEqual(getGain(), 1.5);
});

test('setVolumeBoost: clamp tối đa 200%', () => {
    setupMocks();
    const PlayerControl = loadModule('player-control.js', 'PlayerControl', global);
    const r = PlayerControl.setVolumeBoost(500);
    assertEqual(r.percent, 200);
});

run();
