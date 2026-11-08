// Local cover artwork only. This module never reads chats, settings or the network.
(function (root) {
    'use strict';
    const WIDTH = 900, HEIGHT = 1200, PHOTO = { x: 60, y: 255, width: 300, height: 400 };
    const clean = (value, max = 40) => Array.from(typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '').slice(0, max).join('');
    function profile(data, overrides = {}) {
        const source = data.extensions?.uvu?.cover || {}, value = key => Object.hasOwn(overrides, key) ? overrides[key] : source[key];
        let hash = 2166136261;
        for (const char of String(data.name || '') + '\n' + String(data.description || '')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
        return { version: 1, style: 'identification', birthday: clean(value('birthday')), identity: clean(value('identity')) || '角色', nationality: clean(value('nationality')), serial: 'UVU — ' + (hash >>> 0).toString(16).toUpperCase().padStart(8, '0') };
    }
    function rounded(context, x, y, width, height, radius) {
        context.beginPath(); context.moveTo(x + radius, y);
        context.arcTo(x + width, y, x + width, y + height, radius); context.arcTo(x + width, y + height, x, y + height, radius);
        context.arcTo(x, y + height, x, y, radius); context.arcTo(x, y, x + width, y, radius); context.closePath();
    }
    function text(context, value, x, y, width, size, family = 'sans-serif', min = size) {
        let chars = Array.from(String(value)), actual = size;
        context.font = actual + 'px ' + family;
        while (actual > min && context.measureText(chars.join('')).width > width) { actual -= 2; context.font = actual + 'px ' + family; }
        if (context.measureText(chars.join('')).width > width) {
            while (chars.length && context.measureText(chars.join('') + '…').width > width) chars.pop();
            chars.push('…');
        }
        context.fillText(chars.join(''), x, y);
    }
    function draw(canvas, data, options, image = null) {
        const card = profile(data, options), name = clean(data.name, 2000) || '未命名';
        canvas.width = WIDTH; canvas.height = HEIGHT;
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法生成 PNG 图片');
        const serif = 'Georgia, "Times New Roman", serif', chinese = '"Songti SC", SimSun, serif';
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.save(); rounded(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, 30); ctx.clip();
        ctx.fillStyle = '#17191c'; ctx.fillRect(0, 0, WIDTH, 165); ctx.fillRect(0, 182, WIDTH, 5); ctx.fillRect(0, 1165, WIDTH, 35);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        text(ctx, 'Identification Card', WIDTH / 2, 84, 720, 64, serif, 52);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
        for (const [x, direction] of [[66, -1], [834, 1]]) { ctx.beginPath(); ctx.moveTo(x - direction * 9, 68); ctx.lineTo(x + direction * 9, 84); ctx.lineTo(x - direction * 9, 100); ctx.stroke(); }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const { x: px, y: py, width: pw, height: ph } = PHOTO;
        ctx.fillStyle = '#eef3f8'; ctx.fillRect(px, py, pw, ph);
        if (image) {
            const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
            if (!Number.isFinite(iw) || !Number.isFinite(ih) || iw <= 0 || ih <= 0) throw new Error('角色头像尺寸无效');
            const scale = Math.max(pw / iw, ph / ih), sw = pw / scale, sh = ph / scale;
            ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
            ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, px, py, pw, ph); ctx.restore();
        } else {
            ctx.fillStyle = '#94a6ba'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            text(ctx, Array.from(name)[0], px + pw / 2, py + ph / 2, pw - 40, 105, chinese); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        }
        ctx.strokeStyle = '#252b31'; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);
        // Decorative bars: no URL, authentication code or live database ID is encoded.
        const bars = [2,1,1,2,3,1,1,2,2,1,4,2,1,1,3,2,2,1,1,3,4,1,2,1,3,2,1,1,2,3,1,2,4,1,2,2,1,3];
        const total = bars.reduce((sum, n) => sum + n, 0); let bx = px + 2;
        ctx.fillStyle = '#17191c'; bars.forEach((bar, i) => { const width = bar / total * (pw - 4); if (!(i % 2)) ctx.fillRect(bx, 685, width, 70); bx += width; });
        ctx.fillStyle = '#5f6872'; ctx.textAlign = 'center'; text(ctx, card.serial, px + pw / 2, 789, pw, 24, 'monospace', 20); ctx.textAlign = 'left';
        const x = 420, fieldWidth = 420;
        function field(label, value, y, size = 40, family = 'sans-serif') {
            ctx.fillStyle = '#70777f'; text(ctx, label, x, y, fieldWidth, 25);
            ctx.fillStyle = '#17191c'; text(ctx, value || '—', x, y + (size > 40 ? 76 : 53), fieldWidth, size, family, size > 40 ? 44 : 28);
        }
        field('NAME', name, 279, 70, chinese); field('DATE OF BIRTH', card.birthday, 421); field('IDENTITY', card.identity, 555); field('NATIONALITY', card.nationality, 689);
        ctx.fillStyle = '#17191c'; text(ctx, name, 60, 1040, 420, 68, '"Kaiti SC", KaiTi, STKaiti, serif', 42);
        ctx.strokeStyle = '#bac1c9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(60, 1066); ctx.lineTo(480, 1066); ctx.stroke();
        ctx.fillStyle = '#7b8189'; text(ctx, 'SIGNATURE', 60, 1106, 420, 23);
        ctx.strokeStyle = '#a3b9d2'; ctx.strokeRect(670, 1000, 170, 115); ctx.fillStyle = '#7492b3'; ctx.textAlign = 'center';
        text(ctx, 'UvU', 755, 1065, 150, 58); text(ctx, 'CHARACTER', 755, 1094, 150, 19);
        ctx.restore(); ctx.strokeStyle = '#d5d9de'; ctx.lineWidth = 2; rounded(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, 30); ctx.stroke();
        return canvas;
    }
    async function restoreAvatar(source, data) {
        const cover = data?.extensions?.uvu?.cover;
        if (cover?.version !== 1 || cover.style !== 'identification') return source;
        const image = new Image(), canvas = document.createElement('canvas');
        try {
            await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('读取角色卡封面失败')); image.src = source; });
            if (image.naturalWidth !== WIDTH || image.naturalHeight !== HEIGHT) return source;
            canvas.width = PHOTO.width; canvas.height = PHOTO.height;
            const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法读取角色卡头像');
            ctx.drawImage(image, PHOTO.x, PHOTO.y, PHOTO.width, PHOTO.height, 0, 0, PHOTO.width, PHOTO.height);
            return canvas.toDataURL('image/png');
        } finally { image.onload = image.onerror = null; image.src = ''; canvas.width = canvas.height = 1; }
    }
    root.UvUCardCover = { profile, draw, restoreAvatar };
})(typeof window !== 'undefined' ? window : globalThis);
