// entry.js — Layer 4: Orchestrator
// Fixes:
//   - Truyền videoId vào ChannelDetect.resolve() để per-video cache đúng
//   - Dùng isVTVChannel() thay vì exact string match
//   - Truyền seriesKey vào EpisodeEngine.run()
//   - flags được re-read mỗi navigation (không stale)

(function () {
    'use strict';

    let _runToken = 0; // tăng dần mỗi lần _runMain được gọi; dùng để huỷ run cũ
    let _lastVid  = null;
    let _lastChannel = null; // {name, id} — kênh vừa resolve gần nhất, dùng cho menu "Thêm vào Farm whitelist" (similarity-farm.js) để không bắt user tự gõ tay channel ID

    window._vtvParsedInfo = null;

    // ─── One-time init ────────────────────────────────────────────────────────
    Storage.runMigrations(); // PHẢI chạy trước khi đọc bất kỳ flag nào bên dưới
    Storage.setupProfileMenu();
    Keyboard.setup();
    UI.init();

    GM_registerMenuCommand('🐛 Xem log lỗi', () => HistoryViewer.openErrorLog());
    // Opt-in, MẶC ĐỊNH TẮT (xem similarity-report.js) — chỉ có tác dụng nếu
    // user tự deploy Cloudflare Worker riêng (xem cf-worker/README.md) rồi
    // dán URL vào đây. Không cấu hình gì = không có network call nào cả.
    GM_registerMenuCommand('📊 Cấu hình Similarity Report (tuỳ chọn)', () => {
        const current = Storage.getGlobal('similarityReportUrl', '');
        const input = prompt(
            'Dán URL Cloudflare Worker của bạn để gửi dữ liệu match series ẩn danh ' +
            '(giúp tinh chỉnh ngưỡng Jaccard) — xem cf-worker/README.md để tự deploy.\n' +
            'Để trống + OK để TẮT tính năng này.',
            current
        );
        if (input === null) return; // user bấm Cancel
        const result = SimilarityReport.configure(input);
        if (!result.ok) {
            alert('❌ ' + result.error + '\n\nURL chưa được lưu, thử lại.');
            return;
        }
        alert(input.trim() ? '✅ Đã lưu — bắt đầu gửi report ẩn danh từ giờ.' : '✅ Đã tắt Similarity Report.');
    });

    // ── Similarity Farm Mode (thu thập dữ liệu hàng loạt qua RSS feed) ────────
    // Xem giải thích đầy đủ (bao gồm vì sao dùng RSS thay vì click-qua-video
    // như mô tả gốc, và giới hạn quota thật 1000 ghi/ngày) ở đầu
    // similarity-farm.js. 3 menu riêng biệt: thêm kênh MỚI (ngoài seed) vào
    // whitelist, xem/loại kênh (seed lẫn tự thêm), và chạy farm (có
    // confirm() rõ ràng trước khi gửi gì). Whitelist LUÔN CÓ SẴN toàn bộ
    // VTV_KNOWN_CHANNELS (utils.js) ngay từ đầu — không cần bấm menu nào
    // trước khi chạy farm lần đầu (feedback thật của user: "tự nhiên lại
    // phải thêm whitelist... chỉ cần là 1 list các kênh VTV đã biết trước").
    GM_registerMenuCommand('🌾 Farm: Thêm kênh hiện tại vào whitelist', () => {
        if (!_lastChannel || !_lastChannel.id) {
            alert('⚠️ Chưa xác định được kênh nào — mở 1 video của kênh muốn thêm rồi thử lại.');
            return;
        }
        const added = SimilarityFarm.addChannel(_lastChannel.name, _lastChannel.id);
        alert(added
            ? `✅ Đã thêm "${_lastChannel.name}" vào Farm whitelist.`
            : `ℹ️ "${_lastChannel.name}" đã có sẵn trong whitelist rồi (kênh VTV mặc định hoặc đã tự thêm trước đó).`);
    });

    GM_registerMenuCommand('🌾 Farm: Xem/Loại kênh trong whitelist', () => {
        const list = SimilarityFarm.getWhitelist();
        if (!list.length) { alert('Whitelist đang rỗng (đã loại hết kênh VTV mặc định lẫn không tự thêm gì).'); return; }
        // Đánh dấu rõ kênh nào là mặc định (seed:true, từ VTV_KNOWN_CHANNELS)
        // để user biết "Loại" 1 kênh mặc định KHÔNG xoá nó khỏi việc nhận
        // diện kênh VTV khi xem phim bình thường — chỉ loại khỏi Farm Mode.
        const listing = list.map((c, i) => `${i + 1}. ${c.name}${c.seed ? ' (mặc định)' : ''}`).join('\n');
        const input = prompt(
            `Whitelist hiện tại (${list.length} kênh — "(mặc định)" = có sẵn từ đầu, loại chỉ ảnh hưởng Farm Mode, không ảnh hưởng nhận diện kênh VTV khi xem phim):\n${listing}\n\n` +
            `Nhập SỐ THỨ TỰ muốn loại khỏi Farm (để trống + OK để đóng, không đổi gì):`,
            ''
        );
        if (!input || !input.trim()) return;
        const idx = parseInt(input.trim(), 10) - 1;
        if (Number.isNaN(idx) || idx < 0 || idx >= list.length) { alert('Số thứ tự không hợp lệ.'); return; }
        SimilarityFarm.removeChannel(list[idx].channelId);
        alert(`✅ Đã loại "${list[idx].name}" khỏi Farm whitelist.`);
    });

    GM_registerMenuCommand('🌾 Farm: Chạy thu thập dữ liệu hàng loạt', async () => {
        if (!SimilarityReport.isConfigured()) {
            alert('⚠️ Chưa cấu hình Similarity Report URL — dùng menu "📊 Cấu hình Similarity Report" trước.');
            return;
        }
        if (!SimilarityFarm.getWhitelist().length) {
            alert('⚠️ Farm whitelist đang rỗng — có vẻ bạn đã chủ động loại hết cả kênh VTV mặc định. Dùng menu "🌾 Farm: Xem/Loại kênh trong whitelist" để thêm lại (nhập đúng tên kênh muốn khôi phục qua menu "Thêm kênh hiện tại"), hoặc mở 1 video rồi dùng menu "Thêm kênh hiện tại vào whitelist".');
            return;
        }

        alert('⏳ Đang tính trước số lượng (fetch RSS từng kênh)... bấm OK rồi đợi 1 lát, sẽ có confirm tiếp theo.');
        const pre = await SimilarityFarm.preview();

        if (pre.likelyFetchFailure) {
            alert(
                `❌ Cả ${pre.channels} kênh đều trả về 0 video khi fetch RSS — nhiều khả năng lỗi ` +
                `mạng/bị chặn/RSS đổi định dạng, KHÔNG PHẢI trùng hợp cả ${pre.channels} kênh cùng lúc ` +
                `không có video nào gần đây.\n\n` +
                `Mở DevTools Console (F12 → tab Console) rồi thử lại, tìm dòng bắt đầu bằng ` +
                `"[SimilarityFarm]" để xem chi tiết lỗi thật (status code, hoặc 300 ký tự đầu response ` +
                `nhận được) — mình chưa thể tự chẩn đoán chính xác nguyên nhân từ xa được, cần xem log đó.`
            );
            return;
        }

        const willSend = Math.min(pre.totalPairs, SimilarityFarm._internal.MAX_REPORTS_PER_RUN);
        const capped = pre.totalPairs > SimilarityFarm._internal.MAX_REPORTS_PER_RUN;

        const confirmed = confirm(
            `Farm Mode sẽ:\n` +
            `• Quét ${pre.channels} kênh (mặc định VTV + kênh bạn tự thêm nếu có), tổng ${pre.totalEntries} video gần nhất (tối đa 15/kênh — giới hạn RSS của YouTube)\n` +
            `• Tính được ${pre.totalPairs} cặp so sánh${capped ? ` — CHỈ GỬI ${willSend} cặp (lấy mẫu ngẫu nhiên, giới hạn 1000 ghi/ngày của Cloudflare KV free tier)` : ''}\n` +
            `• Gửi ${willSend} report lên Worker của bạn, giãn cách 200ms/report (~${Math.ceil(willSend * 0.2)}s)\n\n` +
            `Không cần "treo máy" chờ — chạy nền, không điều hướng trang nào. Tiếp tục?`
        );
        if (!confirmed) return;

        const result = await SimilarityFarm.run(({ done, total }) => {
            if (done % 50 === 0 || done === total) log('[SimilarityFarm] tiến độ:', done, '/', total);
        });

        if (!result.ok) { alert('❌ ' + result.error); return; }
        alert(
            `✅ Farm hoàn tất!\n` +
            `Kênh đã quét: ${result.channelsProcessed}\n` +
            `Video tổng cộng: ${result.totalEntries}\n` +
            `Report đã gửi: ${result.sent}${result.capped ? ' (đã lấy mẫu, còn nhiều cặp chưa gửi — chạy lại vào ngày khác để lấy mẫu khác)' : ''}\n\n` +
            `Xem kết quả tại: <worker-url>/stats`
        );
    });

    // ─── Restore persisted feature states ────────────────────────────────────
    const _initFlags = Storage.getFeatureFlags();
    if (_initFlags.marathon)     { document.body.classList.add('vtv-marathon'); AdBlock.start(); }
    if (_initFlags.voiceEnabled) VoiceControl.start();
    if (_initFlags.pipEnabled)   AutoPiP.enable();
    if (_initFlags.audioMode)    AudioMode.enable();
    if (_initFlags.watchParty)   WatchParty.enable();
    // TabGuard — PASSIVE, không có công tắc bật/tắt (theo yêu cầu): luôn
    // enable() ngay, không đọc từ _initFlags/GM_setValue nữa. Rủi ro gần
    // như 0 (chỉ cảnh báo thụ động, không điều khiển gì), không đáng bắt
    // user phải quan tâm bật/tắt — xem TOGGLE_DEFS trong ui.js đã bỏ hẳn
    // 'dupTabWarning' khỏi danh sách toggle.
    TabGuard.enable();

    // ─── Global EventBus wires (registered once) ──────────────────────────────

    // Prefetch next episode link
    EventBus.on('nextFound', ({ url }) => {
        const link = document.createElement('link');
        link.rel = 'prefetch'; link.href = url;
        document.head.appendChild(link);
    });

    // Save series progress
    EventBus.on('nextFound', ({ url, title }) => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode)
            Storage.saveSeries(window._vtvSeriesKey, window._vtvParsedInfo.episode, url, title);
    });

    // Stats on videoReady
    const _askedContinuePrompt = new Set();
    EventBus.on('videoReady', ({ duration }) => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode)
            Storage.addStats(window._vtvSeriesKey, window._vtvParsedInfo.episode, duration);

        // TV Mode: nếu đang kết nối với 1 TV, tự động phát video hiện tại
        // trên TV luôn — đúng chuẩn episode (TV luôn theo sát tập đang xem
        // trong trình duyệt, không cần user tự thao tác lại trên TV).
        if (TvMode.isConnected()) {
            const videoId = new URLSearchParams(location.search).get('v');
            const v = VideoContext.getVideoEl();
            if (videoId) {
                TvMode.playVideo(videoId, v?.currentTime || 0).catch(err => {
                    warn('[TvMode] Không sync được tập lên TV:', err.message);
                    EventBus.emit('voiceLabel', { text: '📺 Lỗi đồng bộ TV: ' + err.message });
                });
            }
        }

        // Continue-where-left-off: nếu có vị trí dở của TẬP KHÁC (không phải
        // tập đang mở), hỏi user có muốn xem nốt tập đó không. Chỉ hỏi 1 lần
        // mỗi lần vào trang (không lặp lại hỏi mỗi khi videoReady fire lại).
        const seriesKey = window._vtvSeriesKey;
        if (seriesKey && !_askedContinuePrompt.has(seriesKey)) {
            _askedContinuePrompt.add(seriesKey);
            const lastPos = Storage.getLastPosition(seriesKey);
            if (lastPos && lastPos.episode !== window._vtvParsedInfo?.episode) {
                UI.showContinuePrompt(lastPos);
            }
        }
    });

    // Lưu vị trí xem dở định kỳ (5s) — đủ để resume gần đúng mà không ghi
    // GM storage quá thường xuyên (mỗi lần ghi có chi phí I/O, không cần lưu
    // mỗi frame như _rafTick vốn phục vụ mục đích khác — auto-next countdown).
    setInterval(() => {
        const v = VideoContext.getVideoEl();
        const seriesKey = window._vtvSeriesKey;
        const episode   = window._vtvParsedInfo?.episode;
        if (!v || !seriesKey || !episode || v.paused) return;
        Storage.saveLastPosition(seriesKey, episode, v.currentTime, v.duration || 0, location.href);
    }, 5000);

    // Stats on ended
    EventBus.on('videoEnded', () => {
        if (window._vtvSeriesKey && window._vtvParsedInfo?.episode)
            Storage.addStats(window._vtvSeriesKey, window._vtvParsedInfo.episode, VideoContext.getDuration());
    });

    EventBus.on('cancelRedirect',   () => VideoContext.cancelRedirect());

    // Continue-where-left-off: navigate tới URL đã lưu, seek tới vị trí cũ
    // ngay khi video mới sẵn sàng. Dùng `once` để tự huỷ sau 1 lần — tránh
    // seek nhầm vào lần videoReady tiếp theo (ví dụ user tự chuyển tập khác
    // ngay sau đó) không liên quan gì tới yêu cầu continue này.
    EventBus.on('continueRequested', (lastPos) => {
        if (!lastPos?.url) return;
        EventBus.once('videoReady', () => {
            // Đợi 1 khoảng ngắn cho video thực sự có thể seek (readyState đủ),
            // tương tự cách auto-skip intro trong video-context.js đã làm.
            setTimeout(() => PlayerControl.seekTo(lastPos.currentTime), 500);
        });
        Navigator.goTo(lastPos.url);
    });
    EventBus.on('outOfOrderIgnored', () => {
        if (window._vtvSeriesKey) Storage.clearSeries(window._vtvSeriesKey);
        _runMain();
    });

    // UI rendering from engine events
    EventBus.on('prevFound',       (prev) => { window._vtvPrevEp = prev; });
    EventBus.on('nextFound',       ({ title, url, source }) => {
        UI.showFound(title, url, source, window._vtvPrevEp ?? null);
        UI.scrollToCurrentInPlaylist();
    });
    EventBus.on('nextNotFound',    () => {
        UI.showNotFound(window._vtvPrevEp ?? null);
        UI.scrollToCurrentInPlaylist();
    });
    EventBus.on('missingDetected', (m) => UI.appendMissingWarning(m));

    EventBus.on('modeChange', ({ key, value }) => {
        if (key === 'marathon') document.body.classList.toggle('vtv-marathon', value);
    });
    EventBus.on('channelReady', ({ channelName, channelId }) => {
        log('[Entry] channel:', channelName);
        _lastChannel = { name: channelName, id: channelId };
    });
    EventBus.on('seeked',       ({ from, to }) => log('[Entry] seeked', from, '→', to));
    EventBus.on('error',        ({ context, err }) => warn('[Entry] error in', context, err));

    // ─── Main per-navigation ──────────────────────────────────────────────────
    // Dùng run-token thay vì boolean guard: nếu navigation mới xảy ra trong lúc
    // run trước còn đang await (channel resolve, search, v.v.), run cũ tự huỷ
    // ở checkpoint gần nhất thay vì bị bỏ qua hoàn toàn (bug cũ: _running=true
    // khiến navigation B bị nuốt mất nếu nó tới trong lúc _runMain(A) đang await).
    async function _runMain() {
        const myToken = ++_runToken;
        const _stale  = () => myToken !== _runToken;

        window._vtvParsedInfo = null;
        window._vtvSeriesKey  = null;
        window._vtvPrevEp     = null;

        try {
            VideoContext.cancelRedirect();
            if (!UI.panel) UI.init();
            UI.showSearching();

            // 0. Attach NGAY LẬP TỨC (seriesKey=null) — TRƯỚC KHI biết đây có
            // phải VTV hay không. Trước đây VideoContext.attach() chỉ được
            // gọi SAU KHI xác nhận VTV + parse được tên tập (bước 7 cũ) —
            // nghĩa là các tính năng KHÔNG phụ thuộc VTV (PiP, Audio Mode,
            // Chapter Detector, Buffer Monitor, điều khiển voice cơ bản như
            // tạm dừng/tua/âm lượng) tuy hiện toggle "đã bật" nhưng KHÔNG BAO
            // GIỜ thực sự nhận được video để điều khiển nếu đang xem video
            // không phải VTV hoặc tiêu đề không parse được tên tập — toggle
            // bật mà vô tác dụng. Gọi attach() 2 lần cho CÙNG 1 video (ở đây
            // và lại ở bước 7 khi seriesKey thật đã biết) AN TOÀN: attach()
            // tự _detachListeners() trước khi re-attach nên không tạo listener
            // trùng; các module nghe 'videoReady' (PiP/AudioMode/WatchParty)
            // đã tự idempotent-check (bỏ qua nếu đã attach
            // đúng video rồi) nên không bị ảnh hưởng bởi lần attach thứ 2.
            VideoContext.attach(null, { autoPlay: false, autoSkip: false });

            // 1. Resolve channel — pass videoId for per-video dedup
            const videoId = new URLSearchParams(location.search).get('v') || '';
            const channel = await ChannelDetect.resolve(videoId); // {name, id}
            if (_stale()) return; // navigation mới đã xảy ra trong lúc await
            const channelName = channel.name;
            EventBus.emit('channelReady', { channelName, channelId: channel.id });

            if (!isVTVChannel(channelName, channel.id)) {
                UI.showWrongChannel(channelName);
                TabGuard.setCurrentVideo(null); // không phải VTV → không cảnh báo trùng tab cho video này
                return; // VideoContext vẫn đã attach ở bước 0 — PiP/Audio/Voice/Buffer-monitor vẫn hoạt động bình thường
            }

            // Video ĐÃ xác nhận là VTV — bắt đầu điểm danh cho TabGuard ngay
            // (không đợi parse xong tên tập ở bước 3 bên dưới) — trùng 2 tab
            // vẫn đáng cảnh báo kể cả khi title không parse được tên tập.
            TabGuard.setCurrentVideo(videoId);

            // 2. Video unavailability
            if (document.querySelector('ytd-message-renderer #message') ||
                document.body.innerText.includes('Video unavailable')) {
                UI.showUnavailable();
                TabGuard.setCurrentVideo(null);
                return;
            }

            // 3. Parse title
            const rawTitle = (
                document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.getAttribute('title') ||
                document.title
            ).replace(/\s*-\s*YouTube$/, '').trim();

            const info = parseTitle(rawTitle);
            if (!info.episode) {
                const ap = getYouTubeAutoplay();
                if (ap) UI.showAutoplay(ap.title, ap.url);
                else    UI.showUnrecognized();
                return;
            }

            window._vtvParsedInfo = info;
            const seriesKey       = `${info.series}|S${info.season ?? 0}`;
            window._vtvSeriesKey  = seriesKey;
            EventBus.emit('episodeFound', { info, seriesKey });

            // 4. History
            Storage.addToHistory(seriesKey, info.episode, location.href, rawTitle);

            // 5. Out-of-order guard
            const stored = Storage.getSeries(seriesKey);
            if (stored?.lastEp) {
                const last = stored.lastEp;
                if (info.episode !== last && info.episode !== last + 1) {
                    UI.showOutOfOrder(info.episode, last + 1, stored.nextUrl);
                    return;
                }
            }

            // 6. Re-read flags each navigation (user may have toggled)
            const flags = Storage.getFeatureFlags();

            // 7. Attach video context
            VideoContext.attach(seriesKey, { autoPlay: flags.autoPlay, autoSkip: flags.autoSkip });

            // 7b. SponsorBlock — luôn disable trước (segment của video cũ
            // không được áp dụng nhầm sang video mới), rồi enable lại nếu
            // user đã bật tính năng này.
            SponsorBlock.disable();
            if (flags.sponsorBlock) SponsorBlock.enable(videoId);

            // 8. Episode discovery (nhiều await bên trong — check lại sau khi xong)
            await EpisodeEngine.run(info, channelName, seriesKey);
            if (_stale()) return;

        } catch (err) {
            if (_stale()) return; // lỗi từ 1 run đã bị huỷ, không cần báo
            warn('[Entry] uncaught:', err);
            Storage.logError('Entry:_runMain', err?.message || String(err));
            EventBus.emit('error', { context: 'main', err });
        }
    }

    // ─── SPA navigation detection ─────────────────────────────────────────────
    function _onNavigate() {
        if (location.pathname !== '/watch') return;
        const vid = new URLSearchParams(location.search).get('v');
        if (vid === _lastVid) return;

        // Debounce SPA double-fire
        const captured = vid;
        setTimeout(() => {
            if (new URLSearchParams(location.search).get('v') !== captured) return;
            _lastVid = captured;
            VideoContext.detach();
            _runMain();
        }, 600);
    }

    document.addEventListener('yt-navigate-finish', _onNavigate);

    // ─── SPA nav fallback (defense-in-depth) ──────────────────────────────────
    // BUG THẬT ĐÃ GẶP: chuyển từ video kênh KHÁC sang video VTV qua search
    // (bấm kết quả search của YouTube) — panel bị "đứng hình" ở trạng thái
    // "Không phải kênh VTV" của video CŨ dù trang đã thực sự load đúng video
    // VTV mới (title/kênh dưới video đã đổi đúng). TRUNG THỰC VỀ GIỚI HẠN:
    // đã research `yt-navigate-finish` — theo tài liệu/nguồn ngoài, event
    // này ĐƯỢC XÁC NHẬN có fire cho đúng trường hợp "clicking on a video in
    // search results", nên chưa xác định chắc chắn 100% root cause (có thể
    // là 1 edge case cụ thể của event này, hoặc timing race khác) — KHÔNG
    // đoán mù sửa sai chỗ. Thay vào đó thêm 1 lưới an toàn dự phòng: poll
    // `location.href` mỗi 1s, nếu đổi mà `yt-navigate-finish` vì lý do gì đó
    // không fire (hoặc fire nhưng bị bỏ lỡ), _onNavigate() vẫn được gọi lại
    // trong tối đa 1s — tự nó đã có debounce/dedupe theo `_lastVid` nên gọi
    // thừa (khi event chính ĐÃ fire đúng) là vô hại, không chạy trùng.
    let _lastHrefPolled = location.href;
    setInterval(() => {
        if (location.href === _lastHrefPolled) return;
        _lastHrefPolled = location.href;
        _onNavigate();
    }, 1000);

    // ─── Menu commands ──────────────────────────────────────────────────────
    GM_registerMenuCommand('📺 Xem lịch sử & Export', () => HistoryViewer.open());

    // Auto-downgrade quality khi buffering liên tục — bật mặc định vì rủi ro
    // thấp (chỉ hoạt động khi PlayerControl.getQuality() khả dụng, tự no-op
    // an toàn nếu không) và lợi ích rõ ràng (giảm giật lag trên mạng chậm).
    BufferMonitor.enable();

    // ─── Initial load ─────────────────────────────────────────────────────────
    if (location.pathname === '/watch') {
        const kick = () => setTimeout(_runMain, 600);
        document.readyState === 'loading'
            ? document.addEventListener('DOMContentLoaded', kick)
            : kick();
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────
    window.addEventListener('beforeunload', () => {
        AdBlock.stop();
        VoiceControl.stop();
        VideoContext.detach();
        ChannelDetect.clearCache();
        TabGuard.setCurrentVideo(null); // báo ngay cho tab khác biết tab này đã rời video (không đợi PEER_STALE_MS)
    });

})();
