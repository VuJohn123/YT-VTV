function detectEpisodeType(title) {
    const t = title.toLowerCase();
    if (/trực tiếp|live/i.test(t)) return 'live';
    if (/preview/i.test(t)) return 'preview';
    if (/shorts/i.test(t)) return 'short';
    if (/trailer official/i.test(t)) return 'trailer';
    if (/highlight|trích đoạn/i.test(t)) return 'highlight';
    if (/tóm tắt|recap|tổng hợp/i.test(t)) return 'recap';
    if (/ngoại truyện|ngoại truyen/i.test(t)) return 'ngoai_truyen';
    if (/đặc biệt|tập đặc biệt|special/i.test(t)) return 'dac_biet';
    if (/full tập|full hd|tập cuối|cuối cùng/i.test(t)) return 'full';
    return 'unknown';
}
function detectGenres(desc) {
    const genres = [];
    const d = desc.toLowerCase();
    if (/tình cảm|tình yêu|lãng mạn|romance/i.test(d)) genres.push('tinh_cam');
    if (/hình sự|cảnh sát|phá án|điều tra/i.test(d)) genres.push('hinh_su');
    if (/hài hước|hài|comedy/i.test(d)) genres.push('hai');
    if (/hành động|action|võ thuật/i.test(d)) genres.push('hanh_dong');
    if (/kinh dị|ma|ghost|horror/i.test(d)) genres.push('kinh_di');
    if (/viễn tưởng|sci-fi|khoa học/i.test(d)) genres.push('vien_tuong');
    if (/phiêu lưu|adventure/i.test(d)) genres.push('phieu_luu');
    if (/cổ trang|kiếm hiệp|historical/i.test(d)) genres.push('co_trang');
    if (/tâm lý|psychological/i.test(d)) genres.push('tam_ly');
    if (/đời thường|gia đình|family/i.test(d)) genres.push('doi_thuong');
    return genres;
}