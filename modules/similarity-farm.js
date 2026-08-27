// similarity-farm.js — Layer 2: "Farm mode" thu thập dữ liệu similarity HÀNG
// LOẠT cho SimilarityReport (similarity-report.js), phục vụ tinh chỉnh
// JACCARD_THRESHOLD (episode-navigator.js) nhanh hơn nhiều so với xem phim
// bình thường rồi report từng cặp lẻ tẻ.
//
// THAY ĐỔI SO VỚI MÔ TẢ GỐC CỦA USER (minh bạch, không âm thầm đổi): user mô
// tả flow "confirm -> treo máy -> bấm vào phim nhận title -> gửi info ->
// next video" — tức điều hướng THẬT qua từng trang video 1 lượt, giống hệt
// cách EpisodeEngine/Navigator vẫn làm khi xem phim. Đã research: MỌI kênh
// YouTube public đều có RSS feed công khai tại
// `https://www.youtube.com/feeds/videos.xml?channel_id=UC...` trả về title +
// description của tối đa 15 video ĐĂNG GẦN NHẤT — không cần load bất kỳ
// trang video nào, không cần "treo máy" chờ điều hướng từng trang. Dùng RSS
// thay vì click-qua-từng-video: nhanh hơn RẤT nhiều (vài giây/kênh thay vì
// vài phút), không dính rủi ro SPA-nav/hard-reload đã gặp ở navigator.js,
// và tận dụng đúng cơ chế GM_xmlhttpRequest đã dùng nhất quán ở
// sponsor-block.js/similarity-report.js — không cần thêm cơ chế mới.
// ĐÁNH ĐỔI THẬT (không giấu giếm): RSS chỉ có tối đa 15 video GẦN NHẤT/kênh
// (giới hạn CỨNG của Google, đã research xác nhận qua nhiều nguồn độc lập)
// — không có back-catalog sâu như đi bộ qua link "tập sau" thật sự nhiều
// lần liên tiếp. Nếu sau này cần dữ liệu sâu hơn 15 tập gần nhất/kênh, cách
// click-qua-video đúng như user mô tả ban đầu vẫn là hướng cần làm THÊM —
// CHƯA có ở file này, đây không phải bản thay thế hoàn toàn ý tưởng gốc.
//
// "ép cùng kênh, hoặc là 1 whitelist": gộp làm 1 CƠ CHẾ WHITELIST DUY NHẤT —
// whitelist chỉ có 1 kênh = đúng nghĩa "ép cùng kênh"; nhiều kênh = whitelist
// đúng nghĩa user mô tả. Không cần dựng 2 cơ chế riêng cho 2 cách nói khác
// nhau của cùng 1 nhu cầu (giới hạn phạm vi nguồn video được farm).
//
// GIỚI HẠN QUOTA THẬT (đã research — SỬA LẠI 1 thông tin SAI trong
// cf-worker/README.md bản trước: ghi nhầm "KV free tier 100k lượt ghi/ngày"
// — con số ĐÚNG: 100k LƯỢT ĐỌC/ngày nhưng CHỈ 1000 LƯỢT GHI/ngày, khác biệt
// rất lớn và quan trọng trực tiếp với farm mode vì mỗi report() = 1 lượt
// ghi KV). Với tối đa 15 video/kênh, số cặp so sánh trong 1 kênh là
// C(15,2)=105. Farm ~8 kênh đã có thể chạm gần sát ngưỡng 1000/ngày. Cap
// cứng ở MAX_REPORTS_PER_RUN (thấp hơn 1000 có chủ đích, chừa chỗ cho report
// thật phát sinh trong ngày từ việc xem phim bình thường cùng ngày) — nếu
// tổng số cặp tính được vượt cap, LẤY MẪU NGẪU NHIÊN xuống đúng cap thay vì
// cắt thô theo thứ tự duyệt (tránh thiên lệch luôn ưu tiên kênh/video đứng
// trước trong whitelist).

const SimilarityFarm = (() => {
    const WHITELIST_KEY = 'similarityFarmWhitelist'; // JSON array of {name, channelId}
    const MAX_REPORTS_PER_RUN = 800; // xem giải thích quota ở comment đầu file — cố tình < 1000 (giới hạn ghi/ngày thật của Cloudflare KV free tier)
    const REPORT_DELAY_MS = 200; // giãn cách giữa các report — free tier không throttle theo giây (chỉ hard-cap theo ngày), nhưng vẫn là hành vi tốt, tránh burst dồn dập vô ích

    function _getWhitelist() {
        try {
            const parsed = JSON.parse(Storage.getGlobal(WHITELIST_KEY, '[]'));
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) { return []; }
    }
    function _saveWhitelist(list) {
        Storage.setGlobal(WHITELIST_KEY, JSON.stringify(list));
    }

    function addChannel(name, channelId) {
        if (!channelId) return false;
        const list = _getWhitelist();
        if (list.some(c => c.channelId === channelId)) return false; // đã có, không thêm trùng
        list.push({ name: name || channelId, channelId });
        _saveWhitelist(list);
        return true;
    }
    function removeChannel(channelId) {
        _saveWhitelist(_getWhitelist().filter(c => c.channelId !== channelId));
    }
    function getWhitelist() { return _getWhitelist(); }

    /**
     * Parse RSS XML (feed videos.xml) → [{title, description}]. Dùng regex
     * thay vì DOMParser — cấu trúc RSS của YouTube rất ổn định (đã research
     * xác nhận qua nhiều nguồn độc lập cùng mô tả 1 format), và regex chạy
     * được giống hệt cả trong môi trường test Node (không có DOMParser) lẫn
     * trình duyệt thật — không lệch hành vi giữa 2 môi trường, dễ test hơn.
     */
    function _parseFeed(xmlText) {
        const entries = [];
        const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
        let m;
        while ((m = entryRe.exec(xmlText))) {
            const block = m[1];
            const title = _extractTag(block, 'media:title');
            const description = _extractTag(block, 'media:description');
            if (title) entries.push({ title, description });
        }
        return entries;
    }
    function _extractTag(block, tag) {
        const escaped = tag.replace(/:/g, '\\:');
        const re = new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`);
        const m = re.exec(block);
        return m ? _unescapeXml(m[1].trim()) : '';
    }
    function _unescapeXml(s) {
        return s
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');
    }

    function _fetchFeed(channelId) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) resolve(_parseFeed(res.responseText));
                    else { warn('[SimilarityFarm] fetch feed lỗi, status:', res.status, 'kênh:', channelId); resolve([]); }
                },
                onerror: () => { warn('[SimilarityFarm] fetch feed lỗi mạng, kênh:', channelId); resolve([]); },
                ontimeout: () => resolve([]),
            });
        });
    }

    /** Fisher-Yates rồi cắt N phần tử đầu — lấy mẫu KHÔNG thiên lệch khi phải
     * cắt bớt xuống dưới cap, thay vì luôn ưu tiên phần tử đứng trước danh sách. */
    function _sampleDown(arr, n) {
        if (arr.length <= n) return arr;
        const copy = arr.slice();
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy.slice(0, n);
    }

    function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    /** Tính trước tổng số cặp sẽ so sánh nếu chạy whitelist hiện tại — dùng
     * để hiện confirm dialog TRƯỚC KHI thật sự fetch/gửi gì (user cần biết
     * con số trước khi bấm "Đồng ý", không phải sau). Vẫn phải fetch RSS
     * thật để biết SỐ VIDEO THẬT SỰ có trong mỗi kênh (có thể < 15 nếu kênh
     * mới/ít video) — không đoán mù bằng cách giả định luôn đúng 15.
     */
    async function preview() {
        const whitelist = _getWhitelist();
        if (!whitelist.length) return { channels: 0, totalEntries: 0, totalPairs: 0 };
        let totalEntries = 0, totalPairs = 0;
        for (const ch of whitelist) {
            const entries = await _fetchFeed(ch.channelId);
            totalEntries += entries.length;
            totalPairs += (entries.length * (entries.length - 1)) / 2;
        }
        return { channels: whitelist.length, totalEntries, totalPairs };
    }

    /**
     * Chạy farm: fetch RSS mọi kênh trong whitelist, tính pairwise Jaccard
     * cho MỌI cặp video TRONG CÙNG 1 kênh (so sánh xuyên kênh không có ý
     * nghĩa cho mục đích "cùng series hay không"), report từng cặp.
     * @param {(progress:{done:number,total:number})=>void} [onProgress]
     */
    async function run(onProgress) {
        const whitelist = _getWhitelist();
        if (!whitelist.length) return { ok: false, error: 'Whitelist rỗng — thêm kênh trước khi chạy farm.' };
        if (!SimilarityReport.isConfigured()) return { ok: false, error: 'Chưa cấu hình Similarity Report URL — không có gì để gửi đi.' };

        const perChannelEntries = [];
        for (const ch of whitelist) {
            const entries = await _fetchFeed(ch.channelId);
            perChannelEntries.push({ channel: ch, entries });
        }

        const allPairs = [];
        for (const { channel, entries } of perChannelEntries) {
            for (let i = 0; i < entries.length; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    allPairs.push({ channel, a: entries[i], b: entries[j] });
                }
            }
        }

        const totalPossible = allPairs.length;
        const capped = totalPossible > MAX_REPORTS_PER_RUN;
        const pairsToSend = capped ? _sampleDown(allPairs, MAX_REPORTS_PER_RUN) : allPairs;

        let sent = 0;
        for (const pair of pairsToSend) {
            const raw = EpisodeEngine._internal._jaccardRaw(pair.a.title, pair.b.title);
            SimilarityReport.report({
                a: pair.a.title, b: pair.b.title,
                jaccard: raw.score,
                source: 'jaccard',
                // Dùng ĐÚNG ngưỡng thật đang áp dụng trong production
                // (episode-navigator.js), không tự đặt 1 con số riêng ở đây
                // — nếu sau này JACCARD_THRESHOLD đổi, farm mode tự đồng bộ
                // theo, không bị lệch/phải sửa 2 nơi.
                matched: raw.score >= EpisodeEngine._internal.JACCARD_THRESHOLD,
                sizeA: raw.sizeA, sizeB: raw.sizeB, intersection: raw.intersection, union: raw.union,
            });
            sent++;
            if (onProgress) onProgress({ done: sent, total: pairsToSend.length });
            await _delay(REPORT_DELAY_MS);
        }

        return {
            ok: true,
            channelsProcessed: perChannelEntries.length,
            totalEntries: perChannelEntries.reduce((s, c) => s + c.entries.length, 0),
            totalPossiblePairs: totalPossible,
            sent,
            capped,
        };
    }

    return {
        addChannel, removeChannel, getWhitelist,
        preview, run,
        _internal: { _parseFeed, _sampleDown, MAX_REPORTS_PER_RUN },
    };
})();
