import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHistoryHandler} from '../history-api/worker.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const defaults=JSON.parse(html.match(/id="catalogData">([\s\S]*?)<\/script>/)[1]);
const files=new Map([['parts.json',JSON.stringify(defaults)]]),revisions=new Map([['parts.json','sha-0']]);
let revision=0,failSave=false;
const handler=createHistoryHandler({fetch:async(url,init)=>{
 const file=new URL(url).pathname.split('/contents/')[1];assert.ok(['parts.json','history.json'].includes(file));assert.equal(init.redirect,'manual');
 if(init.method==='PUT'){const body=JSON.parse(init.body);if(files.has(file)&&body.sha!==revisions.get(file))return Response.json({},{status:409});files.set(file,Buffer.from(body.content,'base64').toString('utf8'));revisions.set(file,'sha-'+ ++revision);return Response.json({commit:{sha:'test'},content:{sha:revisions.get(file)}},{status:201})}
 return files.has(file)?Response.json({content:Buffer.from(files.get(file)).toString('base64'),encoding:'base64',size:Buffer.byteLength(files.get(file)),sha:revisions.get(file)}):Response.json({},{status:404});
}});
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'}),errors=[];
async function makePage(width=1440){
 const context=await browser.newContext({viewport:{width,height:1050}});
 await context.addInitScript(()=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{write:async items=>{for(const item of items)for(const type of item.types)window.copied.push({type,text:await(await item.getType(type)).text()})},writeText:async text=>window.copied.push({type:'text/plain',text})}})});
 await context.route('**/*',async route=>{
  const req=route.request();
  if(req.url().includes('.workers.dev/api/')){
   const headers=new Headers(await req.allHeaders());headers.set('Origin','https://lawcombo.github.io');
   if(failSave&&req.method()==='PUT')return route.fulfill({status:503,headers:{'Access-Control-Allow-Origin':'https://lawcombo.github.io'},contentType:'application/json',body:JSON.stringify({error:'시험: 저장 연결 오류'})});
   const response=await handler(new Request(req.url(),{method:req.method(),headers,...(req.postData()?{body:req.postData()}:{})}),{GITHUB_TOKEN:'github_pat_TestOnly'});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  }
  return route.fulfill({contentType:'text/html',body:html});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('https://lawcombo.github.io/kiosk-order/');return{page,context};
}
async function openManager(page){await page.getByRole('button',{name:'부품 P/N·단가 관리',exact:true}).click();await page.waitForFunction(()=>manager.loaded&&!manager.loading)}
async function saveManager(page){await page.locator('#saveCatalogButton').click();await page.waitForFunction(()=>!manager.saving&&!manager.dirty)}
async function screenshot(page,name){if(process.env.CHECK_SCREENSHOTS_DIR)await page.screenshot({path:path.join(process.env.CHECK_SCREENSHOTS_DIR,name+'.png')})}
try{
 const {page,context}=await makePage();
 assert.equal(await page.getByRole('button',{name:'신청서 불러오기',exact:true}).count(),0);
 assert.equal(await page.locator('#saveHistoryButton').textContent(),'이력 저장');
 const initial=await page.evaluate(()=>calc().total);
 for(const model of [2,3,4]){await page.evaluate(value=>{state.type='general';state.model=value;render()},model);const messages=await page.locator('#warnings').textContent();assert.ok(!messages.includes('카드발행기: 도어락 연동·장착 부속 확인'));assert.ok(!messages.includes('AI BOX의 녹화·저장·조회 구성 확인'))}await page.evaluate(()=>{state.model=1;render()});
 await openManager(page);
 assert.equal(await page.getByRole('tab',{name:/모델 구성/}).getAttribute('aria-selected'),'true');
 await page.getByRole('tab',{name:/필수항목/}).click();
 await page.getByRole('button',{name:'+ 필수항목 추가',exact:true}).click();
 const addedRequired=page.locator('.manager-part-row').last(),requiredId=await addedRequired.getAttribute('data-required-row');
 await addedRequired.getByLabel('필수항목명',{exact:true}).fill('관리 시험 필수품');
 await addedRequired.getByLabel('P/N',{exact:true}).fill('REQ-PN');
 await addedRequired.getByLabel('금액',{exact:true}).fill('');
 await addedRequired.getByLabel('기본 수량',{exact:true}).fill('2');
 await page.locator('[data-required-row="g8"]').getByLabel('금액',{exact:true}).fill('100000');
 await page.getByRole('tab',{name:/추가 옵션/}).click();
 await page.getByLabel('새 옵션 그룹 이름',{exact:true}).fill('시험 옵션');await page.getByRole('button',{name:'+ 그룹 추가',exact:true}).click();
 await page.getByRole('button',{name:'+ 이 그룹에 옵션 추가',exact:true}).click();
 const option=page.locator('.manager-option-row').last(),optionId=await option.getAttribute('data-option-row');
 await option.getByLabel('옵션명',{exact:true}).fill('관리 시험 장치 <b>표시</b>');
 await option.getByLabel('옵션 P/N',{exact:true}).fill('');
 await option.getByLabel('옵션 금액',{exact:true}).fill('');
 await option.getByLabel('옵션 단위',{exact:true}).selectOption('대');
 const newGroupBox=await page.locator('.manager-new-group').boundingBox(),groupTabsBox=await page.locator('.manager-group-tabs').boundingBox(),currentGroupBox=await page.locator('.manager-current-group').boundingBox();
 assert.ok(newGroupBox.y<groupTabsBox.y&&groupTabsBox.y<currentGroupBox.y,'option group controls follow create, tabs, current-group order');
 const currentControls=await page.locator('.manager-current-group').locator('input,button').evaluateAll(elements=>elements.map(el=>Math.round(el.getBoundingClientRect().top)));
 assert.equal(new Set(currentControls).size,1,'current group name, rename and add-option controls stay on one desktop row');
 await page.locator(`[data-option-row="${optionId}"]`).getByLabel('옵션 그룹',{exact:true}).selectOption('교체·기타');
 assert.equal(await page.evaluate(id=>manager.draft.options.find(o=>o.id===id).group,optionId),'교체·기타');
 const optionPartId=await page.evaluate(id=>manager.draft.options.find(o=>o.id===id).ids[0],optionId);
 await page.getByRole('tab',{name:/모델 구성/}).click();
 assert.ok((await page.locator('.manager-readonly').textContent()).includes('관리 시험 필수품'));
 assert.equal(await page.locator('.manager-readonly input').count(),0);
 const modelFieldTops=await page.locator('.manager-model-fields input').evaluateAll(elements=>elements.map(el=>Math.round(el.getBoundingClientRect().top)));
 assert.equal(new Set(modelFieldTops).size,1,'model name and description fields stay on one desktop row');
 await page.locator('#modelPartPicker').selectOption(optionId);await page.getByRole('button',{name:'+ 모델에 추가',exact:true}).click();
 await page.locator(`[data-model-part="${optionPartId}"]`).getByLabel(/수량/).fill('3');
 const previousSpecific=await page.evaluate(id=>{const m=manager.draft.models.find(model=>model.id==='G1'),required=requiredPartIds(manager.draft,m.type),specific=m.items.filter(row=>!required.has(row.partId)),position=specific.findIndex(row=>row.partId===id);return position>0?{id:specific[position-1].partId,van:specific[position-1].van}:null},optionPartId);assert.ok(previousSpecific);
 await page.locator(`[data-model-part="${optionPartId}"]`).getByRole('button',{name:/위로 이동/}).click();
 assert.equal(await page.evaluate(([id,previous])=>{const m=manager.draft.models.find(model=>model.id==='G1');return m.items.findIndex(row=>row.partId===id)<m.items.findIndex(row=>row.partId===previous)},[optionPartId,previousSpecific.id]),true);
 for(const selector of ['.manager-header','.manager-footer']){const box=await page.locator(selector).boundingBox();assert.ok(box.y>=0&&box.y+box.height<=1050,'editor chrome remains visible: '+selector)}
 await screenshot(page,'catalog-model-editor');
 assert.equal(await page.evaluate(()=>calc().total),initial);
 failSave=true;await page.locator('#saveCatalogButton').click();await page.waitForFunction(()=>!manager.saving&&document.getElementById('managerStatus').classList.contains('error'));
 assert.equal(await page.evaluate(()=>manager.dirty),true);assert.equal(await page.evaluate(()=>calc().total),initial);
 failSave=false;await saveManager(page);
 const stored=JSON.parse(files.get('parts.json')),newOption=stored.options.find(o=>o.id===optionId);
 assert.equal(stored.parts.find(p=>p.id===optionPartId).pn,'-');assert.equal(stored.parts.find(p=>p.id===optionPartId).price,null);assert.equal(stored.models[0].items.find(row=>row.partId===optionPartId).qty,3);assert.ok(stored.models[0].items.findIndex(row=>row.partId===optionPartId)<stored.models[0].items.findIndex(row=>row.partId===previousSpecific.id));
 assert.ok(stored.models.filter(m=>m.type==='general').every(m=>m.items.some(row=>row.partId===requiredId&&row.qty===2)));
 await page.getByRole('button',{name:'G2 일반형',exact:true}).click();assert.equal(await page.evaluate(()=>manager.model),'G2');
 await page.locator('#closeSettingsButton').click();
 assert.equal(await page.evaluate(([id,previous,van])=>{const rows=baseParts('general',1,van==='ALL'?'NICE':van);return rows.findIndex(row=>row.id===id)<rows.findIndex(row=>row.id===previous)},[optionPartId,previousSpecific.id,previousSpecific.van]),true,'saved model-part order reaches the main configuration');
 assert.equal((await page.locator('#options .optionalGroup').allTextContents()).filter(group=>group==='교체·기타').length,1,'existing option group heading remains unique after moving an option');
 assert.equal(await page.locator('body>header').evaluate(el=>getComputedStyle(el).position),'sticky');await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(50);assert.ok((await page.locator('body>header').boundingBox()).y<=1,'main header stays visible while scrolling');await page.evaluate(()=>scrollTo(0,0));
 assert.equal(await page.evaluate(()=>calc().total),initial-1250000+100000);
 assert.ok((await page.locator('#options').textContent()).includes('관리 시험 장치 <b>표시</b>'));
 assert.equal(await page.locator('#options b b').count(),0);
 await page.getByLabel('passport 수량',{exact:true}).fill('1');await page.getByLabel('passport 수량',{exact:true}).press('Tab');
 assert.equal(await page.evaluate(()=>calc().lines.some(row=>row.id==='g20')),false);assert.equal(await page.evaluate(()=>calc().lines.find(row=>row.id==='o52').qty),1);assert.equal(await page.evaluate(()=>calc().adjust),-680000);assert.ok((await page.locator('#sumOptions').textContent()).includes('와이즈큐브 1개 차감'));
 await page.getByRole('button',{name:'요청 내용 복사',exact:true}).click();await page.waitForFunction(()=>window.copied.length>0);assert.ok(await page.evaluate(()=>window.copied.some(item=>item.text.includes('관리 시험 장치'))));assert.ok(await page.evaluate(()=>window.copied.some(item=>item.type==='text/plain'&&item.text.includes('여권인식기 교체 (다윈) 1개')&&!item.text.includes('기본 여권인식기 (P/N: KI00192)'))));
 await page.getByRole('button',{name:'인쇄',exact:true}).click();const previewText=await page.locator('#previewPaper').textContent();assert.ok(previewText.includes('관리 시험 장치'));assert.ok(previewText.includes('여권인식기 교체 (다윈)'));assert.ok(!previewText.includes('기본 여권인식기'));await page.locator('#printPreview').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'전체 모델 원가 구성 내려받기',exact:true}).click();assert.ok((await page.locator('[data-catalog-model="G1"]').textContent()).includes('관리 시험 장치'));await page.locator('#catalogPreview').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'추가옵션 구성 내려받기',exact:true}).click();assert.ok((await page.locator('#optionsCatalogPaper').textContent()).includes('관리 시험 장치'));await page.locator('#optionsCatalogPreview').getByRole('button',{name:'닫기',exact:true}).click();
 await page.locator('[data-key="site"]').fill('관리 변경 전 신청서');await page.locator('#saveHistoryButton').click();await page.waitForFunction(()=>document.getElementById('saveHistoryStatus').textContent.startsWith('저장 완료'));
 const historical=files.get('history.json');assert.ok(JSON.parse(historical).entries[0].state.catalogSnapshot.parts.some(p=>p.id===optionPartId));assert.equal(JSON.parse(historical).entries[0].state.options.passport.qty,1);
 await openManager(page);assert.equal(await page.getByRole('tab',{name:/모델 구성/}).getAttribute('aria-selected'),'true');assert.equal(await page.evaluate(()=>manager.model),'G1');await page.getByRole('tab',{name:/추가 옵션/}).click();await page.locator('.manager-group-tabs').getByRole('button',{name:/교체·기타/}).click();await page.locator(`[data-option-row="${optionId}"]`).getByRole('button',{name:/제거/}).click();await page.getByRole('tab',{name:/필수항목/}).click();await page.locator(`[data-required-row="${requiredId}"]`).getByRole('button',{name:/제거/}).click();await page.locator('[data-required-row="g8"]').getByLabel('금액',{exact:true}).fill('200000');await saveManager(page);await page.locator('#closeSettingsButton').click();
 assert.equal(files.get('history.json'),historical);assert.ok(!JSON.parse(files.get('parts.json')).parts.some(p=>p.id===optionPartId||p.id===requiredId));
 await page.getByRole('button',{name:'이력보기',exact:true}).click();await page.waitForFunction(()=>!historyView.busy);await page.locator('.history-load').first().click();await page.waitForFunction(()=>!document.getElementById('historyDialog').open);
 assert.equal(await page.evaluate(()=>calc().base.find(p=>p.id==='g8').price),100000);assert.equal(await page.evaluate(id=>calc().base.find(p=>p.id===id).qty,optionPartId),3);assert.equal(await page.evaluate(id=>calc().base.find(p=>p.id===id).qty,requiredId),2);assert.equal(await page.evaluate(()=>calc().lines.some(row=>row.id==='g20')),false);assert.equal(await page.evaluate(()=>calc().lines.find(row=>row.id==='o52').qty),1);
 await page.getByRole('button',{name:'새 신청서 작성',exact:true}).click();assert.equal(await page.evaluate(()=>calc().base.find(p=>p.id==='g8').price),200000);assert.equal(await page.evaluate(ids=>calc().base.some(p=>ids.includes(p.id)),[optionPartId,requiredId]),false);assert.equal(await page.evaluate(()=>calc().lines.find(row=>row.id==='g20').qty),1);assert.equal(await page.evaluate(()=>calc().lines.some(row=>row.id==='o52')),false);
 await context.close();
 const mobile=await makePage(320);await openManager(mobile.page);
 for(const tab of [/필수항목/,/모델 구성/,/추가 옵션/]){await mobile.page.getByRole('tab',{name:tab}).click();assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const footer=await mobile.page.locator('.manager-footer').boundingBox();assert.ok(footer.y+footer.height<=1050);await screenshot(mobile.page,'catalog-mobile-'+(tab.source.includes('모델')?'models':tab.source.includes('옵션')?'options':'required'))}
 await mobile.page.locator('#closeSettingsButton').click();
 await mobile.page.setViewportSize({width:703,height:1100});await mobile.page.emulateMedia({media:'print'});
 const heights=await mobile.page.evaluate(()=>{state=fresh();catalog=structuredClone(DEFAULT_CATALOG);syncCatalogBindings();document.getElementById('printArea').innerHTML=catalogMarkup();return[...document.querySelectorAll('.catalog-sheet')].map(el=>Math.ceil(el.getBoundingClientRect().height))});
 assert.equal(heights.length,9);assert.ok(heights.every(h=>h<=1032),'default model report overflows A4: '+JSON.stringify(heights));
 await mobile.context.close();assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',checks:['required/model/option editing','failed save keeps draft','shared catalog replacement','passport replacement in copy/print/history','main/copy/print/reports use configured parts','past history keeps original configuration','fresh request uses latest master','mobile editor layout','default 9-page A4 report'],reportHeights:heights,realGithubWrites:0}));
}finally{await browser.close()}
