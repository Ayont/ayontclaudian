import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const css = readFileSync('/tmp/sbglass/statusbar.css','utf8');
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent('<html><body></body></html>');
const r = await p.evaluate((text) => {
  const el = document.createElement('style'); el.textContent = text; document.head.append(el);
  const out = [];
  const walk = (rules, d) => { for (const rule of rules) {
    out.push({ t: rule.constructor.name, sel: rule.selectorText || rule.conditionText || rule.name || '', decls: rule.style ? rule.style.length : null, d });
    if (rule.cssRules) walk(rule.cssRules, d+1);
  }};
  walk(el.sheet.cssRules, 0);
  return out;
}, css);
const srcBlocks = (css.match(/\{/g)||[]).length;
console.log('source { blocks:', srcBlocks, ' parsed rules:', r.length);
const empty = r.filter(x => x.decls === 0);
console.log('rules whose declarations all got dropped:', empty.length);
for (const x of empty) console.log('  !!', x.t, x.sel);
console.log('at-rules:', r.filter(x=>x.t!=='CSSStyleRule').map(x=>x.sel).join(' | '));
await b.close();
