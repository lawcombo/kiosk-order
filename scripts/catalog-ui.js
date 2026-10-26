// Embedded in index.html so the order page remains self-contained.
const DEFAULT_CATALOG=JSON.parse(document.getElementById('catalogData').textContent);
let catalog=structuredClone(DEFAULT_CATALOG);
let catalogLoadSequence=0;
let catalogLoadError='';
const manager={draft:null,revision:null,loaded:false,loading:false,saving:false,dirty:false,tab:'models',model:'G1',requiredType:'general',optionGroup:'',groups:[],sequence:0};
function currentCatalog(){return state.catalogSnapshot||catalog}
function modelInfo(type=state.type,number=state.model){return currentCatalog().models.find(m=>m.type===type&&m.number===number)}
function modelSummary(type=state.type,number=state.model){
 const m=modelInfo(type,number),original=DEFAULT_CATALOG.models.find(x=>x.id===m.id);
 if(m.description&&m.description!==original.description)return m.description;
 if(JSON.stringify(m.items)===JSON.stringify(original.items)&&m.items.every(row=>currentCatalog().parts.find(p=>p.id===row.partId)?.name===DEFAULT_CATALOG.parts.find(p=>p.id===row.partId)?.name))return m.description;
 const names=m.items.filter(row=>row.van==='ALL'&&row.section!=='fixed').map(row=>currentCatalog().parts.find(p=>p.id===row.partId)?.name).filter(Boolean);
 return names.length?names.slice(0,3).join(' · ')+(names.length>3?' 외 '+(names.length-3)+'종':''):'등록된 기본 품목 '+m.items.filter(row=>row.van==='ALL').length+'종';
}
function syncCatalogBindings(){
 const data=currentCatalog();allParts=data.parts;let group='';
 optDefs=optionsByGroup(data.options).map(o=>{const start=o.group!==group;group=o.group;return{...o,catalogGroup:o.group,group:start?o.group:''}});
 const allowed=new Set(optDefs.map(o=>o.id));for(const key of Object.keys(state.options))if(!allowed.has(key))delete state.options[key];
}
function replacementPartId(type=state.type,number=state.model){return type==='equipment'?null:modelInfo(type,number)?.replacementBaseId||null}
function replacementQuantity(){const key=replacementPartId();return key?(baseParts().find(p=>p.id===key)?.qty||0)*state.qty:0}
function applyCatalog(data,{replaceOrder=false}={}){
 catalog=validateCatalog(data);
 catalogLoadError='';
 if(replaceOrder){delete state.catalogSnapshot;state.overrides={};state.pn={}}
 syncCatalogBindings();render();$('printArea').innerHTML='';$('previewPaper').innerHTML='';$('catalogPaper').innerHTML='';$('optionsCatalogPaper').innerHTML='';
}
async function catalogRequest(options={}){return historyRequest('',{...options,catalog:true})}
async function loadInitialCatalog(){const sequence=++catalogLoadSequence;try{const result=await catalogRequest();if(sequence===catalogLoadSequence&&result.catalog)applyCatalog(result.catalog)}catch{if(sequence===catalogLoadSequence){catalogLoadError='공유 부품 설정을 불러오지 못해 기본 구성을 표시합니다. 관리자 연결을 확인해주세요.';render()}}}
function restoreOrder(data){state=normalize(data);state.catalogSnapshot=validateCatalog(state.catalogSnapshot||DEFAULT_CATALOG);syncCatalogBindings()}
function requiredPartIds(data,type){
 const models=data.models.filter(m=>m.type===type);if(!models.length)return new Set();
 return new Set(models[0].items.filter(row=>row.section==='fixed'&&row.van==='ALL'&&models.every(m=>m.items.some(item=>item.partId===row.partId&&item.section==='fixed'&&item.van==='ALL'))).map(row=>row.partId));
}
function requiredRows(data,type){
 const models=data.models.filter(m=>m.type===type),ids=requiredPartIds(data,type);if(!models.length)return[];
 return models[0].items.filter(row=>ids.has(row.partId)).map(row=>({part:data.parts.find(p=>p.id===row.partId),qty:row.qty})).filter(row=>row.part);
}
function requiredCount(data){return new Set(['general','slim'].flatMap(type=>[...requiredPartIds(data,type)])).size}
function optionsByGroup(options,groups=[...new Set(options.map(o=>o.group).filter(Boolean))]){const order=[...new Set(groups.filter(Boolean))],known=new Set(order);return[...order.flatMap(group=>options.filter(o=>o.group===group)),...options.filter(o=>!known.has(o.group))]}
function optionGroups(data=manager.draft){return [...new Set([...manager.groups,...(data?.options||[]).map(o=>o.group).filter(Boolean)])]}
function syncManagerGroups(data){manager.groups=[...new Set(data.options.map(o=>o.group).filter(Boolean))];if(!manager.groups.length)manager.groups=['추가 장비'];if(!manager.groups.includes(manager.optionGroup))manager.optionGroup=manager.groups[0]}
function optionPart(option,data=manager.draft){return data.parts.find(p=>p.id===option.ids[0])}
function optionForPart(id,data=manager.draft){return data.options.find(o=>o.ids.includes(id))}
function managerMessage(text,error=false){$('managerStatus').textContent=text;$('managerStatus').classList.toggle('error',error)}
function managerDirty(){manager.dirty=true;managerMessage('저장하지 않은 변경사항이 있습니다.');renderManagerFooter()}
function renderManagerFooter(){
 $('saveCatalogButton').disabled=!manager.loaded||!manager.dirty||manager.loading||manager.saving;
 $('saveCatalogButton').textContent=manager.saving?'저장 중…':'변경사항 저장';
 $('reloadCatalogButton').disabled=manager.loading||manager.saving;$('closeSettingsButton').disabled=manager.saving;
 $('managerFields').inert=manager.loading||manager.saving||!manager.draft;
 document.querySelectorAll('[data-manager-tab]').forEach(el=>{el.setAttribute('aria-selected',String(el.dataset.managerTab===manager.tab));el.disabled=manager.loading||manager.saving});
}
async function openSettings(){
 if($('settings').open)return;
 catalogLoadSequence++;
 manager.draft=null;manager.dirty=false;manager.loaded=false;manager.tab='models';manager.model='G1';manager.groups=[];$('settings').showModal();renderManager();await reloadCatalog(false);
}
function closeSettings(){
 if(manager.saving)return;
 if(manager.dirty&&!confirm('저장하지 않은 설정 변경을 닫을까요?'))return;
 manager.sequence++;manager.loading=false;$('settings').close();
}
async function reloadCatalog(ask=true){
 if(manager.saving||manager.loading)return;
 if(ask&&manager.dirty&&!confirm('편집 중인 내용을 버리고 저장된 설정을 다시 불러올까요?'))return;
 const sequence=++manager.sequence;manager.loading=true;renderManagerFooter();managerMessage('저장된 필수항목과 모델 구성을 불러오는 중입니다.');
 try{
  const result=await catalogRequest();if(sequence!==manager.sequence)return;
  const data=validateCatalog(result.catalog||DEFAULT_CATALOG);
  manager.draft=structuredClone(data);manager.revision=result.revision;manager.loaded=true;manager.dirty=false;syncManagerGroups(manager.draft);
  applyCatalog(data);managerMessage('저장된 설정입니다. 수정 후 저장하면 모든 사용자에게 적용됩니다.');renderManager();
 }catch(error){if(sequence===manager.sequence){manager.loaded=false;if(!manager.draft)$('managerContent').innerHTML='<div class="manager-empty">설정을 불러오지 못했습니다. 아래 안내를 확인한 뒤 다시 불러오기를 눌러주세요.</div>';managerMessage('설정을 불러오지 못했습니다. '+error.message,true)}}
 finally{if(sequence===manager.sequence){manager.loading=false;renderManagerFooter()}}
}
async function saveCatalog(){
 if(!manager.loaded||manager.loading||manager.saving||!manager.dirty)return;
 let draft;try{draft=validateCatalog(manager.draft)}catch(error){managerMessage(error.message,true);return}
 if(!confirm(`필수항목 ${requiredCount(draft)}개, 모델 8개, 추가 옵션 ${draft.options.length}개의 설정을 저장할까요?\n메인 화면과 보고서에 함께 적용됩니다.`))return;
 manager.saving=true;renderManagerFooter();managerMessage('변경한 설정을 저장하는 중입니다.');
 try{
  const result=await catalogRequest({method:'PUT',body:JSON.stringify({schemaVersion:1,revision:manager.revision,catalog:draft})});
  manager.draft=validateCatalog(result.catalog);manager.revision=result.revision;manager.dirty=false;manager.loaded=!!result.revision;syncManagerGroups(manager.draft);
  syncFormFields();applyCatalog(manager.draft,{replaceOrder:true});managerMessage('저장 완료 · 메인 화면과 보고서에 적용했습니다.');renderManager();toast('필수항목과 모델 구성을 저장했습니다.');
 }catch(error){managerMessage(error.message,true)}finally{manager.saving=false;renderManagerFooter()}
}
function switchManagerTab(tab){if(manager.loading||manager.saving)return;manager.tab=tab;renderManager();$('managerContent').scrollTop=0}
function categoryName(value){return{general:'일반형',slim:'슬림형',common:'추가 옵션'}[value]||value}
function managerSelect(values,value,attrs){return `<select ${attrs}>${values.map(([key,label])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(label)}</option>`).join('')}</select>`}
function renderManager(){
 if(!manager.draft){$('managerTools').innerHTML='';$('managerContent').innerHTML='<div class="manager-empty">저장된 설정을 연결하고 있습니다.</div>';renderManagerFooter();return}
 const data=manager.draft;
 document.querySelectorAll('[data-manager-count]').forEach(el=>{const key=el.dataset.managerCount;el.textContent=key==='required'?requiredCount(data):key==='models'?8:data.options.length});
 if(manager.tab==='required'){
  $('managerTools').innerHTML=`<div><b>필수항목</b><small>일반형·슬림형 모든 모델에 공통으로 들어가는 품목입니다. 여기서 수정하면 해당 타입의 4개 모델에 함께 적용됩니다.</small></div><div class="manager-type-tabs"><button class="btn ${manager.requiredType==='general'?'primary':''}" data-click="selectRequiredType('general')">일반형 필수항목</button><button class="btn ${manager.requiredType==='slim'?'primary':''}" data-click="selectRequiredType('slim')">슬림형 필수항목</button><button class="btn manager-add-button" data-click="addRequiredPart()">+ 필수항목 추가</button></div>`;
  renderManagerRequired();
 }else if(manager.tab==='models'){
  $('managerTools').innerHTML=`<div><b>모델 구성</b><small>타입별 필수항목은 자동으로 포함됩니다. 아래에서 추가 옵션에 등록한 부품만 모델별로 선택하세요.</small></div><div class="manager-model-tabs">${data.models.map(m=>`<button class="btn ${manager.model===m.id?'primary':''}" data-click="selectManagerModel('${m.id}')">${m.id} <small>${categoryName(m.type)}</small></button>`).join('')}</div>`;
  renderManagerModel();
 }else{
  renderManagerOptionTools();renderManagerOptions();
 }
 renderManagerFooter();
}
function selectRequiredType(type){manager.requiredType=type;renderManager();$('managerContent').scrollTop=0}
function renderManagerRequired(){
 const rows=requiredRows(manager.draft,manager.requiredType);
 $('managerContent').innerHTML=rows.length?rows.map(({part:p,qty})=>`<div class="manager-part-row" data-required-row="${p.id}"><label><span>필수항목명</span><input data-admin="required" data-id="${p.id}" data-field="name" aria-label="필수항목명" value="${esc(p.name)}" placeholder="필수항목명을 입력하세요" maxlength="200"></label><label><span>P/N</span><input data-admin="required" data-id="${p.id}" data-field="pn" aria-label="P/N" value="${esc(p.pn)}" placeholder="-" maxlength="200"></label><label><span>금액 · 원</span><input type="number" min="0" max="1000000000000" step="any" data-admin="required" data-id="${p.id}" data-field="price" aria-label="금액" value="${p.price??''}" placeholder="미확정"></label><label><span>기본 수량</span><input type="number" min="1" max="10000" data-admin="required" data-id="${p.id}" data-field="qty" aria-label="기본 수량" value="${qty}"></label><button class="manager-remove" data-click="removeRequiredPart('${p.id}')" aria-label="${esc(p.name||'새 필수항목')} 제거">제거</button></div>`).join(''):'<div class="manager-empty">등록된 필수항목이 없습니다. 위의 “필수항목 추가”를 눌러 등록하세요.</div>';
}
function selectManagerModel(id){manager.model=id;renderManager();$('managerContent').scrollTop=0}
function modelCostPreview(data,m){return ['NICE','KIS'].map(van=>{const rows=m.items.filter(row=>row.van==='ALL'||row.van===van).map(row=>({...data.parts.find(p=>p.id===row.partId),qty:row.qty}));return `<div><small>${van} VAN 기준</small><b>${money(cost(rows))}</b><span>${unknown(rows).length?'미확정 '+unknown(rows).length+'건':'등록된 단가 기준'}</span></div>`}).join('')}
function renderManagerModel(){
 const data=manager.draft,m=data.models.find(x=>x.id===manager.model),requiredIds=requiredPartIds(data,m.type),used=new Set(m.items.map(row=>row.partId));
 const required=m.items.filter(row=>requiredIds.has(row.partId)).map(row=>({...row,part:data.parts.find(p=>p.id===row.partId)})).filter(row=>row.part);
 const specific=m.items.map((row,index)=>({...row,index,part:data.parts.find(p=>p.id===row.partId)})).filter(row=>row.part&&!requiredIds.has(row.partId));
 const choices=data.options.filter(o=>o.ids.some(id=>!used.has(id)&&!requiredIds.has(id)));
 $('managerContent').innerHTML=`<div class="manager-model-summary"><div class="manager-model-info"><b>${m.id} 모델</b><div class="manager-model-fields"><label>모델 이름<input data-admin="model" data-field="title" value="${esc(m.title)}" aria-label="모델 이름" maxlength="100"></label><label>구성 설명 · 비워두면 자동 표시<input data-admin="model" data-field="description" value="${esc(m.description)}" aria-label="모델 구성 설명" maxlength="300"></label></div></div><div class="manager-cost-preview" id="managerModelCosts">${modelCostPreview(data,m)}</div></div><section class="manager-readonly"><div class="manager-section-title"><div><b>${categoryName(m.type)} 필수항목</b><small>필수항목 탭에서만 수정할 수 있습니다.</small></div><span>${required.length}개</span></div><div class="manager-required-list">${required.map(row=>`<div><b>${esc(row.part.name)}</b><span>${esc(row.part.pn)} · ${row.qty}개 · ${row.part.price===null?'미확정':money(row.part.price)}</span></div>`).join('')||'<div class="manager-empty">등록된 필수항목이 없습니다.</div>'}</div></section><section class="manager-model-specific"><div class="manager-section-title"><div><b>${m.id} 추가 구성품</b><small>추가 옵션 탭에 등록된 부품을 선택하고 위·아래 버튼으로 표시 순서를 변경합니다.</small></div><span>${specific.length}개</span></div><div class="manager-add-line">${managerSelect([['','추가할 옵션 선택'],...choices.map(o=>[o.id,o.group+' / '+o.name])],'','id="modelPartPicker" aria-label="모델에 추가할 옵션"')}<button class="btn" data-click="addModelItem()">+ 모델에 추가</button></div><div class="manager-model-rows">${specific.map((row,position)=>{const source=optionForPart(row.partId,data),name=esc(row.part.name);return `<div class="manager-model-row" data-model-part="${row.part.id}"><div><b>${name}</b><small>${source?esc(source.group)+' · ':''}${esc(row.part.pn)} · ${row.part.price===null?'미확정':money(row.part.price)}</small></div><label><span>수량</span><input type="number" min="1" max="10000" data-admin="item" data-index="${row.index}" data-field="qty" value="${row.qty}" aria-label="${name} 수량"></label><label><span>VAN 조건</span>${managerSelect([['ALL','항상 포함'],['NICE','NICE VAN만'],['KIS','KIS VAN만']],row.van,`data-admin="item" data-index="${row.index}" data-field="van" aria-label="VAN 조건"`)}</label><div class="manager-order-buttons" aria-label="${name} 순서 변경"><button class="manager-move" data-click="moveModelItem(${row.index},-1)" aria-label="${name} 위로 이동" title="위로 이동" ${position===0?'disabled':''}>↑</button><button class="manager-move" data-click="moveModelItem(${row.index},1)" aria-label="${name} 아래로 이동" title="아래로 이동" ${position===specific.length-1?'disabled':''}>↓</button></div><button class="manager-remove" data-click="removeModelItem(${row.index})" aria-label="${name} 모델에서 제외">제외</button></div>`}).join('')||'<div class="manager-empty">이 모델에 추가한 구성품이 없습니다.</div>'}</div></section><details class="manager-advanced"><summary>다른 모델의 추가 구성품 복사</summary><div class="manager-add-line">${managerSelect([['','복사할 모델 선택'],...data.models.filter(x=>x.id!==m.id).map(x=>[x.id,x.id+' · '+x.title])],'','id="copyModelPicker" aria-label="구성을 복사할 모델"')}<button class="btn" data-click="copyModelItems()">구성 복사</button></div></details>`;
}
function renderManagerOptionTools(){
 const groups=optionGroups();if(!groups.includes(manager.optionGroup))manager.optionGroup=groups[0]||'추가 장비';
 $('managerTools').innerHTML=`<div><b>추가 옵션</b><small>그룹을 만든 뒤 옵션 부품을 직접 등록하세요. 등록된 옵션은 모델 구성에서 선택할 수 있고 메인 화면에도 표시됩니다.</small></div><div class="manager-new-group"><input id="newOptionGroupName" placeholder="새 그룹 이름" aria-label="새 옵션 그룹 이름" maxlength="80"><button class="btn" data-click="addOptionGroup()">+ 그룹 추가</button></div><div class="manager-group-tabs">${groups.map((group,index)=>`<button class="btn ${manager.optionGroup===group?'primary':''}" data-click="selectOptionGroup(${index})">${esc(group)} <small>${manager.draft.options.filter(o=>o.group===group).length}</small></button>`).join('')}</div><div class="manager-current-group"><input id="currentOptionGroupName" value="${esc(manager.optionGroup)}" aria-label="현재 옵션 그룹 이름" maxlength="80"><button class="btn" data-click="renameCurrentOptionGroup()">그룹명 변경</button><button class="btn primary" data-click="addCatalogOption()">+ 이 그룹에 옵션 추가</button></div>`;
}
function renderManagerOptions(){
 const groups=optionGroups(),options=manager.draft.options.filter(o=>o.group===manager.optionGroup);
 $('managerContent').innerHTML=options.length?options.map(o=>{const p=optionPart(o);return `<div class="manager-option-row" data-option-row="${o.id}"><label><span>옵션명</span><input data-admin="option" data-id="${o.id}" data-field="name" value="${esc(o.name)}" aria-label="옵션명" placeholder="옵션명을 입력하세요" maxlength="200">${o.ids.length>1?`<small>${o.ids.length}개 부품 묶음</small>`:''}</label><label><span>P/N</span><input data-admin="option" data-id="${o.id}" data-field="pn" value="${esc(p?.pn||'')}" aria-label="옵션 P/N" placeholder="-" maxlength="200"></label><label><span>금액 · 원</span><input type="number" min="0" max="1000000000000" step="any" data-admin="option" data-id="${o.id}" data-field="price" value="${p?.price??''}" aria-label="옵션 금액" placeholder="미확정"></label><label><span>그룹</span>${managerSelect(groups.map(group=>[group,group]),o.group,`data-admin="option" data-id="${o.id}" data-field="group" aria-label="옵션 그룹"`)}</label><label><span>단위</span>${managerSelect([['개','개'],['대','대'],['장','장'],['세트','세트']],o.unit,`data-admin="option" data-id="${o.id}" data-field="unit" aria-label="옵션 단위"`)}</label><label><span>기본 수량</span><input type="number" min="1" max="10000" data-admin="option" data-id="${o.id}" data-field="defaultQty" value="${o.defaultQty}" aria-label="옵션 기본 수량"></label><button class="manager-remove" data-click="removeCatalogOption('${o.id}')" aria-label="${esc(o.name||'새 옵션')} 제거">제거</button></div>`}).join(''):'<div class="manager-empty">이 그룹에 등록된 옵션이 없습니다. 위의 “이 그룹에 옵션 추가”를 눌러 직접 작성하세요.</div>';
}
function managerInput(el){
 if(manager.loading||manager.saving||!manager.draft)return;
 const {admin,id,field,index}=el.dataset,m=manager.draft.models.find(m=>m.id===manager.model);
 if(admin==='required'){
  const part=manager.draft.parts.find(p=>p.id===id);if(!part)return;
  if(field==='qty'){const value=Number(el.value);for(const model of manager.draft.models.filter(model=>model.type===manager.requiredType)){const row=model.items.find(row=>row.partId===id&&row.section==='fixed'&&row.van==='ALL');if(row)row.qty=value}}
  else part[field]=field==='price'?(el.value===''?null:Number(el.value)):el.value;
  managerDirty();return;
 }
 if(admin==='option'){
  const option=manager.draft.options.find(o=>o.id===id),part=option&&optionPart(option);if(!option)return;
  const previous=field==='pn'||field==='price'?part?.[field]:option[field];
  if(field==='name'){option.name=el.value;if(part)part.name=el.value}
  else if(field==='pn'&&part)part.pn=el.value;
  else if(field==='price'&&part)part.price=el.value===''?null:Number(el.value);
  else option[field]=field==='defaultQty'?Number(el.value):el.value;
  if(field==='group'&&previous!==option.group)manager.draft.options=optionsByGroup(manager.draft.options,optionGroups(manager.draft));
  if(previous!==(field==='pn'||field==='price'?part?.[field]:option[field]))managerDirty();
  if(field==='group'){manager.optionGroup=option.group;renderManager()}
  return;
 }
 const row=admin==='model'?m:admin==='item'?m.items[Number(index)]:null;if(!row)return;
 const previous=row[field];row[field]=field==='qty'?Number(el.value):el.value;
 if(admin==='item'){
  m.description='';const description=document.querySelector('[data-admin="model"][data-field="description"]');if(description)description.value='';
  if($('managerModelCosts'))$('managerModelCosts').innerHTML=modelCostPreview(manager.draft,m);
 }
 if(previous!==row[field])managerDirty();
}
function addRequiredPart(){
 if(!manager.loaded)return;
 const id='p_'+crypto.randomUUID().replace(/-/g,''),type=manager.requiredType;
 manager.draft.parts.push({id,category:type,name:'',pn:'',spec:'',price:null});
 for(const model of manager.draft.models.filter(m=>m.type===type))model.items.push({partId:id,qty:1,section:'fixed',van:'ALL'});
 managerDirty();renderManager();document.querySelector(`[data-required-row="${id}"] [data-field="name"]`)?.focus?.();
}
function removeRequiredPart(id){const p=manager.draft.parts.find(p=>p.id===id);if(!p)return;if(!confirm(`“${p.name||'새 필수항목'}”을 삭제할까요? ${categoryName(manager.requiredType)} 4개 모델에서 함께 제거됩니다.`))return;removeCatalogPart(id)}
function removeCatalogPart(id){
 const data=manager.draft,p=data.parts.find(p=>p.id===id);if(!p)return;
 data.parts=data.parts.filter(p=>p.id!==id);for(const m of data.models){const before=m.items.length;m.items=m.items.filter(row=>row.partId!==id);if(before!==m.items.length)m.description='';if(m.replacementBaseId===id)m.replacementBaseId=null}
 data.options=data.options.map(o=>({...o,ids:o.ids.filter(key=>key!==id)})).filter(o=>o.ids.length);syncManagerGroups(data);managerDirty();renderManager();
}
function addModelItem(){
 const option=manager.draft.options.find(o=>o.id===$('modelPartPicker').value);if(!option)return;
 const m=manager.draft.models.find(m=>m.id===manager.model),used=new Set(m.items.map(row=>row.partId));for(const id of option.ids)if(!used.has(id))m.items.push({partId:id,qty:1,section:'model',van:'ALL'});
 m.description='';managerDirty();renderManager();
}
function removeModelItem(index){const m=manager.draft.models.find(m=>m.id===manager.model);m.items.splice(index,1);m.description='';managerDirty();renderManager()}
function moveModelItem(index,direction){
 const m=manager.draft.models.find(m=>m.id===manager.model),requiredIds=requiredPartIds(manager.draft,m.type),current=m.items[index];if(!current)return;
 const fixed=m.items.filter(row=>requiredIds.has(row.partId)),specific=m.items.filter(row=>!requiredIds.has(row.partId)),position=specific.indexOf(current),target=position+direction;
 if(position<0||target<0||target>=specific.length)return;
 [specific[position],specific[target]]=[specific[target],specific[position]];m.items=[...fixed,...specific];m.description='';managerDirty();renderManager();
}
function copyModelItems(){
 const source=manager.draft.models.find(m=>m.id===$('copyModelPicker').value),target=manager.draft.models.find(m=>m.id===manager.model);if(!source)return;
 if(!confirm(`${source.id}의 추가 구성품을 ${target.id}에 복사할까요? ${target.id}의 필수항목은 유지됩니다.`))return;
 const targetRequired=requiredPartIds(manager.draft,target.type),sourceRequired=requiredPartIds(manager.draft,source.type),fixed=target.items.filter(row=>targetRequired.has(row.partId));
 const used=new Set(fixed.map(row=>row.partId)),specific=source.items.filter(row=>!sourceRequired.has(row.partId)&&!used.has(row.partId)).map(row=>structuredClone(row));
 target.items=[...fixed,...specific];target.description='';managerDirty();renderManager();
}
function selectOptionGroup(index){const group=optionGroups()[index];if(group){manager.optionGroup=group;renderManager();$('managerContent').scrollTop=0}}
function addOptionGroup(){
 const input=$('newOptionGroupName'),name=input.value.trim();if(!name){managerMessage('새 옵션 그룹 이름을 입력해주세요.',true);input.focus();return}
 if(optionGroups().includes(name)){managerMessage('이미 있는 옵션 그룹입니다.',true);return}
 manager.groups.push(name);manager.optionGroup=name;managerMessage('새 그룹에 옵션을 추가하면 저장할 수 있습니다.');renderManager();
}
function renameCurrentOptionGroup(){
 const input=$('currentOptionGroupName'),name=input.value.trim(),before=manager.optionGroup;if(!name){managerMessage('옵션 그룹 이름을 입력해주세요.',true);return}
 if(name!==before&&optionGroups().includes(name)){managerMessage('이미 있는 옵션 그룹입니다.',true);return}
 manager.groups=manager.groups.map(group=>group===before?name:group);for(const option of manager.draft.options)if(option.group===before)option.group=name;
 manager.optionGroup=name;managerDirty();renderManager();
}
function addCatalogOption(){
 if(!manager.loaded)return;
 const partId='p_'+crypto.randomUUID().replace(/-/g,''),optionId='opt_'+crypto.randomUUID().replace(/-/g,''),group=manager.optionGroup||'추가 장비';
 manager.draft.parts.push({id:partId,category:'common',name:'',pn:'',spec:'',price:null});
 manager.draft.options.push({id:optionId,name:'',ids:[partId],group,unit:'개',defaultQty:1,hint:'',replacement:false});
 managerDirty();renderManager();document.querySelector(`[data-option-row="${optionId}"] [data-field="name"]`)?.focus?.();
}
function removeCatalogOption(id){
 const data=manager.draft,option=data.options.find(o=>o.id===id);if(!option)return;
 const models=data.models.filter(m=>m.items.some(row=>option.ids.includes(row.partId)));
 if(models.length&&!confirm(`“${option.name||'새 옵션'}”은 ${models.map(m=>m.id).join(', ')} 모델에서 사용 중입니다. 옵션과 모델 구성을 함께 제거할까요?`))return;
 data.options=data.options.filter(o=>o.id!==id);for(const m of data.models){const before=m.items.length;m.items=m.items.filter(row=>!option.ids.includes(row.partId));if(before!==m.items.length)m.description=''}
 const stillUsed=new Set(data.options.flatMap(o=>o.ids));data.parts=data.parts.filter(p=>!option.ids.includes(p.id)||stillUsed.has(p.id));syncManagerGroups(data);managerDirty();renderManager();
}
