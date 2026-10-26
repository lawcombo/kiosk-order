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

test('VAN conditions remain respected and former replacement options behave like regular options',()=>{
 const h=app();h.run(`const modified=structuredClone(catalog);modified.models[0].items.find(p=>p.partId==='g20').qty=2;applyCatalog(modified,{replaceOrder:true});state.qty=3;state.options.passport={qty:6,on:true}`);
 assert.equal(h.json("optionLimit(optDefs.find(o=>o.id==='passport'))"),10000);
 assert.equal(h.json('calc().adjust'),0);
 assert.equal(h.json("calc().lines.find(p=>p.id==='g20').qty"),6);
 assert.equal(h.json("calc().lines.find(p=>p.id==='o52').qty"),6);
 h.run("state.van='KIS'");assert.equal(h.json("baseParts().some(p=>p.id==='c35')"),false);assert.equal(h.json("baseParts().some(p=>p.id==='c36')"),true);
 h.run("state.type='equipment'");assert.deepEqual(h.json('baseParts()'),[]);assert.equal(h.json('calc().adjust'),0);
});

test('old histories restore the original configuration and new histories preserve custom configurations',()=>{
 const h=app();h.run(`const originalState={...fresh(),type:'general',model:1,info:{site:'이전 이력',date:'2026-09-01'},overrides:{g8:{price:99}}};const modified=structuredClone(catalog);modified.models[0].items=modified.models[0].items.filter(row=>row.partId!=='g8');applyCatalog(modified,{replaceOrder:true});restoreOrder(originalState)`);
 assert.equal(h.json("calc().base.find(p=>p.id==='g8').price"),99);
 assert.equal(h.json('state.info.date'),'2026-09-01');
 h.run('const snapshot=historySnapshot();resetRequest();restoreOrder(snapshot)');assert.equal(h.json("calc().base.find(p=>p.id==='g8').price"),99);
});
