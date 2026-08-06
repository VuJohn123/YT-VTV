// ==UserScript==
// @name         VTV Giải Trí Ultimate
// @namespace    https://github.com/VuJohn123/YT-VTV
// @icon         https://yt3.ggpht.com/vs_RBzRO4Z-OoX2arjzu1A7e7g_RpAMLRXVVkRf07rh1DVaSWNf1HcuSj2MP6v3dsbEtnTgqOZc=s48-c-k-c0x00ffffff-no-rj
// @version      15.11
// @description  Tự động điều hướng tập phim VTV Giải Trí — audio ducking cho voice (fix bắt nhầm tiếng video), multi-alternative speech recognition, event-driven PiP chuẩn, gộp SponsorBlock vào AdBlock, Watch Party follow-nav
// @author       VuJohn123
// @match        https://www.youtube.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_listValues
// @grant        GM_notification
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      sponsor.ajay.app
// @connect      0.peerjs.com
// @connect      stun.l.google.com
//
// Load order is explicit and maps to the dependency graph:
// Layer 0/1 — pure utilities, no dependencies
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/utils.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/event-bus.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/navigator.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/storage.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/search.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/channel-detect.js
// Layer 2 — core services (depend on Layer 0/1)
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/virtual-playlist.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/series-learner.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/episode-navigator.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/video-context.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/audio-graph.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/player-control.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/sponsor-block.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/watch-party.js
// @require      https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/buffer-monitor.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/tv-mode.js
// Layer 3 — UI + features (depend on Layer 0-2)
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/ui.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/features.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/history-viewer.js
// Layer 4 — orchestrator (depends on everything)
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/entry.js
//
// @updateURL    https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/vtv-ultimate.user.js
// @downloadURL  https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/vtv-ultimate.user.js
// @run-at       document-end
// ==/UserScript==

// This file is intentionally empty beyond the metadata block.
// All logic lives in the @require'd modules above.
// Entry point: modules/entry.js
