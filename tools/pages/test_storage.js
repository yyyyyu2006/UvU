// Included only in the generated /test/ site. Production assets are not changed.
(function () {
    'use strict';
    const prefix = 'uvu-test:';
    const nativeLocal = window.localStorage, nativeSession = window.sessionStorage;
    function scoped(storage) {
        const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(key => key?.startsWith(prefix));
        const methods = {
            getItem(key) { return storage.getItem(prefix + String(key)); },
            setItem(key, value) { storage.setItem(prefix + String(key), String(value)); },
            removeItem(key) { storage.removeItem(prefix + String(key)); },
            clear() { for (const key of keys()) storage.removeItem(key); },
            key(index) { const key = keys()[Number(index)]; return key === undefined ? null : key.slice(prefix.length); }
        };
        return new Proxy(Object.create(null), {
            get(_, key) { if (key === 'length') return keys().length; if (key in methods) return methods[key]; return typeof key === 'string' ? methods.getItem(key) ?? undefined : undefined; },
            set(_, key, value) { methods.setItem(key, value); return true; },
            deleteProperty(_, key) { methods.removeItem(key); return true; },
            ownKeys() { return keys().map(key => key.slice(prefix.length)); },
            getOwnPropertyDescriptor(_, key) { if (typeof key === 'string' && methods.getItem(key) !== null) return { value: methods.getItem(key), enumerable: true, writable: true, configurable: true }; },
            has(_, key) { return key === 'length' || key in methods || (typeof key === 'string' && methods.getItem(key) !== null); }
        });
    }
    const local = scoped(nativeLocal), session = scoped(nativeSession);
    Object.defineProperty(window, 'localStorage', { value: local });
    Object.defineProperty(window, 'sessionStorage', { value: session });
    window.addEventListener('storage', event => {
        if (event.storageArea !== nativeLocal && event.storageArea !== nativeSession) return;
        event.stopImmediatePropagation();
        if (event.key !== null && !event.key.startsWith(prefix)) return;
        const translated = new Event('storage');
        for (const [key, value] of Object.entries({ key: event.key === null ? null : event.key.slice(prefix.length), oldValue: event.oldValue,
            newValue: event.newValue, url: event.url, storageArea: event.storageArea === nativeLocal ? local : session })) {
            Object.defineProperty(translated, key, { value });
        }
        window.dispatchEvent(translated);
    }, true);
    if (typeof BroadcastChannel === 'function') {
        const NativeChannel = window.BroadcastChannel;
        window.BroadcastChannel = new Proxy(NativeChannel, { construct(Target, args) { return new Target(prefix + args[0]); } });
    }
    if (navigator.locks?.request) {
        const locks = navigator.locks;
        const request = locks.request.bind(locks);
        Object.defineProperty(locks, 'request', { value(name, ...args) { return request(prefix + name, ...args); } });
    }
    Object.defineProperty(window, 'UvUTestEnvironment', { value: Object.freeze({ channel: 'test', storagePrefix: prefix }) });
}());
