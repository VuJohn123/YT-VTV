// history-viewer.js — Layer 3: Timeline visualizer + export playlist
//
// Mở 1 tab mới chứa trang HTML tự-đóng-gói (data URL) hiển thị:
//   - Calendar heatmap lịch sử xem (dựa trên watchedAt timestamp)
//   - Danh sách series đã xem, số tập, có thể export M3U/JSON
// Không cần server, không cần file riêng — toàn bộ HTML/CSS/JS generate
// runtime rồi mở bằng GM_openInTab (an toàn hơn window.open bị popup blocker
// chặn) hoặc window.open làm fallback.

const HistoryViewer = (() => {
    function _escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function _buildHeatmapData(allHistory) {
        // Gộp tất cả episode.watchedAt thành map "YYYY-MM-DD" → count
        const dayCounts = {};
        for (const series of allHistory) {
            for (const ep of series.episodes) {
                if (!ep.watchedAt) continue;
                const day = new Date(ep.watchedAt).toISOString().slice(0, 10);
                dayCounts[day] = (dayCounts[day] || 0) + 1;
            }
        }
        return dayCounts;
    }

    /**
     * Thống kê tổng hợp — dựa HOÀN TOÀN trên data đã có sẵn (Storage.getStats
     * cho tổng giờ xem/series, watchedAt timestamp cho khung giờ hay xem).
     * KHÔNG có "tập hay bỏ dở" ở đây: model dữ liệu hiện tại (getLastPosition)
     * chỉ lưu 1 vị trí xem dở gần nhất mỗi series, không lưu lịch sử hoàn
     * thành từng tập riêng lẻ — không đủ dữ liệu để thống kê đáng tin cậy,
     * nên không đưa vào thay vì bịa ra con số không chính xác.
     */
    function _buildAggregateStats(allHistory) {
        let totalSeconds = 0;
        const perSeries = allHistory.map(s => {
            const stats = Storage.getStats(s.seriesKey);
            totalSeconds += stats.totalTime || 0;
            return { seriesKey: s.seriesKey, name: s.seriesKey.split('|')[0], seconds: stats.totalTime || 0 };
        }).sort((a, b) => b.seconds - a.seconds);

        // Khung giờ hay xem nhất trong ngày (0-23h), dùng watchedAt đã có sẵn
        const hourCounts = new Array(24).fill(0);
        const allDays = new Set();
        for (const s of allHistory) {
            for (const ep of s.episodes) {
                if (!ep.watchedAt) continue;
                const d = new Date(ep.watchedAt);
                hourCounts[d.getHours()]++;
                allDays.add(d.toISOString().slice(0, 10));
            }
        }
        const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

        // Streak: số ngày liên tục gần nhất (tính từ hôm nay lùi về) có xem ít nhất 1 tập
        let streak = 0;
        const cursor = new Date();
        while (true) {
            const key = cursor.toISOString().slice(0, 10);
            if (!allDays.has(key)) break;
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }

        return { totalSeconds, perSeries, hourCounts, peakHour, streak };
    }

    function _fmtHours(seconds) {
        const h = seconds / 3600;
        return h < 1 ? `${Math.round(seconds / 60)} phút` : `${h.toFixed(1)} giờ`;
    }

    function _buildHtml(allHistory) {
        const dayCounts = _buildHeatmapData(allHistory);
        const totalEpisodes = allHistory.reduce((s, x) => s + x.episodes.length, 0);
        const agg = _buildAggregateStats(allHistory);

        // Heatmap 12 tuần gần nhất (đơn giản, không cần thư viện ngoài)
        const today = new Date();
        const cells = [];
        for (let i = 83; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const count = dayCounts[key] || 0;
            const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3;
            cells.push(`<div class="cell lv${level}" title="${key}: ${count} tập"></div>`);
        }

        const hourBars = agg.hourCounts.map((c, h) => {
            const max = Math.max(...agg.hourCounts, 1);
            const pct = Math.round((c / max) * 100);
            return `<div class="hbar" title="${h}h: ${c} tập"><div class="hbar-fill" style="height:${pct}%"></div><div class="hbar-label">${h}</div></div>`;
        }).join('');

        const topSeriesRows = agg.perSeries.slice(0, 5).filter(s => s.seconds > 0).map(s =>
            `<tr><td>${_escapeHtml(s.name)}</td><td>${_fmtHours(s.seconds)}</td></tr>`
        ).join('') || '<tr><td colspan="2" style="color:#666">Chưa có dữ liệu thời lượng xem</td></tr>';

        const seriesRows = allHistory.map(s => {
            const eps = s.episodes.slice().sort((a, b) => a.episode - b.episode);
            const first = eps[0], last = eps[eps.length - 1];
            return `<tr>
                <td>${_escapeHtml(s.seriesKey.split('|')[0])}</td>
                <td>${eps.length}</td>
                <td>${first?.episode ?? '-'} → ${last?.episode ?? '-'}</td>
                <td><button class="exp-btn" data-key="${_escapeHtml(s.seriesKey)}">Export</button></td>
            </tr>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8"><title>VTV Ultimate — Lịch sử xem</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #eee; padding: 24px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20px; } h2 { font-size: 15px; color: #aaa; margin-top: 32px; }
  .stat { font-size: 13px; color: #999; margin-bottom: 16px; }
  .heatmap { display: grid; grid-template-columns: repeat(12, 1fr); gap: 3px; max-width: 400px; }
  .cell { width: 100%; aspect-ratio: 1; border-radius: 2px; background: #222; }
  .cell.lv1 { background: #0e4429; } .cell.lv2 { background: #26a641; } .cell.lv3 { background: #39d353; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #333; font-size: 13px; }
  button { background: #333; color: #eee; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  button:hover { background: #444; }
  #export-all { margin-top: 16px; }
  .stat-cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
  .stat-card { background: #1a1a1a; border-radius: 8px; padding: 12px 16px; min-width: 120px; }
  .stat-card .num { font-size: 22px; font-weight: 600; color: #39d353; }
  .stat-card .lbl { font-size: 11px; color: #999; margin-top: 2px; }
  .hourchart { display: flex; align-items: flex-end; gap: 2px; height: 80px; max-width: 500px; margin-top: 8px; }
  .hbar { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; }
  .hbar-fill { width: 100%; background: #26a641; border-radius: 2px 2px 0 0; min-height: 2px; }
  .hbar-label { font-size: 8px; color: #666; margin-top: 2px; }
</style></head>
<body>
  <h1>📺 VTV Ultimate — Lịch sử xem</h1>
  <div class="stat">${allHistory.length} series · ${totalEpisodes} tập đã xem</div>

  <h2>Thống kê tổng hợp</h2>
  <div class="stat-cards">
    <div class="stat-card"><div class="num">${_fmtHours(agg.totalSeconds)}</div><div class="lbl">Tổng thời gian xem</div></div>
    <div class="stat-card"><div class="num">${agg.streak}</div><div class="lbl">Ngày liên tục xem</div></div>
    <div class="stat-card"><div class="num">${agg.peakHour}h</div><div class="lbl">Khung giờ hay xem nhất</div></div>
  </div>
  <h2>Khung giờ xem trong ngày</h2>
  <div class="hourchart">${hourBars}</div>
  <h2>Top series theo thời lượng xem</h2>
  <table><thead><tr><th>Series</th><th>Thời lượng</th></tr></thead><tbody>${topSeriesRows}</tbody></table>

  <h2>Hoạt động 12 tuần gần đây</h2>
  <div class="heatmap">${cells.join('')}</div>
  <h2>Danh sách series</h2>
  <table><thead><tr><th>Series</th><th>Số tập</th><th>Khoảng tập</th><th></th></tr></thead>
  <tbody>${seriesRows}</tbody></table>
  <div id="export-all">
    <button id="export-json-all">⬇ Export tất cả (JSON)</button>
  </div>
<script>
  const DATA = ${JSON.stringify(allHistory).replace(/<\/script/gi, '<\\/script')};
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }
  function toM3U(series) {
    let out = '#EXTM3U\\n';
    const cleanName = series.seriesKey.split('|')[0].replace(/[\\r\\n]+/g, ' ');
    for (const ep of series.episodes.slice().sort((a,b)=>a.episode-b.episode)) {
      out += '#EXTINF:-1,' + cleanName + ' - Tập ' + ep.episode + '\\n' + ep.url + '\\n';
    }
    return out;
  }
  document.querySelectorAll('.exp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const series = DATA.find(s => s.seriesKey === btn.dataset.key);
      if (!series) return;
      download(series.seriesKey.split('|')[0] + '.m3u', toM3U(series), 'audio/x-mpegurl');
    });
  });
  document.getElementById('export-json-all').addEventListener('click', () => {
    download('vtv-history.json', JSON.stringify(DATA, null, 2), 'application/json');
  });
</script>
</body></html>`;
    }

    function open() {
        const allHistory = Storage.getAllHistory();
        const html = _buildHtml(allHistory);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        // window.open thay vì GM_openInTab: GM_openInTab cần thêm @grant riêng
        // và không phải Tampermonkey version nào cũng hỗ trợ tab options giống
        // nhau; window.open với data blob URL hoạt động nhất quán hơn, chấp
        // nhận rủi ro nhỏ bị popup-blocker chặn nếu không phải từ user gesture
        // trực tiếp (menu command luôn tính là user gesture nên an toàn).
        window.open(url, '_blank');
        // Thu hồi URL sau 1 khoảng đủ để tab mới load xong nội dung.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }

    return { open };
})();
