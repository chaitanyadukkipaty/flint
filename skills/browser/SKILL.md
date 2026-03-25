---
name: Browser
description: Open a browser and perform operations described in plain text. Starts a hybrid session where the LLM executes tasks and the user can act simultaneously. All actions are recorded to a flow YAML file. Use when the user wants to automate, test, or interact with any website.
---

# Browser Automation — Hybrid Session

You operate in **hybrid mode**: you (the LLM) execute browser actions via Playwright MCP tools, while the user can interact with the browser window directly at the same time. All actions from both sides are recorded.

## Action Strategy — Priority Order

For every interaction, follow this order and move to the next level only if the previous fails:

### Level 1 — Snapshot (preferred)
```
browser_snapshot  →  find element ref  →  browser_click / browser_type (using ref)
```
Get the accessibility tree, identify the element by role + name, act using its `ref`.

### Level 2 — Screenshot + Coordinates (fallback)
When `browser_snapshot` does not expose the target element (canvas, custom components, shadow DOM, iframes, dynamic overlays):

1. Call `browser_screenshot` and visually locate the element
2. Estimate its center coordinates `(x, y)` from the screenshot dimensions
3. Use `browser_run_code` to act at those coordinates:

**Click:**
```javascript
async (page) => { await page.mouse.click(x, y); }
```

**Double-click:**
```javascript
async (page) => { await page.mouse.dblclick(x, y); }
```

**Type into a coordinate-clicked field:**
```javascript
async (page) => {
  await page.mouse.click(x, y);
  await page.keyboard.type('your text');
}
```

**Hover:**
```javascript
async (page) => { await page.mouse.move(x, y); }
```

**Drag:**
```javascript
async (page) => {
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY);
  await page.mouse.up();
}
```

### Level 3 — JavaScript evaluation (last resort)
When neither snapshot nor coordinates work (invisible triggers, programmatic actions):
```javascript
async (page) => {
  await page.evaluate(() => {
    document.querySelector('selector').click();
  });
}
```

## Starting a Session

When invoked with a task:
1. `browser_navigate` to the target URL
2. `browser_snapshot` to get the accessibility tree
3. If snapshot is insufficient → `browser_screenshot` for visual context
4. Execute actions using the appropriate level above
5. Verify each action with a snapshot or screenshot before continuing

## Available MCP Tools

| Tool | When to use |
|------|-------------|
| `browser_navigate` | Go to a URL |
| `browser_snapshot` | Get accessibility tree — always try this first |
| `browser_screenshot` | Visual state — use when snapshot is insufficient |
| `browser_click` | Click using snapshot ref |
| `browser_type` | Type using snapshot ref |
| `browser_run_code` | Coordinate clicks, drags, keyboard combos, JS actions |
| `browser_select_option` | Choose from a dropdown |
| `browser_press_key` | Press Enter, Tab, Escape, etc. |
| `browser_hover` | Hover using snapshot ref |
| `browser_wait_for` | Wait for element to appear |
| `browser_scroll` | Scroll the page |
| `browser_evaluate` | Run JS on a specific element ref |

## Get Locators On Demand

### Full-page locators
If the user asks **"get locators"** or **"show locators"** (no section specified):
```bash
npx flint pom
```
Prints CSS + XPath for all interactive elements with resilience scores.

### Section locators (interactive picker)
If the user asks **"get locators for a section"**, **"pick a section"**, **"locators for this section"**, or anything implying they want to scope locators to part of the page:

**Step 1 — inject the section picker** via `browser_run_code`:
```javascript
async (page) => {
  return await page.evaluate(() => new Promise(resolve => {
    // All picker UI elements use data-picker-ui so handlers can skip them
    const hl = document.createElement('div');
    hl.dataset.pickerUi = '1';
    hl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;outline:3px solid #f97316;background:rgba(249,115,22,0.08);border-radius:3px;transition:top 0.06s,left 0.06s,width 0.06s,height 0.06s;';
    const lbl = document.createElement('div');
    lbl.dataset.pickerUi = '1';
    lbl.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f8fafc;padding:8px 16px;border-radius:6px;font:13px/1.4 monospace;z-index:2147483647;pointer-events:none;white-space:nowrap;';
    lbl.textContent = 'Click to select section • Click [Pause] to open hover menus • Esc = full page';
    const btn = document.createElement('button');
    btn.dataset.pickerUi = '1';
    btn.textContent = '⏸ Pause Picker';
    btn.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#1e293b;color:#f8fafc;padding:8px 16px;border-radius:6px;font:13px/1.4 monospace;border:2px solid #f97316;cursor:pointer;';
    document.body.append(hl, lbl, btn);
    document.body.style.cursor = 'crosshair';
    let paused = false;
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      paused = !paused;
      if (paused) {
        hl.style.display = 'none';
        btn.textContent = '▶ Resume Picker';
        btn.style.background = '#dc2626';
        document.body.style.cursor = 'default';
        lbl.textContent = 'Picker paused — hover to open menus, then click Resume';
      } else {
        hl.style.display = '';
        btn.textContent = '⏸ Pause Picker';
        btn.style.background = '#1e293b';
        document.body.style.cursor = 'crosshair';
        lbl.textContent = 'Click to select section • Click [Pause] to open hover menus • Esc = full page';
      }
    });
    function blockAncestor(el) {
      while (el && el !== document.body) {
        if (el.dataset && el.dataset.pickerUi) { el = el.parentElement; continue; }
        const s = window.getComputedStyle(el), r = el.getBoundingClientRect();
        if ((s.display==='block'||s.display==='flex'||s.display==='grid')&&r.width>60&&r.height>30) return el;
        el = el.parentElement;
      }
      return document.body;
    }
    function buildSel(el) {
      if (el.id && !/^\d|react-|ember/.test(el.id)) return '#'+CSS.escape(el.id);
      const tid = el.getAttribute('data-testid')||el.getAttribute('data-cy')||'';
      if (tid) return `[data-testid="${tid}"]`;
      const al = el.getAttribute('aria-label')||'';
      if (al) return `${el.tagName.toLowerCase()}[aria-label="${al}"]`;
      const parts=[]; let cur=el;
      for(let d=0;d<3&&cur&&cur!==document.body;d++){
        const tag=cur.tagName.toLowerCase();
        const sibs=cur.parentElement?[...cur.parentElement.children].filter(c=>c.tagName===cur.tagName):[];
        parts.unshift(sibs.length>1?`${tag}:nth-of-type(${sibs.indexOf(cur)+1})`:tag);
        cur=cur.parentElement;
      }
      return parts.join(' > ');
    }
    function cleanup() {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
      [hl, lbl, btn].forEach(n => n.remove());
    }
    function onOver(e) {
      if (paused) return;
      const t = e.target;
      if (!t || (t.dataset && t.dataset.pickerUi)) return;
      const sec = blockAncestor(t);
      if (sec === document.body) return;
      const r = sec.getBoundingClientRect();
      Object.assign(hl.style,{top:r.top+'px',left:r.left+'px',width:r.width+'px',height:r.height+'px'});
      lbl.textContent=`<${sec.tagName.toLowerCase()}${sec.id?'#'+sec.id:''}> — click to select`;
    }
    function onClick(e) {
      if (paused) return; // let all clicks pass through while paused
      const t = e.target;
      if (t && t.dataset && t.dataset.pickerUi) return;
      e.preventDefault(); e.stopPropagation();
      cleanup();
      const sec = blockAncestor(t || document.body);
      resolve(sec !== document.body ? buildSel(sec) : null);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        if (paused) {
          paused = false;
          hl.style.display = '';
          btn.textContent = '⏸ Pause Picker';
          btn.style.background = '#1e293b';
          document.body.style.cursor = 'crosshair';
          lbl.textContent = 'Click to select section • Click [Pause] to open hover menus • Esc = full page';
        } else {
          cleanup(); resolve(null);
        }
      }
    }
    document.addEventListener('mouseover', onOver);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }));
}
```
Tell the user: **"The section picker is active — hover to highlight sections and click to select. Use the [Pause Picker] button (top-right) to open hover menus first, then click Resume and select. Press Escape for full page."**

Wait for the user to make their selection. The function returns the section CSS selector (or `null` for full page).

**Step 2 — extract locators scoped to that section** via `browser_run_code`, substituting `SECTION_SELECTOR` with the returned value (or `'body'` if null):
```javascript
async (page) => {
  return await page.evaluate((rootSel) => {
    const root = rootSel ? (document.querySelector(rootSel) || document.body) : document.body;
    const SEL = 'input,button,a[href],select,textarea,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="combobox"],[role="tab"],[role="menuitem"]';
    function vis(el){const r=el.getBoundingClientRect(),s=window.getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';}
    function esc(v){return v.replace(/'/g,"\\'").replace(/"/g,'\\"');}
    function snake(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)||'element';}
    function isAutoId(id){return/^(react-|ember|__|\d|uid|comp|el-)/.test(id)||/\d{4,}/.test(id);}
    const seen=new Set(), out=[];
    root.querySelectorAll(SEL).forEach(el=>{
      if(!vis(el))return;
      const tag=el.tagName.toLowerCase(), testId=el.getAttribute('data-testid')||el.getAttribute('data-cy')||'',
        al=el.getAttribute('aria-label')||'', id=el.getAttribute('id')||'',
        nm=el.getAttribute('name')||'', ph=el.getAttribute('placeholder')||'',
        tp=el.getAttribute('type')||'', txt=(el.innerText||'').trim().slice(0,60),
        labelEl=id?document.querySelector(`label[for="${id}"]`):null, labelTxt=(labelEl?.innerText||'').trim();
      let css='',xpath='',score=0,fragile=false,name='';
      if(testId){const a=el.getAttribute('data-testid')?'data-testid':'data-cy';css=`[${a}="${esc(testId)}"]`;xpath=`//${tag}[@${a}="${esc(testId)}"]`;score=95;name=snake(testId);}
      else if(al){css=`${tag}[aria-label="${esc(al)}"]`;xpath=`//${tag}[@aria-label="${esc(al)}"]`;score=90;name=snake(al);}
      else if(id&&!isAutoId(id)){css=`#${CSS.escape(id)}`;xpath=`//${tag}[@id="${esc(id)}"]`;score=85;name=snake(id);}
      else if(labelTxt){css=id?`#${CSS.escape(id)}`:`${tag}[name="${esc(nm||id)}"]`;xpath=`//label[normalize-space()="${esc(labelTxt)}"]/following-sibling::${tag}[1]`;score=80;name=snake(labelTxt)+(tag==='input'?'_input':'');}
      else if(nm){css=`${tag}[name="${esc(nm)}"]`;xpath=`//${tag}[@name="${esc(nm)}"]`;score=75;name=snake(nm);}
      else if(ph){css=`${tag}[placeholder="${esc(ph)}"]`;xpath=`//${tag}[@placeholder="${esc(ph)}"]`;score=70;name=snake(ph)+'_input';}
      else if(tp&&(tag==='input'||tag==='button')){css=`${tag}[type="${tp}"]`;xpath=`//${tag}[@type="${tp}"]`;score=60;name=snake(tp+'_'+tag);}
      else if(txt){css=tag;xpath=`//${tag}[normalize-space()="${esc(txt)}"]`;score=60;name=snake(txt)+(tag==='button'?'_button':tag==='a'?'_link':'');}
      else{score=20;fragile=true;name=snake(txt||tag)+'_el';const parts=[],cur2=el;let c=el;for(let d=0;d<3&&c&&c!==document.body;d++){const t2=c.tagName.toLowerCase(),sibs=c.parentElement?[...c.parentElement.children].filter(x=>x.tagName===c.tagName):[];parts.unshift(sibs.length>1?`${t2}:nth-of-type(${sibs.indexOf(c)+1})`:t2);c=c.parentElement;}css=parts.join(' > ');xpath='//'+parts.join('/');}
      if(!css||seen.has(css))return;
      seen.add(css);
      out.push({name,css,xpath,score,fragile});
    });
    return out.sort((a,b)=>b.score-a.score);
  }, 'SECTION_SELECTOR');
}
```

**Format and print the results** as:
```
Section: SECTION_SELECTOR
─────────────────────────────────────────
element_name         CSS: selector                        [score] ⚠
                     XPath: xpath
```

## Recording

All actions are recorded automatically to `flows/`. Manual user actions are captured via CDP listeners in the same file.

## Completing the Task

When done:
- Take a final `browser_screenshot` to confirm the result
- Tell the user what was accomplished
- Mention the flow file: `flows/<name>.yaml`

## Error Handling

1. Element not found in snapshot → take screenshot, try coordinate click
2. Coordinate click missed → re-examine screenshot, adjust coordinates
3. Page changed unexpectedly → `browser_snapshot` again before retrying
4. Never guess coordinates blindly — always take a screenshot first to estimate them
