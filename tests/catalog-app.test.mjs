import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {appHarness} from './app-harness.mjs';
import {validateCatalog} from '../history-api/worker.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/default-models.json',import.meta.url),'utf8'));
const app=()=>appHarness(html);

test('all 24 original model/VAN combinations preserve parts, quantities, prices and totals',()=>{
 const h=app();
 for(const expected of baseline.models){h.run(`state={...fresh(),type:'${expected.type}',model:${expected.model},van:'${expected.van}'}`);assert.deepEqual(h.json('({total:calc().total,parts:calc().base.map(p=>({id:p.id,qty:p.qty,price:p.price,pn:p.pn}))})'),{total:expected.total,parts:expected.parts},expected.type+expected.model+expected.van)}
 assert.deepEqual(h.json('optionsCatalogRecords()'),baseline.options);
});

test('the embedded editor and validator match their maintained sources',()=>{
 const embedded=html.match(/<script id="catalogCode">\s*([\s\S]*?)<\/script>/)[1].trim().replace(/\r\n/g,'\n');
 const expected=(validateCatalog.toString()+'\n'+fs.readFileSync(new URL('../scripts/catalog-ui.js',import.meta.url),'utf8')).trim().replace(/\r\n/g,'\n');
 assert.equal(embedded,expected);
});

test('a model change updates calculation, request copies, print markup and both catalogs',()=>{
 const h=app();
 h.run(`const changed=structuredClone(catalog);changed.parts.push({id:'p_custom',category:'common',name:'새 시험 장치',pn:'TEST-PN',spec:'시험',price:1234});changed.models[0].items.push({partId:'p_custom',qty:3,section:'model',van:'ALL'});changed.options.push({id:'customOption',name:'새 시험 장치',ids:['p_custom'],group:'추가 장비',unit:'개',defaultQty:1,replacement:false});applyCatalog(changed,{replaceOrder:true});state.type='general';state.model=1;state.qty=2;state.priceDisclosure='Y';state.options.customOption={qty:4,on:true};`);
 assert.equal(h.json('calc().total'),baseline.models[0].total*2+1234*10);
 assert.ok(h.json('requestText()').includes('새 시험 장치'));
 assert.ok(h.json('requestMarkup()').includes('TEST-PN'));
 assert.ok(h.json('emailMarkup()').includes('TEST-PN'));
 assert.ok(h.json('catalogText()').includes('새 시험 장치'));
 assert.ok(h.json('catalogMarkup()').includes('TEST-PN'));
 assert.ok(h.json('optionsCatalogText()').includes('새 시험 장치'));
});

test('removing a part removes all references and does not break any model or option output',()=>{
 const h=app();h.run(`manager.draft=structuredClone(catalog);manager.loaded=true;removeCatalogPart('g26');applyCatalog(manager.draft,{replaceOrder:true})`);
 assert.equal(h.json("allParts.some(p=>p.id==='g26')"),false);
 assert.equal(h.json("optDefs.some(o=>o.id==='ptz')"),false);
 for(const type of ['general','slim','equipment']){h.run(`state.type='${type}'`);assert.equal(typeof h.json('calc().total'),'number');assert.ok(!h.json('requestMarkup()').includes('KI00672'))}
 assert.ok(!h.json('catalogMarkup()').includes('KI00672'));
});

test('required items sync by kiosk type and model additions come from registered options',()=>{
 const h=app();
 h.run(`manager.draft=structuredClone(catalog);manager.loaded=true;manager.requiredType='general';const beforeRequired=requiredCount(manager.draft);addRequiredPart();const requiredId=manager.draft.parts.at(-1).id;managerInput({dataset:{admin:'required',id:requiredId,field:'name'},value:'공통 시험 필수품'});managerInput({dataset:{admin:'required',id:requiredId,field:'pn'},value:'REQ-1'});managerInput({dataset:{admin:'required',id:requiredId,field:'price'},value:'123'});managerInput({dataset:{admin:'required',id:requiredId,field:'qty'},value:'2'});`);
 assert.equal(h.json('requiredCount(manager.draft)'),h.json('beforeRequired')+1);
 assert.equal(h.json("manager.draft.models.filter(m=>m.type==='general').every(m=>m.items.some(row=>row.partId===requiredId&&row.section==='fixed'&&row.qty===2))"),true);
 assert.equal(h.json("manager.draft.models.filter(m=>m.type==='slim').some(m=>m.items.some(row=>row.partId===requiredId))"),false);
 h.run(`manager.groups.push('시험 그룹');manager.optionGroup='시험 그룹';addCatalogOption();const addedOption=manager.draft.options.at(-1),optionId=addedOption.id,optionPartId=addedOption.ids[0];managerInput({dataset:{admin:'option',id:optionId,field:'name'},value:'모델 시험 옵션'});managerInput({dataset:{admin:'option',id:optionId,field:'pn'},value:'OPT-1'});managerInput({dataset:{admin:'option',id:optionId,field:'price'},value:'456'});manager.model='G1';$('modelPartPicker').value=optionId;addModelItem();`);
 assert.equal(h.json("manager.draft.parts.find(p=>p.id===optionPartId).category"),'common');
 assert.equal(h.json("manager.draft.models.find(m=>m.id==='G1').items.some(row=>row.partId===optionPartId&&row.section==='model')"),true);
 assert.equal(h.json("manager.draft.models.find(m=>m.id==='G2').items.some(row=>row.partId===optionPartId)"),false);
 assert.doesNotThrow(()=>validateCatalog(h.json('manager.draft')));
});

test('model-specific parts can be reordered without changing required item order',()=>{
 const h=app();
 h.run(`manager.draft=structuredClone(catalog);manager.loaded=true;manager.model='G1';const reorderModel=manager.draft.models.find(m=>m.id==='G1'),reorderRequired=requiredPartIds(manager.draft,reorderModel.type),reorderFixedBefore=reorderModel.items.filter(row=>reorderRequired.has(row.partId)).map(row=>row.partId),reorderSpecificBefore=reorderModel.items.filter(row=>!reorderRequired.has(row.partId)).map(row=>row.partId),reorderIndex=reorderModel.items.findIndex(row=>row.partId===reorderSpecificBefore[1]);moveModelItem(reorderIndex,-1);`);
 assert.deepEqual(h.json('reorderModel.items.filter(row=>reorderRequired.has(row.partId)).map(row=>row.partId)'),h.json('reorderFixedBefore'));
 assert.deepEqual(h.json('reorderModel.items.filter(row=>!reorderRequired.has(row.partId)).map(row=>row.partId).slice(0,2)'),h.json('[reorderSpecificBefore[1],reorderSpecificBefore[0]]'));
 assert.equal(h.json('manager.dirty'),true);
});

test('moving an option joins its existing group without duplicating the main heading',()=>{
 const h=app();
 h.run(`manager.draft=structuredClone(catalog);manager.loaded=true;syncManagerGroups(manager.draft);const movedOption=manager.draft.options.find(o=>o.id==='motion');manager.optionGroup=movedOption.group;managerInput({dataset:{admin:'option',id:movedOption.id,field:'group'},value:'교체·기타'});const targetPositions=manager.draft.options.map((o,index)=>o.group==='교체·기타'?index:-1).filter(index=>index>=0);applyCatalog(manager.draft,{replaceOrder:true});`);
 assert.equal(h.json("manager.draft.options.find(o=>o.id==='motion').group"),'교체·기타');
 assert.equal(h.json('Math.max(...targetPositions)-Math.min(...targetPositions)+1'),h.json('targetPositions.length'));
 assert.equal(h.json("optDefs.filter(o=>o.group==='교체·기타').length"),1);
 assert.deepEqual(h.json('optDefs.filter(o=>o.group).map(o=>o.group)'),h.json('[...new Set(optDefs.filter(o=>o.group).map(o=>o.group))]'));
});

test('passport replacement subtracts the configured base reader across copies, print data and history',()=>{
 const h=app();h.run(`const modified=structuredClone(catalog);modified.models[0].items.find(p=>p.partId==='g20').qty=2;applyCatalog(modified,{replaceOrder:true});state.qty=3;state.options.passport={qty:2,on:true}`);
 assert.equal(h.json("optionLimit(optDefs.find(o=>o.id==='passport'))"),6);
 assert.equal(h.json('calc().adjust'),-680000*2);
 assert.equal(h.json("calc().lines.find(p=>p.id==='g20').qty"),4);
 assert.equal(h.json("calc().lines.find(p=>p.id==='o52').qty"),2);
 h.run('state.options.passport={qty:6,on:true}');
 assert.equal(h.json('calc().adjust'),-680000*6);
 assert.equal(h.json("calc().lines.some(p=>p.id==='g20')"),false);
 assert.equal(h.json("calc().lines.find(p=>p.id==='o52').qty"),6);
 assert.ok(h.json('requestText()').includes('여권인식기 교체 (다윈) 6개'));
 assert.ok(!h.json('requestText()').includes('기본 여권인식기 (P/N: KI00192)'));
 assert.ok(h.json('requestMarkup()').includes('교체 수량만큼 와이즈큐브를 제외했습니다.'));
 h.run('const replacementSnapshot=historySnapshot();resetRequest();restoreOrder(replacementSnapshot)');
 assert.equal(h.json("calc().lines.some(p=>p.id==='g20')"),false);
 assert.equal(h.json("calc().lines.find(p=>p.id==='o52').qty"),6);
 h.run("state.van='KIS'");assert.equal(h.json("baseParts().some(p=>p.id==='c35')"),false);assert.equal(h.json("baseParts().some(p=>p.id==='c36')"),true);
 h.run("state.type='equipment'");assert.deepEqual(h.json('baseParts()'),[]);assert.equal(h.json("optionLimit(optDefs.find(o=>o.id==='passport'))"),10000);assert.equal(h.json('calc().adjust'),0);
});

test('all kiosk models omit obsolete bracket, card issuer and AI BOX warnings',()=>{
 const h=app();
 const obsolete=['슬림형 브라켓은 잠정단가 적용','카드발행기: 도어락 연동·장착 부속 확인','AI BOX의 녹화·저장·조회 구성 확인'];
 for(const type of ['general','slim'])for(const model of [1,2,3,4]){h.run(`state.type='${type}';state.model=${model}`);const messages=h.json('warnings(calc())');for(const message of obsolete)assert.ok(!messages.includes(message),type+model+' still shows '+message)}
});

test('model cost breakdown always shows fixed parts, their subtotal and model equipment sections',()=>{
 const h=app();
 for(const type of ['general','slim']){h.run(`state.type='${type}';state.model=1`);const markup=h.json('breakdown(baseParts())'),label=type==='general'?'일반형':'슬림형';assert.ok(markup.includes(label+' 고정 부품'));assert.ok(markup.includes(label+' 고정 부품 소계'));assert.ok(markup.includes('모델별 포함 장비'));assert.ok(markup.includes('모델별 포함 장비 소계'));assert.ok(markup.includes('모델 기본 원가 합계'));assert.ok(!markup.includes('toggleFixed()'));assert.ok(!markup.includes('카드토출기는 함체, NVR은 저장용 HDD를 함께 포함합니다.'))}
});

test('request-only unneeded parts reduce cost, strike outputs and survive history without changing the catalog',()=>{
 const h=app();
 h.run(`state.type='general';state.model=1;state.van='NICE';state.qty=2;state.priceDisclosure='Y';const unneededBefore=calc().total;toggleUnneeded('g8');const unneededSnapshot=historySnapshot();`);
 assert.equal(h.json('unneededBefore-calc().total'),2500000);
 assert.equal(h.json("calc().base.find(p=>p.id==='g8').unneeded"),true);
 assert.equal(h.json("calc().lines.find(p=>p.id==='g8').qty"),2);
 assert.deepEqual(h.json("state.excludedParts['general|1|NICE']"),['g8']);
 const breakdown=h.json('breakdown(calc().base)'),button=breakdown.indexOf("toggleUnneeded('g8')"),name=breakdown.indexOf('함체',button);
 assert.ok(button>=0&&button<name,'the unneeded button stays left of the part name');
 assert.ok(breakdown.includes('breakdown-unneeded'));
 assert.ok(h.json('requestText()').includes('[불필요 · 출하 제외] 함체'));
 for(const markup of [h.json('requestMarkup()'),h.json('emailMarkup()')]){assert.ok(markup.includes('req-unneeded-row'));assert.ok(markup.includes('text-decoration:line-through'));assert.ok(markup.includes('불필요'))}
 assert.equal(h.run("baseParts().find(p=>p.id==='g8').unneeded"),undefined);
 assert.equal(h.json("currentCatalog().models.find(m=>m.id==='G1').items.some(row=>row.partId==='g8')"),true);
 h.run('resetRequest()');assert.deepEqual(h.json('state.excludedParts'),{});
 h.run('restoreOrder(unneededSnapshot)');assert.deepEqual(h.json("state.excludedParts['general|1|NICE']"),['g8']);assert.equal(h.json("calc().base.find(p=>p.id==='g8').unneeded"),true);
});

test('catalog cover splits general and slim summaries without the old guide',()=>{
 const h=app(),markup=h.json('catalogMarkup()'),cover=markup.slice(0,markup.indexOf('</article>'));
 assert.ok(!cover.includes('원가 구성 기준'));
 assert.ok(cover.includes('일반형 모델별 원가 요약'));
 assert.ok(cover.includes('슬림형 모델별 원가 요약'));
 assert.ok(cover.indexOf('일반형 모델별 원가 요약')<cover.indexOf('슬림형 모델별 원가 요약'));
 assert.equal((cover.match(/<table class="req-table">/g)||[]).length,2);
 assert.ok(!cover.includes('<th>제품 유형</th>'));
});

test('Excel worksheets mirror the current catalog in the supplied three-sheet layout',()=>{
 const h=app();
 h.run(`const changed=structuredClone(catalog);changed.parts.push({id:'excel_part',category:'common',name:'엑셀 반영 시험품',pn:'EXCEL-PN',spec:'양식 반영',price:3210});changed.models[0].items.push({partId:'excel_part',qty:2,section:'model',van:'ALL'});applyCatalog(changed,{replaceOrder:true});const excelRecords=catalogRecords(),excelGeneral=catalogExcelDetail(excelRecords.filter(record=>record.type==='general')),excelSlim=catalogExcelDetail(excelRecords.filter(record=>record.type==='slim')),excelSummary=catalogExcelSummary(excelRecords,{general:excelGeneral.lastRow,slim:excelSlim.lastRow});`);
 assert.ok(h.json('excelGeneral.xml').includes('엑셀 반영 시험품 / 양식 반영'));
 assert.ok(h.json('excelGeneral.xml').includes('EXCEL-PN'));
 assert.ok(h.json('excelSlim.xml').includes('S4'));
 assert.ok(h.json('excelSummary').includes('키오스크 제품 유형 · 모델별 원가'));
 assert.ok(h.json('excelSummary').includes('SUMIFS'));
 assert.ok(h.json('excelSummary').includes('NICE VAN 최종 원가'));
 assert.ok(!h.json('excelSummary').includes('잠정단가'));
 assert.ok(h.json('catalogExcelWorkbook()').indexOf('<sheets>')<h.json('catalogExcelWorkbook()').indexOf('<calcPr'));
 assert.ok([...h.json('catalogExcelStyles()').matchAll(/<font>(.*?)<\/font>/g)].every(match=>match[1].indexOf('<color')<match[1].indexOf('<name')));
});

test('field emphasis colors only selected values and survives history snapshots',()=>{
 const h=app();h.run(`state.info={...state.info,applicant:'홍길동 / 운영팀',site:'강조 숙박',notes:'긴급 설치'};state.infoEmphasis={applicant:true,notes:true}`);
 for(const markup of [h.json('requestMarkup()'),h.json('emailMarkup()')]){
  assert.ok(markup.includes('신청자 / 소속'));
  assert.ok(markup.includes('<span class="info-emphasis" style="color:#c62828;font-weight:700">★ 홍길동 / 운영팀</span>'));
  assert.ok(markup.includes('<span class="info-emphasis" style="color:#c62828;font-weight:700">★ 긴급 설치</span>'));
  assert.ok(markup.includes('숙박업소명'));
  assert.ok(markup.includes('강조 숙박'));
  assert.ok(!markup.includes('<span class="info-emphasis" style="color:#c62828;font-weight:700">강조 숙박</span>'));
 }
 const text=h.json('requestText()');
 assert.ok(text.includes('신청자: ★ 홍길동 / 운영팀'));
 assert.ok(text.includes('[6. 설치·출하 요청사항]\n★ 긴급 설치'));
 assert.ok(text.includes('숙박업소명: 강조 숙박'));
 assert.ok(!text.includes('숙박업소명: ★ 강조 숙박'));
 h.run('const emphasizedSnapshot=historySnapshot();resetRequest();restoreOrder(emphasizedSnapshot)');
 assert.deepEqual(h.json('state.infoEmphasis'),{applicant:true,notes:true});
});

test('old histories restore the original configuration and new histories preserve custom configurations',()=>{
 const h=app();h.run(`const originalState={...fresh(),type:'general',model:1,info:{site:'이전 이력',date:'2026-09-01'},overrides:{g8:{price:99}}};const modified=structuredClone(catalog);modified.models[0].items=modified.models[0].items.filter(row=>row.partId!=='g8');applyCatalog(modified,{replaceOrder:true});restoreOrder(originalState)`);
 assert.equal(h.json("calc().base.find(p=>p.id==='g8').price"),99);
 assert.equal(h.json('state.info.date'),'2026-09-01');
 h.run('const snapshot=historySnapshot();resetRequest();restoreOrder(snapshot)');assert.equal(h.json("calc().base.find(p=>p.id==='g8').price"),99);
});
