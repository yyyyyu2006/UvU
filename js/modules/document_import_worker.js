/* Same pinned Mammoth version as the existing browser importer (BSD-2-Clause). */
importScripts('https://unpkg.com/mammoth@1.4.21/mammoth.browser.min.js');
self.onmessage = async event => {
    try {
        const { buffer: arrayBuffer, images } = event.data;
        let result;
        if (!images) result = await mammoth.extractRawText({ arrayBuffer });
        else {
            let imageBytes = 0, imageCount = 0;
            result = await mammoth.convertToHtml({ arrayBuffer }, {
                convertImage: mammoth.images.imgElement(async image => {
                    if (++imageCount > 300) throw new Error('单个文档最多包含300张表情图片');
                    if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(image.contentType)) return { src: '' };
                    const base64 = await image.read('base64'); imageBytes += base64.length;
                    if (imageBytes > 30 * 1024 * 1024) throw new Error('文档图片总量过大，请拆分后导入');
                    return { src: `data:${image.contentType};base64,${base64}` };
                })
            });
        }
        if (result.value.length > (images ? 40 * 1024 * 1024 : 2000000)) throw new Error('文档内容过多，请拆分后导入');
        self.postMessage({ value: result.value });
    } catch (error) { self.postMessage({ error: error.message || 'DOCX解析失败' }); }
};
