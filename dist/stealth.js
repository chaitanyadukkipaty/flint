"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stealthContextOptions = exports.stealthChromium = void 0;
exports.stealthArgs = stealthArgs;
exports.applyStealthToContext = applyStealthToContext;
// playwright-extra wraps the chromium object with stealth plugin support.
// We export a ready-to-use `chromium` that has the plugin applied.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium: _chromium } = require('playwright-extra');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
_chromium.use(StealthPlugin());
exports.stealthChromium = _chromium;
/** Extra CLI flags for chromium.launch() */
function stealthArgs(extraPorts = []) {
    return [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-first-run',
        '--disable-default-apps',
        '--window-size=1280,800',
        ...extraPorts,
    ];
}
/** Context options that look like a real Chrome session */
exports.stealthContextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
};
/**
 * Extra patches on top of the stealth plugin for sites that probe
 * hardware/WebGL/CDP-specific signals (e.g. BrowserStack, Cloudflare).
 */
async function applyStealthToContext(context) {
    await context.addInitScript(() => {
        // Delete any leftover CDP / automation artifacts
        const cdcKeys = Object.keys(window).filter(k => k.startsWith('$cdc_') || k.startsWith('__cdc_'));
        cdcKeys.forEach(k => { try {
            delete window[k];
        }
        catch { } });
        ['__selenium_evaluate', '__webdriver_evaluate', '__selenium_unwrapped',
            '__fxdriver_evaluate', '__driver_unwrapped', '__webdriver_script_fn',
        ].forEach(k => { try {
            delete window[k];
        }
        catch { } });
        // Hardware signals
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
        // Screen
        Object.defineProperty(screen, 'width', { get: () => 1280 });
        Object.defineProperty(screen, 'height', { get: () => 800 });
        Object.defineProperty(screen, 'availWidth', { get: () => 1280 });
        Object.defineProperty(screen, 'availHeight', { get: () => 800 });
        Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
        Object.defineProperty(window, 'outerWidth', { get: () => 1280 });
        Object.defineProperty(window, 'outerHeight', { get: () => 800 });
        // WebGL — replace SwiftShader/llvmpipe with a real-looking GPU
        const patchWebGL = (proto) => {
            const orig = proto.getParameter;
            proto.getParameter = function (p) {
                if (p === 37445)
                    return 'Intel Inc.';
                if (p === 37446)
                    return 'Intel Iris OpenGL Engine';
                return orig.call(this, p);
            };
        };
        if (typeof WebGLRenderingContext !== 'undefined')
            patchWebGL(WebGLRenderingContext.prototype);
        if (typeof WebGL2RenderingContext !== 'undefined')
            patchWebGL(WebGL2RenderingContext.prototype);
        // Battery API stub
        if (!('getBattery' in navigator)) {
            navigator.getBattery = () => Promise.resolve({
                charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
                onchargingchange: null, onchargingtimechange: null,
                ondischargingtimechange: null, onlevelchange: null,
            });
        }
        // Connection API
        if (!navigator.connection) {
            Object.defineProperty(navigator, 'connection', {
                get: () => ({ effectiveType: '4g', downlink: 10, rtt: 50, saveData: false }),
            });
        }
        // Canvas noise
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type, q) {
            const ctx = this.getContext('2d');
            if (ctx) {
                const img = ctx.getImageData(0, 0, this.width || 1, this.height || 1);
                for (let i = 0; i < img.data.length; i += 400)
                    img.data[i] ^= Math.floor(Math.random() * 3);
                ctx.putImageData(img, 0, 0);
            }
            return origToDataURL.call(this, type, q);
        };
    });
    await context.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'sec-ch-ua': '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
    });
}
