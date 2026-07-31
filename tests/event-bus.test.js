// tests/event-bus.test.js — test error boundary tập trung của EventBus
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue } = require('./lib/tap');

suite('EventBus — centralized error boundary (event-bus.js)');

test('Handler throw → lỗi được persist vào Storage.logError, không crash emit()', () => {
    global.log = () => {}; global.warn = () => {};
    const logged = [];
    global.Storage = { logError: (ctx, msg) => logged.push({ ctx, msg }) };

    const EventBus = loadModule('event-bus.js', 'EventBus');
    let secondRan = false;
    EventBus.on('testEvent', () => { throw new Error('Something broke'); });
    EventBus.on('testEvent', () => { secondRan = true; });
    EventBus.emit('testEvent', {});

    assertEqual(logged.length, 1);
    assertEqual(logged[0].ctx, 'EventBus:testEvent');
    assertTrue(secondRan, 'handler thứ 2 vẫn phải chạy dù handler 1 throw (cô lập lỗi giữa các handler)');
});

run();
