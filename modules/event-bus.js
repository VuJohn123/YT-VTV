// event-bus.js — Layer 1: Lightweight pub/sub EventBus
// Đây là trái tim của architecture mới: mọi module communicate qua events,
// không gọi trực tiếp function của nhau.

/**
 * Event catalogue (tất cả events hợp lệ):
 *
 * 'navigate'       {videoId}               — YouTube SPA navigation detected
 * 'channelReady'   {channelName}           — channel name resolved
 * 'episodeFound'   {info, seriesKey}       — title parsed & episode identified
 * 'videoReady'     {videoEl, duration}     — <video> element mounted & usable
 * 'nextFound'      {url, title, source}    — next episode located
 * 'prevFound'      {url, title, episode}   — previous episode located
 * 'playlistReady'  {list}                  — episode list built
 * 'videoEnded'     {}                      — video ended event
 * 'seeked'         {from, to}              — user seeked
 * 'adDetected'     {detected: bool}        — ad detection state changed
 * 'modeChange'     {key, value}            — a toggle changed (marathon, audioMode, …)
 * 'error'          {context, err}          — unhandled error in a module
 */

const EventBus = (() => {
    /** @type {Map<string, Set<Function>>} */
    const _listeners = new Map();

    /**
     * Subscribe to an event. Returns unsubscribe function.
     * @param {string}   event
     * @param {Function} handler
     * @returns {Function} unsubscribe
     */
    function on(event, handler) {
        if (!_listeners.has(event)) _listeners.set(event, new Set());
        _listeners.get(event).add(handler);
        return () => off(event, handler);
    }

    /**
     * Subscribe to an event exactly once.
     * @param {string}   event
     * @param {Function} handler
     * @returns {Function} unsubscribe
     */
    function once(event, handler) {
        const wrapper = (payload) => { handler(payload); off(event, wrapper); };
        return on(event, wrapper);
    }

    /**
     * Unsubscribe a specific handler.
     * @param {string}   event
     * @param {Function} handler
     */
    function off(event, handler) {
        _listeners.get(event)?.delete(handler);
    }

    /**
     * Emit an event synchronously to all subscribers.
     * @param {string} event
     * @param {*}      [payload]
     */
    function emit(event, payload) {
        log(`[EventBus] ${event}`, payload ?? '');
        const handlers = _listeners.get(event);
        if (!handlers) return;
        for (const h of handlers) {
            try { h(payload); }
            catch (err) { warn(`[EventBus] handler error on "${event}":`, err); }
        }
    }

    /** Remove all listeners for an event (used in cleanup). */
    function clear(event) {
        _listeners.delete(event);
    }

    /** Remove ALL listeners (full reset between navigations). */
    function reset() {
        _listeners.clear();
    }

    return { on, once, off, emit, clear, reset };
})();
