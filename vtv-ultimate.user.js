// ==UserScript==
// @name         VTV Giải Trí Ultimate
// @namespace    https://github.com/VuJohn123/YT-VTV
// @version      12.0
// @description  Tự động điều hướng tập phim VTV Giải Trí — kiến trúc layered event-driven, SPA-native navigation, internal PlayerControl layer, SponsorBlock, Watch Party, Chapter Detection
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
// @connect      sponsor.ajay.app
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
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/episode-navigator.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/video-context.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/player-control.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/sponsor-block.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/watch-party.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/chapter-detector.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/buffer-monitor.js
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
