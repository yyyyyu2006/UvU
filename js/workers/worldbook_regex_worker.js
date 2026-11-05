// User regexes run only in this disposable worker. The caller enforces one total
// wall-clock budget and terminates the worker on timeout or cancellation.
self.onmessage = event => {
    const jobs = event.data.jobs;
    for (let index = 0; index < jobs.length; index++) {
        const { source, flags, text } = jobs[index];
        let matched = false;
        try { matched = new RegExp(source, flags).test(text); } catch (_) {}
        self.postMessage({ index, matched });
    }
    self.postMessage({ done: true });
};
