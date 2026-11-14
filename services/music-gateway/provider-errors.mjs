// Only these public categories may cross a worker or HTTP boundary.
const STATUS = Object.freeze({
    provider_unavailable: 502, provider_invalid_response: 502, provider_http_error: 502,
    provider_timeout: 504, provider_busy: 503, provider_cancelled: 503
});
export function providerError(code = 'provider_unavailable') {
    const safe = Object.hasOwn(STATUS, code) ? code : 'provider_unavailable';
    return Object.assign(new Error('Platform request failed'), { code: safe, status: STATUS[safe] });
}
export function safeProviderFailure(value) {
    if (value instanceof SyntaxError) return providerError('provider_invalid_response');
    if (value?.name === 'TimeoutError') return providerError('provider_timeout');
    if (value?.name === 'AbortError') return providerError('provider_cancelled');
    return providerError(value?.code);
}
