"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stealthLaunchOptions = void 0;
exports.stealthArgs = stealthArgs;
exports.applyStealthToContext = applyStealthToContext;
/** Extra CLI flags for chromium.launch({ args: stealthArgs() }) */
function stealthArgs() {
    return [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--no-sandbox',
        '--disable-web-security',
        '--allow-running-insecure-content',
    ];
}
/** Default launch options that look like a real Chrome install */
exports.stealthLaunchOptions = {
    headless: false,
    // Use the real installed Chrome when available — far harder to detect
    channel: 'chrome',
    args: stealthArgs(),
};
/**
 * Apply stealth init scripts to an existing BrowserContext.
 * Call this immediately after browser.newContext() / browser.newPage().
 */
async function applyStealthToContext(context) {
    await context.addInitScript(() => {
        // 1. Delete the webdriver property
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // 2. Spoof plugins (empty array is a bot signal)
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const arr = [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 },
                ];
                arr.item = (i) => arr[i];
                arr.namedItem = (name) => arr.find(p => p.name === name) ?? null;
                arr.refresh = () => { };
                return arr;
            },
        });
        // 3. Spoof languages
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        // 4. Restore chrome object (missing in headless Chromium)
        if (!window.chrome) {
            window.chrome = {
                runtime: {
                    onConnect: { addListener: () => { } },
                    onMessage: { addListener: () => { } },
                    connect: () => { },
                    sendMessage: () => { },
                    getPlatformInfo: (cb) => cb({ os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' }),
                },
                loadTimes: () => ({
                    requestTime: Date.now() / 1000 - Math.random() * 2,
                    startLoadTime: Date.now() / 1000 - Math.random(),
                    commitLoadTime: Date.now() / 1000,
                    finishDocumentLoadTime: Date.now() / 1000,
                    finishLoadTime: Date.now() / 1000,
                    firstPaintTime: 0,
                    firstPaintAfterLoadTime: 0,
                    navigationType: 'Other',
                    wasFetchedViaSpdy: false,
                    wasNpnNegotiated: false,
                    npnNegotiatedProtocol: 'unknown',
                    wasAlternateProtocolAvailable: false,
                    connectionInfo: 'http/1.1',
                }),
                csi: () => ({
                    startE: Date.now(),
                    onloadT: Date.now(),
                    pageT: Math.random() * 3000,
                    tran: 15,
                }),
            };
        }
        // 5. Permissions API — real Chrome resolves 'granted' for notifications query
        const originalQuery = window.navigator.permissions?.query?.bind(navigator.permissions);
        if (originalQuery) {
            navigator.permissions.query = (params) => params?.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission, onchange: null })
                : originalQuery(params);
        }
        // 6. Slight canvas noise to foil fingerprinting
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
            const ctx = this.getContext('2d');
            if (ctx) {
                const imageData = ctx.getImageData(0, 0, this.width || 1, this.height || 1);
                for (let i = 0; i < imageData.data.length; i += 400) {
                    imageData.data[i] ^= Math.floor(Math.random() * 3);
                }
                ctx.putImageData(imageData, 0, 0);
            }
            return origToDataURL.call(this, type, quality);
        };
    });
    // Set a realistic desktop user-agent
    await context.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
    });
}
