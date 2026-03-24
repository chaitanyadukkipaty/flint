"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
        '--disable-infobars',
        '--window-size=1280,800',
        '--start-maximized',
        // Suppress "Chrome is being controlled by automated software" bar
        '--disable-extensions-except=',
        '--disable-component-extensions-with-background-pages',
    ];
}
/**
 * Apply stealth init scripts to an existing BrowserContext.
 * Call immediately after browser.newContext().
 */
async function applyStealthToContext(context) {
    await context.addInitScript(() => {
        // ── 1. navigator.webdriver ──────────────────────────────────────────────
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // ── 2. Plugins ──────────────────────────────────────────────────────────
        const pluginData = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 },
        ];
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const arr = [...pluginData];
                arr.item = (i) => arr[i];
                arr.namedItem = (n) => arr.find((p) => p.name === n) ?? null;
                arr.refresh = () => { };
                return arr;
            },
        });
        // ── 3. Languages / locale ───────────────────────────────────────────────
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
        // ── 4. Hardware signals ─────────────────────────────────────────────────
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
        // ── 5. Screen size (must match --window-size) ───────────────────────────
        Object.defineProperty(screen, 'width', { get: () => 1280 });
        Object.defineProperty(screen, 'height', { get: () => 800 });
        Object.defineProperty(screen, 'availWidth', { get: () => 1280 });
        Object.defineProperty(screen, 'availHeight', { get: () => 800 });
        Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
        Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
        // ── 6. window.outerWidth / outerHeight ──────────────────────────────────
        Object.defineProperty(window, 'outerWidth', { get: () => 1280 });
        Object.defineProperty(window, 'outerHeight', { get: () => 800 });
        // ── 7. chrome object ────────────────────────────────────────────────────
        if (!window.chrome) {
            window.chrome = {};
        }
        const chrome = window.chrome;
        if (!chrome.runtime) {
            chrome.runtime = {
                onConnect: { addListener: () => { }, removeListener: () => { }, hasListener: () => false },
                onMessage: { addListener: () => { }, removeListener: () => { }, hasListener: () => false },
                onInstalled: { addListener: () => { } },
                connect: () => ({}),
                sendMessage: () => { },
                id: undefined,
                getPlatformInfo: (cb) => cb({ os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' }),
            };
        }
        if (!chrome.loadTimes) {
            chrome.loadTimes = () => ({
                requestTime: Date.now() / 1000 - 0.5,
                startLoadTime: Date.now() / 1000 - 0.4,
                commitLoadTime: Date.now() / 1000 - 0.2,
                finishDocumentLoadTime: Date.now() / 1000 - 0.1,
                finishLoadTime: Date.now() / 1000,
                firstPaintTime: 0,
                firstPaintAfterLoadTime: 0,
                navigationType: 'Other',
                wasFetchedViaSpdy: false,
                wasNpnNegotiated: true,
                npnNegotiatedProtocol: 'h2',
                wasAlternateProtocolAvailable: false,
                connectionInfo: 'h2',
            });
        }
        if (!chrome.csi) {
            chrome.csi = () => ({ startE: Date.now(), onloadT: Date.now(), pageT: 2500, tran: 15 });
        }
        if (!chrome.app) {
            chrome.app = {
                isInstalled: false,
                getDetails: () => null,
                getIsInstalled: () => false,
                InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
            };
        }
        // ── 8. Permissions API ──────────────────────────────────────────────────
        const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
        if (origQuery) {
            navigator.permissions.query = (params) => params?.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission, onchange: null })
                : origQuery(params);
        }
        // ── 9. WebGL — spoof a real GPU instead of SwiftShader/llvmpipe ─────────
        const getParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (param) {
            if (param === 37445)
                return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
            if (param === 37446)
                return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
            return getParam.call(this, param);
        };
        // WebGL2 as well
        if (typeof WebGL2RenderingContext !== 'undefined') {
            const getParam2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function (param) {
                if (param === 37445)
                    return 'Intel Inc.';
                if (param === 37446)
                    return 'Intel Iris OpenGL Engine';
                return getParam2.call(this, param);
            };
        }
        // ── 10. Canvas fingerprint noise ────────────────────────────────────────
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
            const ctx = this.getContext('2d');
            if (ctx) {
                const img = ctx.getImageData(0, 0, this.width || 1, this.height || 1);
                for (let i = 0; i < img.data.length; i += 400)
                    img.data[i] ^= Math.floor(Math.random() * 3);
                ctx.putImageData(img, 0, 0);
            }
            return origToDataURL.call(this, type, quality);
        };
        // ── 11. Battery API stub (absence is a bot signal on some sites) ────────
        if (!('getBattery' in navigator)) {
            navigator.getBattery = () => Promise.resolve({
                charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
                onchargingchange: null, onchargingtimechange: null,
                ondischargingtimechange: null, onlevelchange: null,
            });
        }
        // ── 12. Connection API ──────────────────────────────────────────────────
        if (!navigator.connection) {
            Object.defineProperty(navigator, 'connection', {
                get: () => ({ effectiveType: '4g', downlink: 10, rtt: 50, saveData: false }),
            });
        }
    });
    await context.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'sec-ch-ua': '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
    });
}
