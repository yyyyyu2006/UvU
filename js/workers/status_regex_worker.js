// Only this disposable worker evaluates user-authored status expressions.
self.onmessage = event => {
    for (let index = 0; index < event.data.jobs.length; index++) {
        const {source, flags, text} = event.data.jobs[index];
        try {
            const match = new RegExp(source, flags).exec(text);
            const stripped = text.replace(new RegExp(source, flags), '');
            self.postMessage({index, match: match ? Array.from(match) : null, stripped});
        } catch (_) { self.postMessage({index, error: 'pattern'}); }
    }
    self.postMessage({done: true});
};
self.postMessage({ready: true});
