// Exact cosine scores only. No prompts, API keys, or chat text enter this worker.
self.onmessage = event => {
    try {
        const { query, vectors } = event.data;
        const dimension = query.length;
        if (!dimension || vectors.length % dimension) throw new Error('向量维度无效');
        const scores = new Float64Array(vectors.length / dimension);
        let queryNorm = 0;
        for (const value of query) queryNorm += value * value;
        for (let row = 0; row < scores.length; row++) {
            let dot = 0, norm = 0;
            for (let i = 0; i < dimension; i++) {
                const value = vectors[row * dimension + i];
                dot += query[i] * value;
                norm += value * value;
            }
            scores[row] = queryNorm && norm ? dot / Math.sqrt(queryNorm * norm) : 0;
        }
        self.postMessage({ scores }, [scores.buffer]);
    } catch (error) { self.postMessage({ error: error.message }); }
};
