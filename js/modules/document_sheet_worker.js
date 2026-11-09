/* SheetJS 0.20.3, local-only parsing. Formulas/macros are not executed. */
importScripts('../vendor/sheetjs/xlsx.full.min.js');
self.onmessage = event => {
    try {
        const workbook = XLSX.read(event.data, { type: 'array', cellHTML: false, cellFormula: false, cellStyles: false, bookVBA: false, sheetRows: 5001 });
        if (workbook.SheetNames.length > 30) throw new Error('表格超过30个工作表，请拆分');
        const parts = [], extractionReport = []; let length = 0;
        for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            if (sheet['!fullref']) throw new Error('工作表超过5000行，请拆分');
            const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
            if (range.e.r >= 5000 || range.e.c >= 100) throw new Error('每表最多5000行、100列，请拆分');
            const part = `【工作表：${name}】\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`;
            extractionReport.push(`工作表 ${String(name).slice(0, 100)}：${sheet['!ref'] || '空表'}，范围 ${range.e.r - range.s.r + 1} 行 × ${range.e.c - range.s.c + 1} 列；省略空白行${sheet['!merges']?.length ? '；' + sheet['!merges'].length + '处合并单元格仅提取已有值' : ''}`);
            length += part.length; if (length > 100000) throw new Error('表格超过100000字符，请拆分'); parts.push(part);
        }
        self.postMessage({ text: parts.join('\n\n'), extractionReport, warnings: ['表格按工作表转为CSV文字；公式仅读取已有缓存值，不运行公式或宏；图片、样式和复杂排版不参与编辑'] });
    } catch (error) { self.postMessage({ error: error.message || '表格解析失败' }); }
};
