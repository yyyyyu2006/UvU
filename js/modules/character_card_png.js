// Local PNG metadata codec. Does not decode pixels or change conversation data.
(function (root) {
    'use strict';
    const MAX_FILE = 32 * 1024 * 1024, MAX_META = 8 * 1024 * 1024;
    const signature = [137, 80, 78, 71, 13, 10, 26, 10], utf8 = new TextEncoder();
    const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
        for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
        return n >>> 0;
    });
    function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
    function inspect(input) {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (bytes.length > MAX_FILE) throw new Error('PNG 文件大小超过 32 MiB 上限');
        if (bytes.length < 45 || signature.some((value, i) => bytes[i] !== value)) throw new Error('PNG 签名无效或文件不完整');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks = [];
        let offset = 8, ended = false, dataSeen = false;
        while (offset < bytes.length) {
            if (offset + 12 > bytes.length) throw new Error('PNG 数据块被截断');
            const size = view.getUint32(offset), end = offset + size + 12;
            if (size > MAX_FILE || end > bytes.length) throw new Error('PNG 数据块长度无效');
            const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
            if (!/^[a-zA-Z]{4}$/.test(type) || crc(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error('PNG 数据块 CRC 校验失败');
            if (!chunks.length && (type !== 'IHDR' || size !== 13)) throw new Error('PNG 缺少有效 IHDR');
            if (type === 'IHDR') {
                if (chunks.length || size !== 13) throw new Error('PNG 图像头重复或无效');
                const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12);
                if (!width || !height || width > 16384 || height > 16384 || width * height > 64 * 1024 * 1024) throw new Error('PNG 图片像素超过上限');
            }
            if (type === 'IDAT') dataSeen = true;
            chunks.push({ type, data: bytes.subarray(offset + 8, end - 4), raw: bytes.subarray(offset, end) });
            if (chunks.length > 10000) throw new Error('PNG 数据块过多');
            offset = end;
            if (type === 'IEND') {
                if (size || offset !== bytes.length || !dataSeen) throw new Error('PNG 结束数据无效');
                ended = true; break;
            }
        }
        if (!ended) throw new Error('PNG 文件缺少完整结束数据');
        return chunks;
    }
    function keyword(chunk) {
        if (chunk.type !== 'tEXt') return '';
        const zero = chunk.data.indexOf(0);
        return zero > 0 && zero <= 79 ? String.fromCharCode(...chunk.data.subarray(0, zero)).toLowerCase() : '';
    }
    function read(bytes) {
        const chunks = inspect(bytes), found = new Map();
        for (const chunk of chunks) {
            const key = keyword(chunk); if (!['chara', 'ccv3'].includes(key)) continue;
            if (found.has(key)) throw new Error('PNG 中存在重复角色数据');
            found.set(key, chunk.data.subarray(chunk.data.indexOf(0) + 1));
        }
        const encoded = found.get('ccv3') || found.get('chara');
        if (!encoded) throw new Error('PNG 中未找到角色数据，请使用未压缩的原图文件');
        if (encoded.length > 4 * Math.ceil(MAX_META / 3)) throw new Error('角色数据过大，超过 8 MiB 上限');
        try {
            const base64 = new TextDecoder('ascii', { fatal: true }).decode(encoded);
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4) throw new Error('Base64');
            const binary = atob(base64), decoded = Uint8Array.from(binary, value => value.charCodeAt(0));
            if (decoded.length > MAX_META) throw new Error('数据超过大小上限');
            const card = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
            if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('对象');
            return card;
        } catch (_) { throw new Error('PNG 角色数据编码或 JSON 无效'); }
    }
    function textChunk(key, value) {
        const body = utf8.encode(key + '\0' + value), bytes = new Uint8Array(body.length + 12), view = new DataView(bytes.buffer);
        view.setUint32(0, body.length); bytes.set(utf8.encode('tEXt'), 4); bytes.set(body, 8); view.setUint32(bytes.length - 4, crc(bytes.subarray(4, -4))); return bytes;
    }
    function write(bytes, card) {
        const chunks = inspect(bytes), json = JSON.stringify(card);
        if (!json || json.length > MAX_META) throw new Error('角色数据过大，超过 8 MiB 上限');
        const encoded = utf8.encode(json); if (encoded.length > MAX_META) throw new Error('角色数据过大，超过 8 MiB 上限');
        let binary = ''; for (let i = 0; i < encoded.length; i += 16384) binary += String.fromCharCode(...encoded.subarray(i, i + 16384));
        const parts = [new Uint8Array(signature)];
        for (const chunk of chunks) {
            if (['chara', 'ccv3'].includes(keyword(chunk))) continue;
            if (chunk.type === 'IEND') parts.push(textChunk(card.spec === 'chara_card_v3' ? 'ccv3' : 'chara', btoa(binary)));
            parts.push(chunk.raw);
        }
        const length = parts.reduce((sum, part) => sum + part.length, 0);
        if (length > MAX_FILE) throw new Error('导出 PNG 文件大小超过 32 MiB 上限');
        const output = new Uint8Array(length); let offset = 0;
        for (const part of parts) { output.set(part, offset); offset += part.length; }
        if (JSON.stringify(read(output)) !== json) throw new Error('PNG 角色数据读回校验失败');
        return output;
    }
    root.UvUCardPng = { read, write, inspect, maxFileBytes: MAX_FILE, maxMetadataBytes: MAX_META };
})(typeof window !== 'undefined' ? window : globalThis);
