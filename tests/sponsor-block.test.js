// tests/sponsor-block.test.js — test luồng tự đóng góp segment (submit/mark)
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertTrue, assertFalse, assertEqual } = require('./lib/tap');

suite('SponsorBlock — self-contribute (sponsor-block.js)');

function freshSponsorBlock() {
    global.log = () => {}; global.warn = () => {};
    global.EventBus = { on() {}, emit() {} };
    let storedGlobal = {};
    global.Storage = {
        getGlobal: (k, d) => (k in storedGlobal ? storedGlobal[k] : d),
        setGlobal: (k, v) => { storedGlobal[k] = v; },
    };
    global.fakeVideo = { currentTime: 0 };
    global.VideoContext = { getVideoEl: () => global.fakeVideo };
    global.location = { search: '?v=TESTVID' };
    global.URLSearchParams = require('url').URLSearchParams;
    global.crypto = { randomUUID: () => 'fake-uuid-' + Math.random() };
    global.__lastPostBody = null;
    global.__mockStatus = 200;
    global.GM_xmlhttpRequest = ({ method, data, onload }) => {
        if (method === 'POST') global.__lastPostBody = JSON.parse(data);
        onload({ status: global.__mockStatus, responseText: global.__mockStatus >= 400 ? 'error' : '[]' });
    };
    return loadModule('sponsor-block.js', 'SponsorBlock');
}

test('finishMark() trước khi startMark() → báo lỗi rõ ràng, không submit gì', async () => {
    const SponsorBlock = freshSponsorBlock();
    const r = await SponsorBlock.finishMark('sponsor');
    assertFalse(r.ok);
});

test('Đánh dấu đoạn hợp lệ (5s→35s) → submit thành công với payload đúng format', async () => {
    const SponsorBlock = freshSponsorBlock();
    global.fakeVideo.currentTime = 5;
    SponsorBlock.startMark();
    global.fakeVideo.currentTime = 35;
    const r = await SponsorBlock.finishMark('sponsor');
    assertTrue(r.ok);
    assertEqual(global.__lastPostBody.videoID, 'TESTVID');
    assertEqual(global.__lastPostBody.segments[0].segment[0], 5);
    assertEqual(global.__lastPostBody.segments[0].segment[1], 35);
});

test('Đoạn quá ngắn (<1s) bị chặn, không submit', async () => {
    const SponsorBlock = freshSponsorBlock();
    global.fakeVideo.currentTime = 100;
    SponsorBlock.startMark();
    global.fakeVideo.currentTime = 100.5;
    const r = await SponsorBlock.finishMark('sponsor');
    assertFalse(r.ok);
});

test('userID nhất quán giữa nhiều lần submit trong cùng phiên', async () => {
    const SponsorBlock = freshSponsorBlock();
    global.fakeVideo.currentTime = 0; SponsorBlock.startMark(); global.fakeVideo.currentTime = 20;
    await SponsorBlock.finishMark('sponsor');
    const id1 = global.__lastPostBody.userID;
    global.fakeVideo.currentTime = 50; SponsorBlock.startMark(); global.fakeVideo.currentTime = 80;
    await SponsorBlock.finishMark('intro');
    const id2 = global.__lastPostBody.userID;
    assertEqual(id1, id2);
});

test('Server trả 409 (đã tồn tại) vẫn coi là thành công', async () => {
    const SponsorBlock = freshSponsorBlock();
    global.__mockStatus = 409;
    global.fakeVideo.currentTime = 10; SponsorBlock.startMark(); global.fakeVideo.currentTime = 40;
    const r = await SponsorBlock.finishMark('sponsor');
    assertTrue(r.ok);
});

test('Server lỗi HTTP 500 → báo lỗi, không coi là thành công', async () => {
    const SponsorBlock = freshSponsorBlock();
    global.__mockStatus = 500;
    global.fakeVideo.currentTime = 10; SponsorBlock.startMark(); global.fakeVideo.currentTime = 40;
    const r = await SponsorBlock.finishMark('sponsor');
    assertFalse(r.ok);
});

run().then(() => process.exit(process.exitCode || 0));
