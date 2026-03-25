"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachManualCapture = attachManualCapture;
async function attachManualCapture(page, recorder, screenshotDir, useLLM = false) {
    // Track accumulated keystrokes per element to merge into a single 'type' step
    let typeBuffer = { selector: '', value: '', name: '', css: '', xpath: '', desc: '' };
    let typeTimer = null;
    /** Read and clear the LLM-set step description from the page (set via window.__flintStepDesc__) */
    const popStepDesc = async () => {
        try {
            return await page.evaluate(() => {
                const d = window.__flintStepDesc__ ?? '';
                window.__flintStepDesc__ = '';
                return d;
            });
        }
        catch {
            return '';
        }
    };
    /** Auto-generate a human-readable description from captured step data */
    function autoDesc(action, elementName, value, url, key) {
        const label = elementName?.replace(/_/g, ' ') ?? 'element';
        if (action === 'navigate' && url)
            return `Navigate to ${url}`;
        if (action === 'click')
            return `Click ${label}`;
        if (action === 'type' && value)
            return `Type "${value}" in ${label}`;
        if (action === 'keypress' && key)
            return `Press ${key}`;
        return '';
    }
    const safeTitle = async () => {
        try {
            return await page.title();
        }
        catch {
            return '';
        }
    };
    const safeScreenshot = async (path) => {
        try {
            await page.screenshot({ path });
        }
        catch { /* navigation in progress */ }
    };
    const flushType = async () => {
        if (!typeBuffer.value)
            return;
        const buf = { ...typeBuffer };
        typeBuffer = { selector: '', value: '', name: '', css: '', xpath: '', desc: '' };
        const stepId = recorder.getStepCount() + 1;
        const ssPath = `${screenshotDir}/step_${String(stepId).padStart(3, '0')}.png`;
        await safeScreenshot(ssPath);
        const description = buf.desc || (useLLM ? autoDesc('type', buf.name, buf.value) : undefined);
        recorder.append({
            actor: 'user',
            action: 'type',
            ...(description ? { description } : {}),
            element: { name: buf.name, css: buf.css, xpath: buf.xpath, resilience: 0 },
            value: buf.value,
            context: { title: await safeTitle(), screenshot: ssPath },
        });
    };
    // Capture navigation — debounced to avoid duplicate events per redirect chain
    let lastNavUrl = '';
    let navTimer = null;
    page.on('framenavigated', async (frame) => {
        if (frame !== page.mainFrame())
            return;
        const url = frame.url();
        if (url === 'about:blank')
            return;
        if (url === lastNavUrl)
            return; // skip duplicate same-URL events
        lastNavUrl = url;
        // Debounce: wait for redirect chain to settle before recording
        if (navTimer)
            clearTimeout(navTimer);
        navTimer = setTimeout(async () => {
            const finalUrl = page.url();
            lastNavUrl = finalUrl;
            await page.waitForLoadState('domcontentloaded').catch(() => { });
            const stepId = recorder.getStepCount() + 1;
            const ssPath = `${screenshotDir}/step_${String(stepId).padStart(3, '0')}.png`;
            await safeScreenshot(ssPath);
            const navDesc = await popStepDesc();
            const description = navDesc || (useLLM ? autoDesc('navigate', undefined, undefined, finalUrl) : undefined);
            recorder.append({
                actor: 'user',
                action: 'navigate',
                ...(description ? { description } : {}),
                url: finalUrl,
                context: {
                    title: await safeTitle(),
                    screenshot: ssPath,
                },
            });
        }, 400);
    });
    // Capture clicks via page injection
    await page.addInitScript(() => {
        document.addEventListener('click', (e) => {
            const el = e.target;
            const info = {
                tag: el.tagName?.toLowerCase(),
                id: el.id,
                testId: el.getAttribute('data-testid') ?? el.getAttribute('data-cy') ?? '',
                ariaLabel: el.getAttribute('aria-label') ?? '',
                innerText: el.innerText?.trim().slice(0, 60),
                className: el.className,
                name: el.getAttribute('name') ?? '',
                type: el.getAttribute('type') ?? '',
                href: el.href ?? '',
                x: e.clientX,
                y: e.clientY,
            };
            // Expose via console for CDP to capture
            console.log('__CAPTURE_CLICK__' + JSON.stringify(info));
        }, true);
        document.addEventListener('keydown', (e) => {
            if (['Enter', 'Tab', 'Escape'].includes(e.key)) {
                console.log('__CAPTURE_KEY__' + JSON.stringify({ key: e.key }));
            }
        }, true);
    });
    // Listen to console events to get click data
    page.on('console', async (msg) => {
        const text = msg.text();
        if (text.startsWith('__CAPTURE_CLICK__')) {
            await flushType(); // flush pending typing before click
            try {
                const info = JSON.parse(text.slice('__CAPTURE_CLICK__'.length));
                const { name, css, xpath, resilience } = pickBestLocator(info);
                const stepId = recorder.getStepCount() + 1;
                const ssPath = `${screenshotDir}/step_${String(stepId).padStart(3, '0')}.png`;
                await safeScreenshot(ssPath);
                const clickDesc = await popStepDesc();
                const description = clickDesc || (useLLM ? autoDesc('click', name) : undefined);
                recorder.append({
                    actor: 'user',
                    action: 'click',
                    ...(description ? { description } : {}),
                    element: { name, css, xpath, resilience },
                    context: { title: await safeTitle(), screenshot: ssPath },
                });
            }
            catch { }
        }
        if (text.startsWith('__CAPTURE_KEY__')) {
            await flushType();
            try {
                const { key } = JSON.parse(text.slice('__CAPTURE_KEY__'.length));
                const keyDesc = useLLM ? autoDesc('keypress', undefined, undefined, undefined, key) : undefined;
                recorder.append({ actor: 'user', action: 'keypress', ...(keyDesc ? { description: keyDesc } : {}), key });
            }
            catch { }
        }
    });
    // Capture typing by watching input value changes
    await page.exposeFunction('__onInput__', async (info) => {
        if (typeBuffer.selector !== info.selector) {
            await flushType();
            typeBuffer.selector = info.selector;
            typeBuffer.name = info.name;
            typeBuffer.css = info.css;
            typeBuffer.xpath = info.xpath;
            typeBuffer.value = '';
            typeBuffer.desc = await popStepDesc(); // capture LLM-set desc when typing starts
        }
        typeBuffer.value = info.value;
        if (typeTimer)
            clearTimeout(typeTimer);
        typeTimer = setTimeout(flushType, 1500);
    });
    await page.addInitScript(() => {
        document.addEventListener('input', (e) => {
            const el = e.target;
            const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-cy') ?? '';
            const ariaLabel = el.getAttribute('aria-label') ?? '';
            const labelEl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
            const labelText = labelEl?.innerText?.trim() ?? '';
            const name = el.getAttribute('name') ?? '';
            const placeholder = el.getAttribute('placeholder') ?? '';
            let css = '';
            let xpath = '';
            let elName = '';
            const tag = el.tagName.toLowerCase();
            const esc = (v) => v.replace(/'/g, "\\'").replace(/"/g, '\\"');
            if (testId) {
                const attr = el.getAttribute('data-testid') ? 'data-testid' : el.getAttribute('data-cy') ? 'data-cy' : 'data-qa';
                css = `[${attr}="${esc(testId)}"]`;
                xpath = `//${tag}[@${attr}="${esc(testId)}"]`;
                elName = testId;
            }
            else if (ariaLabel) {
                css = `${tag}[aria-label="${esc(ariaLabel)}"]`;
                xpath = `//${tag}[@aria-label="${esc(ariaLabel)}"]`;
                elName = ariaLabel;
            }
            else if (labelText) {
                css = name ? `${tag}[name="${esc(name)}"]` : tag;
                xpath = `//label[normalize-space()="${esc(labelText)}"]/following-sibling::${tag}[1]`;
                elName = labelText;
            }
            else if (placeholder) {
                css = `${tag}[placeholder="${esc(placeholder)}"]`;
                xpath = `//${tag}[@placeholder="${esc(placeholder)}"]`;
                elName = placeholder;
            }
            else if (name) {
                css = `${tag}[name="${esc(name)}"]`;
                xpath = `//${tag}[@name="${esc(name)}"]`;
                elName = name;
            }
            else {
                css = tag;
                xpath = `//${tag}`;
                elName = 'input';
            }
            window.__onInput__({
                selector: css,
                name: elName.toLowerCase().replace(/\s+/g, '_').slice(0, 40),
                css,
                xpath,
                value: el.value,
            });
        }, true);
    });
    // Return cleanup function
    return async () => {
        await flushType();
    };
}
function pickBestLocator(info) {
    const toSnake = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    const esc = (v) => v.replace(/"/g, '\\"');
    const tag = info.tag ?? 'element';
    if (info.testId) {
        const attr = 'data-testid';
        return { name: toSnake(info.testId), css: `[${attr}="${esc(info.testId)}"]`, xpath: `//${tag}[@${attr}="${esc(info.testId)}"]`, resilience: 95 };
    }
    if (info.ariaLabel)
        return { name: toSnake(info.ariaLabel), css: `${tag}[aria-label="${esc(info.ariaLabel)}"]`, xpath: `//${tag}[@aria-label="${esc(info.ariaLabel)}"]`, resilience: 90 };
    if ((info.tag === 'button' || info.tag === 'a') && info.innerText)
        return { name: toSnake(info.innerText) + (info.tag === 'a' ? '_link' : '_button'), css: `${tag}`, xpath: `//${tag}[normalize-space()="${esc(info.innerText)}"]`, resilience: 85 };
    if (info.id && !/\d{4,}/.test(info.id))
        return { name: toSnake(info.id), css: `#${info.id}`, xpath: `//${tag}[@id="${esc(info.id)}"]`, resilience: 75 };
    if (info.name)
        return { name: toSnake(info.name), css: `${tag}[name="${esc(info.name)}"]`, xpath: `//${tag}[@name="${esc(info.name)}"]`, resilience: 60 };
    const cls = (info.className ?? '').split(' ')[0];
    return {
        name: toSnake(info.innerText || tag),
        css: cls ? `${tag}.${cls}` : tag,
        xpath: cls ? `//${tag}[contains(@class,"${esc(cls)}")]` : `//${tag}`,
        resilience: 30,
    };
}
