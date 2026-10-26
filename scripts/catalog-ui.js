// Embedded in index.html so the order page remains self-contained.
const DEFAULT_CATALOG=JSON.parse(document.getElementById('catalogData').textContent);
let catalog=structuredClone(DEFAULT_CATALOG);
let catalogLoadSequence=0;
let catalogLoadError='';
const manager={draft:null,revision:null,loaded:false,loading:false,saving:false,dirty:false,tab:'parts',model:'G1',search:'',category:'all',sequence:0};
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
 optDefs=data.options.map(o=>{const start=o.group!==group;group=o.group;return{...o,catalogGroup:o.group,group:start?o.group:''}});
 const allowed=new Set(optDefs.map(o=>o.id));for(const key of Object.keys(state.options))if(!allowed.has(key))delete state.options[key];
}
function replacementPartId(type=state.type,number=state.model){return type==='equipment'?null:modelInfo(type,number).replacementBaseId}
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
 manager.draft=null;manager.dirty=false;manager.loaded=false;manager.search='';$('settings').showModal();renderManager();await reloadCatalog(false);
}
function closeSettings(){
 if(manager.saving)return;
 if(manager.dirty&&!confirm('저장하지 않은 설정 변경을 닫을까요?'))return;
 manager.sequence++;manager.loading=false;$('settings').close();
}
async function reloadCatalog(ask=true){
 if(manager.saving||manager.loading)return;
 if(ask&&manager.dirty&&!confirm('편집 중인 내용을 버리고 저장된 설정을 다시 불러올까요?'))return;
 const sequence=++manager.sequence;manager.loading=true;renderManagerFooter();managerMessage('저장된 부품과 모델 구성을 불러오는 중입니다.');
 try{
  const result=await catalogRequest();if(sequence!==manager.sequence)return;
  const data=validateCatalog(result.catalog||DEFAULT_CATALOG);
  manager.draft=structuredClone(data);manager.revision=result.revision;manager.loaded=true;manager.dirty=false;
  applyCatalog(data);managerMessage('저장된 설정입니다. 수정 후 저장하면 모든 사용자에게 적용됩니다.');renderManager();
 }catch(error){if(sequence===manager.sequence){manager.loaded=false;if(!manager.draft)$('managerContent').innerHTML='<div class="manager-empty">설정을 불러오지 못했습니다. 아래 안내를 확인한 뒤 다시 불러오기를 눌러주세요.</div>';managerMessage('설정을 불러오지 못했습니다. '+error.message,true)}}
 finally{if(sequence===manager.sequence){manager.loading=false;renderManagerFooter()}}
}
async function saveCatalog(){
 if(!manager.loaded||manager.loading||manager.saving||!manager.dirty)return;
 let draft;try{draft=validateCatalog(manager.draft)}catch(error){managerMessage(error.message,true);return}
 if(!confirm(`부품 ${draft.parts.length}개, 모델 8개, 추가 옵션 ${draft.options.length}개의 설정을 저장할까요?\n메인 화면과 보고서에 함께 적용됩니다.`))return;
 manager.saving=true;renderManagerFooter();managerMessage('변경한 설정을 저장하는 중입니다.');
 try{
  const result=await catalogRequest({method:'PUT',body:JSON.stringify({schemaVersion:1,revision:manager.revision,catalog:draft})});
  manager.draft=validateCatalog(result.catalog);manager.revision=result.revision;manager.dirty=false;manager.loaded=!!result.revision;
  syncFormFields();applyCatalog(manager.draft,{replaceOrder:true});managerMessage('저장 완료 · 메인 화면과 보고서에 적용했습니다.');renderManager();toast('부품과 모델 구성을 저장했습니다.');
 }catch(error){managerMessage(error.message,true)}finally{manager.saving=false;renderManagerFooter()}
}
function switchManagerTab(tab){if(manager.loading||manager.saving)return;manager.tab=tab;manager.search='';renderManager()}
function categoryName(value){return{general:'일반형',slim:'슬림형',common:'공통·옵션'}[value]||value}
function managerSelect(values,value,attrs){return `<select ${attrs}>${values.map(([key,label])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(label)}</option>`).join('')}</select>`}
function renderManager(){
 if(!manager.draft){$('managerTools').innerHTML='';$('managerContent').innerHTML='<div class="manager-empty">저장된 설정을 연결하고 있습니다.</div>';renderManagerFooter();return}
 const data=manager.draft;
 document.querySelectorAll('[data-manager-count]').forEach(el=>{el.textContent=el.dataset.managerCount==='models'?8:data[el.dataset.managerCount].length});
 if(manager.tab==='parts'){
  $('managerTools').innerHTML=`<div><b>부품 목록</b><small>품목을 등록한 뒤 모델 구성 또는 추가 옵션에 배치하세요. 빈 P/N은 -, 빈 단가는 미확정입니다.</small></div><div class="manager-filters"><input type="search" placeholder="품목명 또는 P/N 검색" aria-label="부품 검색" data-admin="search" value="${esc(manager.search)}">${managerSelect([['all','전체 구분'],['general','일반형'],['slim','슬림형'],['common','공통·옵션']],manager.category,'data-admin="category" aria-label="부품 구분 필터"')}<button class="btn primary" data-click="addCatalogPart()">+ 부품 추가</button></div>`;
  renderManagerParts();
 }else if(manager.tab==='models'){
  $('managerTools').innerHTML=`<div><b>모델 구성</b><small>기본 포함 품목부터 VAN별 선택 품목까지 모델마다 다르게 설정할 수 있습니다.</small></div><div class="manager-model-tabs">${data.models.map(m=>`<button class="btn ${manager.model===m.id?'primary':''}" data-click="selectManagerModel('${m.id}')">${m.id} <small>${categoryName(m.type)}</small></button>`).join('')}</div>`;
  renderManagerModel();
 }else{
  const used=new Set(data.options.flatMap(o=>o.ids));
  $('managerTools').innerHTML=`<div><b>추가 옵션</b><small>여기에 등록한 품목은 메인 화면에서 수량을 선택할 수 있습니다.</small></div><div class="manager-filters">${managerSelect([['','추가할 부품 선택'],...data.parts.filter(p=>!used.has(p.id)).map(p=>[p.id,p.name])],'','id="optionPartPicker" aria-label="추가 옵션에 등록할 부품"')}<button class="btn primary" data-click="addCatalogOption()">+ 옵션 추가</button></div>`;
  renderManagerOptions();
 }
 renderManagerFooter();
}
function renderManagerParts(){
 const rows=manager.draft.parts.filter(p=>(manager.category==='all'||p.category===manager.category)&&(!manager.search||(p.name+' '+p.pn).toLowerCase().includes(manager.search.toLowerCase())));
 $('managerContent').innerHTML=rows.length?rows.map(p=>`<div class="manager-part-row" data-part-row="${p.id}"><label><span>구분</span>${managerSelect([['general','일반형'],['slim','슬림형'],['common','공통·옵션']],p.category,`data-admin="part" data-id="${p.id}" data-field="category" aria-label="구분"`)}</label><label><span>품목명</span><input data-admin="part" data-id="${p.id}" data-field="name" aria-label="품목명" value="${esc(p.name)}" placeholder="품목명을 입력하세요" maxlength="200"></label><label><span>P/N</span><input data-admin="part" data-id="${p.id}" data-field="pn" aria-label="P/N" value="${esc(p.pn)}" placeholder="-" maxlength="200"></label><label><span>단가 · 원</span><input type="number" min="0" max="1000000000000" step="any" data-admin="part" data-id="${p.id}" data-field="price" aria-label="단가" value="${p.price??''}" placeholder="미확정"></label><button class="manager-remove" data-click="removeCatalogPart('${p.id}')" aria-label="${esc(p.name||'새 부품')} 제거">제거</button></div>`).join(''):'<div class="manager-empty">표시할 부품이 없습니다. 검색 조건을 바꾸거나 새 부품을 추가하세요.</div>';
}
function selectManagerModel(id){manager.model=id;renderManager()}
function renderManagerModel(){
 const data=manager.draft,m=data.models.find(x=>x.id===manager.model),used=new Set(m.items.map(row=>row.partId));
 const totals=['NICE','KIS'].map(van=>{const rows=m.items.filter(row=>row.van==='ALL'||row.van===van).map(row=>({...data.parts.find(p=>p.id===row.partId),qty:row.qty}));return `<div><small>${van} VAN 기준</small><b>${money(cost(rows))}</b><span>${unknown(rows).length?'미확정 '+unknown(rows).length+'건':'등록된 단가 기준'}</span></div>`}).join('');
 $('managerContent').innerHTML=`<div class="manager-model-summary"><div><b>${m.id} 모델</b><label>모델 이름<input data-admin="model" data-field="title" value="${esc(m.title)}" aria-label="모델 이름" maxlength="100"></label><label>구성 설명 · 비워두면 자동 표시<input data-admin="model" data-field="description" value="${esc(m.description)}" aria-label="모델 구성 설명" maxlength="300"></label></div><div class="manager-cost-preview" id="managerModelCosts">${totals}</div></div><div class="manager-add-line">${managerSelect([['','추가할 부품 선택'],...data.parts.filter(p=>!used.has(p.id)).map(p=>[p.id,categoryName(p.category)+' / '+p.name])],'','id="modelPartPicker" aria-label="모델에 추가할 부품"')}<button class="btn" data-click="addModelItem()">+ 모델에 추가</button></div><div class="manager-model-rows">${m.items.map((row,index)=>{const p=data.parts.find(p=>p.id===row.partId);return `<div class="manager-model-row" data-model-part="${p.id}"><div><b>${esc(p.name)}</b><small>${esc(p.pn)} · ${p.price===null?'미확정':money(p.price)}</small></div><label><span>수량</span><input type="number" min="1" max="10000" data-admin="item" data-index="${index}" data-field="qty" value="${row.qty}" aria-label="${esc(p.name)} 기본 수량"></label><label><span>구성 구분</span>${managerSelect([['fixed','고정 품목'],['model','모델 추가 품목'],['mount','장착 부속']],row.section,`data-admin="item" data-index="${index}" data-field="section" aria-label="구성 구분"`)}</label><label><span>VAN 조건</span>${managerSelect([['ALL','항상 포함'],['NICE','NICE VAN만'],['KIS','KIS VAN만']],row.van,`data-admin="item" data-index="${index}" data-field="van" aria-label="VAN 조건"`)}</label><button class="manager-remove" data-click="removeModelItem(${index})" aria-label="${esc(p.name)} 모델에서 제외">제외</button></div>`}).join('')||'<div class="manager-empty">모델에 포함할 부품을 추가하세요.</div>'}</div><details class="manager-advanced"><summary>구성 복사 · 여권인식기 교체 기준</summary><div class="manager-add-line">${managerSelect([['','복사할 모델 선택'],...data.models.filter(x=>x.id!==m.id).map(x=>[x.id,x.id+' · '+x.title])],'','id="copyModelPicker" aria-label="구성을 복사할 모델"')}<button class="btn" data-click="copyModelItems()">구성 복사</button></div><label>여권인식기 교체 옵션에서 차감할 기본 부품${managerSelect([['','차감할 부품 없음'],...m.items.filter(row=>row.van==='ALL').map(row=>[row.partId,data.parts.find(p=>p.id===row.partId).name])],m.replacementBaseId||'','data-admin="model" data-field="replacementBaseId" aria-label="여권인식기 교체 차감 기준"')}</label></details>`;
}
function renderManagerOptions(){
 $('managerContent').innerHTML=manager.draft.options.map(o=>`<div class="manager-option-row" data-option-row="${o.id}"><label><span>옵션 이름</span><input data-admin="option" data-id="${o.id}" data-field="name" value="${esc(o.name)}" aria-label="옵션 이름" maxlength="200"><small>${o.ids.map(id=>esc(manager.draft.parts.find(p=>p.id===id).name)).join(' · ')}</small></label><label><span>그룹</span><input data-admin="option" data-id="${o.id}" data-field="group" value="${esc(o.group)}" aria-label="옵션 그룹" list="optionGroups" maxlength="80"></label><label><span>단위</span>${managerSelect([['개','개'],['대','대'],['장','장'],['세트','세트']],o.unit,`data-admin="option" data-id="${o.id}" data-field="unit" aria-label="옵션 단위"`)}</label><label class="manager-checkbox"><input type="checkbox" data-admin="option" data-id="${o.id}" data-field="replacement" ${o.replacement?'checked':''}>기본 여권인식기 교체</label><button class="manager-remove" data-click="removeCatalogOption('${o.id}')" aria-label="${esc(o.name)} 옵션에서 제외">제외</button></div>`).join('')||'<div class="manager-empty">등록된 추가 옵션이 없습니다. 위에서 부품을 선택해 추가하세요.</div>';
}
function managerInput(el){
 if(manager.loading||manager.saving||!manager.draft)return;
 const {admin,id,field,index}=el.dataset;
 if(admin==='search'){manager.search=el.value;renderManagerParts();return}
 if(admin==='category'){manager.category=el.value;renderManagerParts();return}
 const m=manager.draft.models.find(m=>m.id===manager.model);
 const row=admin==='part'?manager.draft.parts.find(p=>p.id===id):admin==='model'?m:admin==='item'?m.items[Number(index)]:manager.draft.options.find(o=>o.id===id);
 if(!row)return;
 const previous=row[field];row[field]=el.type==='checkbox'?el.checked:field==='price'?(el.value===''?null:Number(el.value)):['qty','defaultQty'].includes(field)?Number(el.value):field==='replacementBaseId'?(el.value||null):el.value;
 if(admin==='part'&&field==='name')for(const option of manager.draft.options)if(option.ids.length===1&&option.ids[0]===id)option.name=row.name;
 if(admin==='item'){
  m.description='';if(field==='van'&&row.partId===m.replacementBaseId&&row.van!=='ALL')m.replacementBaseId=null;
  const description=document.querySelector('[data-admin="model"][data-field="description"]');if(description)description.value='';
  if($('managerModelCosts'))$('managerModelCosts').innerHTML=['NICE','KIS'].map(van=>{const list=m.items.filter(r=>r.van==='ALL'||r.van===van).map(r=>({...manager.draft.parts.find(p=>p.id===r.partId),qty:r.qty}));return `<div><small>${van} VAN 기준</small><b>${money(cost(list))}</b><span>${unknown(list).length?'미확정 '+unknown(list).length+'건':'등록된 단가 기준'}</span></div>`}).join('');
 }
 if(previous!==row[field])managerDirty();
}
function addCatalogPart(){
 if(!manager.loaded)return;
 const id='p_'+crypto.randomUUID().replace(/-/g,'');manager.draft.parts.push({id,category:'common',name:'',pn:'',spec:'',price:null});manager.search='';manager.category='all';managerDirty();renderManager();document.querySelector(`[data-part-row="${id}"] [data-field="name"]`)?.focus();
}
function removeCatalogPart(id){
 const data=manager.draft,p=data.parts.find(p=>p.id===id),models=data.models.filter(m=>m.items.some(row=>row.partId===id)),options=data.options.filter(o=>o.ids.includes(id));
 if((models.length||options.length)&&!confirm(`“${p.name}” 품목은 ${models.length}개 모델과 ${options.length}개 옵션에서 사용 중입니다.\n제거하면 해당 구성에서도 제외됩니다. 저장할 때 적용됩니다.`))return;
 data.parts=data.parts.filter(p=>p.id!==id);for(const m of data.models){m.items=m.items.filter(row=>row.partId!==id);if(m.replacementBaseId===id)m.replacementBaseId=null;if(models.includes(m))m.description=''}
 data.options=data.options.map(o=>({...o,ids:o.ids.filter(key=>key!==id)})).filter(o=>o.ids.length);managerDirty();renderManager();
}
function addModelItem(){
 const id=$('modelPartPicker').value;if(!id)return;
 const m=manager.draft.models.find(m=>m.id===manager.model);if(m.items.some(row=>row.partId===id))return;
 m.items.push({partId:id,qty:1,section:'model',van:'ALL'});m.description='';managerDirty();renderManager();
}
function removeModelItem(index){const m=manager.draft.models.find(m=>m.id===manager.model),[removed]=m.items.splice(index,1);if(removed?.partId===m.replacementBaseId)m.replacementBaseId=null;m.description='';managerDirty();renderManager()}
function copyModelItems(){
 const source=manager.draft.models.find(m=>m.id===$('copyModelPicker').value),target=manager.draft.models.find(m=>m.id===manager.model);if(!source)return;
 if(!confirm(`${source.id} 구성을 ${target.id}에 복사할까요? ${target.id}의 현재 구성은 교체됩니다.`))return;
 for(const key of ['items','replacementBaseId','title','description'])target[key]=structuredClone(source[key]);managerDirty();renderManager();
}
function addCatalogOption(){
 const id=$('optionPartPicker').value,p=manager.draft.parts.find(p=>p.id===id);if(!p)return;
 manager.draft.options.push({id:'opt_'+crypto.randomUUID().replace(/-/g,''),name:p.name,ids:[id],group:'추가 장비',unit:'개',defaultQty:1,hint:'',replacement:false});managerDirty();renderManager();
}
function removeCatalogOption(id){manager.draft.options=manager.draft.options.filter(o=>o.id!==id);managerDirty();renderManager()}
