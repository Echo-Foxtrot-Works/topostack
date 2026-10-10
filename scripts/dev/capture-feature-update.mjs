import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appUrl } from '../lib/app-url.mjs';
const origin = appUrl('TOPOSTACK_CAPTURE_URL');
const output = new URL('../../docs/images/splitting-paint-templates/', import.meta.url);
await mkdir(output, { recursive: true });
const project = JSON.parse(await readFile(new URL('../../atomm/media-project-v3.json', import.meta.url), 'utf8'));
Object.assign(project, { name: 'Crater Lake · Split & paint', workAreaWidthMm: 220, workAreaHeightMm: 160, seamOffsetMm: 10, seamTabs: true, showAssemblyLabels: true, paintTemplates: ['water'], optimizeMaterialUse: false });
const browser = await chromium.launch({headless: true});
try {
 const page = await browser.newPage({viewport: {width: 1600, height: 1100}, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce'});
 page.setDefaultTimeout(180000);
 const surveyResponses = [];
 page.on('response', r => { if(r.url().includes('usgs-crater-lake') && r.ok()) surveyResponses.push(r.url()); });
 await page.route('https://topostack.app/v1/**', async route => {
  const headers = {...route.request().headers()}; delete headers.origin; delete headers.referer;
  try { await route.fulfill({response: await route.fetch({headers, timeout: 180000})}); } catch(e) { console.log('API', e.message); await route.abort(); }
 });
 await page.goto(origin);
 await page.evaluate(async project => { await new Promise((resolve,reject) => { const r=indexedDB.open('keyval-store',1); r.onupgradeneeded=()=>r.result.createObjectStore('keyval'); r.onerror=()=>reject(r.error); r.onsuccess=()=>{ const db=r.result; const t=db.transaction('keyval','readwrite'); t.objectStore('keyval').put(project,'topostack:project:v1'); t.oncomplete=()=>{db.close();resolve();}; }; }); },project);
 await page.goto(origin+'/studio');
 await page.getByText('Local project restored · generate to refresh terrain',{exact:true}).first().waitFor();
 await page.locator('.preview-stage[aria-busy="false"]').waitFor();
 console.log('Generating terrain');
 await page.getByRole('button',{name:'Generate terrain',exact:true}).click();
 await page.getByRole('button',{name:'Regenerate terrain',exact:true}).waitFor();
 await page.locator('.preview-stage[aria-busy="false"]').waitFor();
 console.log('Generated', await page.locator('.status-line').innerText(), 'survey responses', surveyResponses.length);
 if (!surveyResponses.length) throw new Error('No survey data received');
 await page.getByRole('tab',{name:'Fabricate',exact:true}).click();
 await page.locator('.settings-rail .ldt-tabs__panels').evaluate(el => el.scrollTop=el.scrollHeight);
 await page.evaluate(()=>document.fonts.ready);
 const stage=page.locator('.three-stage');
 for(let i=0;i<11;i++) await stage.press('ArrowUp');
 await page.waitForTimeout(1800);
 await page.screenshot({path:new URL('01-split-relief.png',output).pathname,animations:'disabled'});
 console.log('3D captured');
 await page.getByRole('radio',{name:'Cut layers',exact:true}).click();
 const range=page.getByRole('slider',{name:'Selected layer',exact:true});
 const max=Number(await range.getAttribute('max'));
 const candidates=[];
 for(let i=0;i<=max;i++) {
  await range.fill(String(i));
  await page.waitForTimeout(80);
  const paint=await page.locator('[data-paint-kind]').evaluateAll(els=>els.reduce((a,e)=>{const b=e.getBBox();return a+b.width*b.height;},0));
  if(paint>0) candidates.push({index:i,paint});
 }
 console.log('Candidates',JSON.stringify(candidates));
 const selected=process.env.TOPOSTACK_CAPTURE_LAYER ? Number(process.env.TOPOSTACK_CAPTURE_LAYER)-1 : candidates.sort((a,b)=>b.paint-a.paint)[0]?.index;
 if(selected===undefined) throw new Error('No water paint regions found');
 await range.fill(String(selected));
 await page.waitForTimeout(400);
 await page.screenshot({path:new URL('02-split-cut-layer.png',output).pathname,animations:'disabled'});
 await page.getByRole('switch',{name:'Show paint template',exact:true}).click();
 await page.waitForTimeout(300);
 await page.screenshot({path:new URL('03-water-paint-template.png',output).pathname,animations:'disabled'});
 await range.fill('11');
 await page.waitForTimeout(300);
 await page.screenshot({path:new URL('04-lower-layer-paint-template.png',output).pathname,animations:'disabled'});
 await writeFile(new URL('media-provenance.json',output),JSON.stringify({capturedAt:new Date().toISOString(),project,selectedLayer:selected+1,surveyResponses:[...new Set(surveyResponses)],viewport:{width:1600,height:1100,deviceScaleFactor:2},note:'Unaltered app screenshots. Survey data where available; existing terrain or modeled depths fill gaps. Depth exaggerated.'},null,2)+'\n');
 console.log('Saved to',output.pathname);
} finally {await browser.close();}
