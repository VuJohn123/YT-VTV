# Similarity Report Worker (tuỳ chọn, mặc định TẮT)

Worker Cloudflare nhỏ để nhận report ẩn danh mỗi khi `episode-navigator.js`
match 2 tên series qua Jaccard similarity hoặc SeriesLearner (thay vì exact
string match) — mục đích duy nhất: tích luỹ dữ liệu THẬT để sau này tinh
chỉnh `JACCARD_THRESHOLD` (hiện đang là 0.5, chọn theo cảm tính chứ không có
dữ liệu hỗ trợ).

**Đây hoàn toàn tuỳ chọn.** Nếu bạn không deploy Worker này và không cấu
hình URL, `similarity-report.js` không bao giờ gửi bất kỳ request nào ra
ngoài — 0 ảnh hưởng tới trải nghiệm dùng userscript.

## 1. Deploy (hoặc redeploy nếu đã có Worker cũ)

Nếu bạn đã deploy Worker này rồi (vd domain
`vtv-similarity-report.minhvutanlaphanoi.workers.dev`) và chỉ cần cập nhật
lên bản có thêm `/stats`, chỉ cần chạy lại `wrangler deploy` ở bước 4 —
không cần tạo lại KV namespace, `wrangler.toml` vẫn dùng `id` cũ.

Cần tài khoản Cloudflare (free tier đủ dùng — KV free tier: 100k lượt ghi/ngày).

```bash
cd cf-worker
npm install -g wrangler   # nếu chưa có
wrangler login

# Tạo KV namespace để lưu report
wrangler kv namespace create SIMILARITY_REPORTS
# Lệnh trên in ra 1 dòng dạng:
#   { binding = "SIMILARITY_REPORTS", id = "abcd1234..." }
# Copy "id" đó, dán vào wrangler.toml (thay chỗ "DÁN_ID_KV_NAMESPACE_CỦA_BẠN_VÀO_ĐÂY")

wrangler deploy
```

Sau khi deploy xong, Wrangler in ra URL dạng:
`https://vtv-similarity-report.<tên-tài-khoản-cloudflare-của-bạn>.workers.dev`

## 2. Cấu hình userscript trỏ vào Worker

1. Mở menu Tampermonkey → script này → **📊 Cấu hình Similarity Report (tuỳ chọn)**
2. Dán URL Worker vừa deploy ở bước 1 vào.
3. **Quan trọng — @connect**: Tampermonkey yêu cầu khai `@connect` đúng
   domain thì `GM_xmlhttpRequest` mới được phép gọi ra. Domain Worker của
   bạn là riêng cho từng tài khoản Cloudflare
   (`<tên-của-bạn>.workers.dev`), nên userscript gốc **không thể khai sẵn**
   dòng này cho mọi user được (đã thử `@connect workers.dev` — không hoạt
   động vì Tampermonkey không tự khớp subdomain với domain trần, và ngay cả
   `@connect *.workers.dev` cũng có bug đã biết không khớp 1 số subdomain —
   xem [Tampermonkey issue #1593](https://github.com/Tampermonkey/tampermonkey/issues/1593)).
   Bạn cần tự thêm 1 dòng vào bản cài đặt riêng của mình:
   - Tampermonkey Dashboard → click vào script này → tab **Edit**
   - Thêm dòng (đúng domain Worker của bạn):
     ```
     // @connect  vtv-similarity-report.ten-cua-ban.workers.dev
     ```
   - Lưu lại (Ctrl+S). Nếu bỏ qua bước này, request sẽ bị Tampermonkey
     chặn với lỗi "URL is not a part of the @connect list" trong console —
     tính năng tự fail-silent (không crash gì khác), chỉ đơn giản là không
     gửi được report.

## 3. Xem dữ liệu đã thu thập

Mở thẳng trên trình duyệt: `https://<worker-cua-ban>.workers.dev/stats`
— trang HTML thống kê tự render: tổng số report, tỉ lệ matched, breakdown
theo nguồn (Jaccard/SeriesLearner), **histogram phân bố điểm Jaccard** (dùng
cái này để tự quyết định `JACCARD_THRESHOLD` phù hợp thay vì đoán), và bảng
50 report gần nhất. Không cần cài thêm gì, không cần `wrangler kv` — chỉ cần
mở URL.

Muốn xem dữ liệu thô thay vì trang thống kê:
```bash
wrangler kv key list --binding=SIMILARITY_REPORTS
wrangler kv key get --binding=SIMILARITY_REPORTS "report:<timestamp>:<suffix>"
```

## Rủi ro cần biết

- Cả 2 endpoint (`POST /` và `GET /stats`) **không có auth** — ai biết URL
  đều xem/gửi được. Vì payload chỉ chứa 2 chuỗi tên series (dữ liệu vốn
  public trên YouTube) + 1 số điểm Jaccard, rủi ro thực tế thấp, nhưng
  Worker vẫn giới hạn kích thước payload (2KB) và validate schema để chặn
  spam/abuse thô sơ ở endpoint ghi. Nếu không muốn ai cũng xem được trang
  `/stats`, tự thêm check `request.headers.get('Authorization')` hoặc 1
  query param bí mật đơn giản trước khi deploy.
- Free tier Cloudflare Workers/KV có giới hạn (KV: 100k đọc/ngày, 1000
  ghi-list-xoá/ngày, 1GB lưu trữ; Worker: 1000 subrequest tới KV/lần gọi —
  `/stats` cap ở 1000 report gần nhất để luôn nằm gọn trong free tier). Dùng
  cá nhân sẽ không bao giờ chạm ngưỡng này trong nhiều tháng "cày phim" bình
  thường.
