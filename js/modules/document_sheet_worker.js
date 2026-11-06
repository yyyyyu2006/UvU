/* SheetJS 0.20.3, local-only parsing. Formulas/macros are not executed. */
importScripts('../vendor/sheetjs/xlsx.full.min.js');
self.onmessage = event => {
    try {
        const workbook = XLSX.read(event.data, { type: 'array', cellHTML: false, cellFormula: false, cellStyles: false, bookVBA: false, sheetRows: 5001 });
        if (workbook.SheetNames.length > 30) throw new Error('表格超过30个工作表，请拆分');
        const parts = []; let length = 0;
        for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            if (sheet['!fullref']) throw new Error('工作表超过5000行，请拆分');
            const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
            if (range.e.r >= 5000 || range.e.c >= 100) throw new Error('每表最多5000行、100列，请拆分');
            const part = `【工作表：${name}】\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`;
            length += part.length; if (length > 100000) throw new Error('表格超过100000字符，请拆分'); parts.push(part);
        }
        self.postMessage({ text: parts.join('\n\n'), warnings: ['表格按工作表转为CSV文字；不运行公式或宏，仅读取已有单元格值，复杂排版不保留'] });
    } catch (error) { self.postMessage({ error: error.message || '表格解析失败' }); }
};
