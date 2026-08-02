// tests/audio-graph.test.js — test quan trọng nhất: đảm bảo
// createMediaElementSource KHÔNG bị gọi 2 lần cho cùng 1 video khi cả
// ChapterDetector VÀ VolumeBoost (qua PlayerControl) cùng cần audio graph —
// gọi 2 lần sẽ throw InvalidStateError trên trình duyệt thật.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue, assertFalse } = require('./lib/tap');

suite('AudioGraph — shared MediaElementSourceNode (audio-graph.js)');

function makeFakeAudioContext() {
    let createSourceCallCount = 0;
    class FakeNode {
        connect() { return this; }
    }
    class FakeAnalyser extends FakeNode {
        constructor() { super(); this.fftSize = 512; }
    }
    class FakeGain extends FakeNode {
        constructor() { super(); this.gain = { value: 1 }; }
    }
    class FakeCompressor extends FakeNode {
        constructor() { super(); this.threshold = { value: 0 }; this.knee = { value: 0 }; this.ratio = { value: 0 }; this.attack = { value: 0 }; this.release = { value: 0 }; }
    }
    class FakeSource extends FakeNode {}
    class FakeCtx {
        constructor() { this.state = 'running'; this.destination = new FakeNode(); }
        createMediaElementSource(el) {
            createSourceCallCount++;
            if (createSourceCallCount > 1 && el === global.__lastSourcedEl) {
                throw new Error('InvalidStateError: HTMLMediaElement already connected previously to a different MediaElementSourceNode.');
            }
            global.__lastSourcedEl = el;
            return new FakeSource();
        }
        createGain() { return new FakeGain(); }
        createAnalyser() { return new FakeAnalyser(); }
        createDynamicsCompressor() { return new FakeCompressor(); }
        resume() { return Promise.resolve(); }
    }
    return { FakeCtx, getCallCount: () => createSourceCallCount };
}

test('ChapterDetector (analyser tap) + PlayerControl volume boost (gain) trên CÙNG video → chỉ 1 lần createMediaElementSource', () => {
    global.warn = () => {};
    const { FakeCtx, getCallCount } = makeFakeAudioContext();
    global.window = { AudioContext: FakeCtx };

    const AudioGraph = loadModule('audio-graph.js', 'AudioGraph');
    const fakeVideo = { id: 'video1' };

    // Module A (ChapterDetector) xin analyser tap
    const analyser = AudioGraph.getAnalyserTap(fakeVideo, 512);
    assertTrue(!!analyser, 'Phải trả về analyser hợp lệ');

    // Module B (PlayerControl.setVolumeBoost) gọi attach() + setGain() cho CÙNG video
    AudioGraph.attach(fakeVideo);
    AudioGraph.setGain(1.5);

    assertEqual(getCallCount(), 1, 'createMediaElementSource CHỈ được gọi đúng 1 lần dù 2 module khác nhau cùng cần audio graph — gọi 2 lần sẽ throw trên trình duyệt thật');
    assertEqual(AudioGraph.getGain(), 1.5);
    assertTrue(AudioGraph.isGraphActive());
});

test('Video đổi (chuyển tập) → tạo graph MỚI, không throw, giữ nguyên mức gain đã chọn', () => {
    global.warn = () => {};
    const { FakeCtx, getCallCount } = makeFakeAudioContext();
    global.window = { AudioContext: FakeCtx };
    global.__lastSourcedEl = null;

    const AudioGraph = loadModule('audio-graph.js', 'AudioGraph');
    const videoA = { id: 'A' };
    const videoB = { id: 'B' };

    AudioGraph.attach(videoA);
    AudioGraph.setGain(1.8);
    AudioGraph.attach(videoB); // chuyển tập — video khác hẳn

    assertEqual(getCallCount(), 2, 'Video khác → source node MỚI (không phải gọi lại trên video cũ)');
    assertEqual(AudioGraph.getGain(), 1.8, 'Mức boost phải được giữ nguyên qua lần chuyển tập');
});

test('Gọi attach() nhiều lần cho CÙNG video → không tạo lại source (idempotent)', () => {
    global.warn = () => {};
    const { FakeCtx, getCallCount } = makeFakeAudioContext();
    global.window = { AudioContext: FakeCtx };
    global.__lastSourcedEl = null;

    const AudioGraph = loadModule('audio-graph.js', 'AudioGraph');
    const video = { id: 'same' };

    AudioGraph.attach(video);
    AudioGraph.attach(video);
    AudioGraph.attach(video);

    assertEqual(getCallCount(), 1, 'attach() lặp lại cho cùng video không được tạo source mới');
});

test('setGain() clamp trong khoảng [0, 2]', () => {
    global.warn = () => {};
    const { FakeCtx } = makeFakeAudioContext();
    global.window = { AudioContext: FakeCtx };
    global.__lastSourcedEl = null;

    const AudioGraph = loadModule('audio-graph.js', 'AudioGraph');
    assertEqual(AudioGraph.setGain(5), 2, 'Không được vượt 200%');
    assertEqual(AudioGraph.setGain(-1), 0, 'Không được âm');
});

run();
