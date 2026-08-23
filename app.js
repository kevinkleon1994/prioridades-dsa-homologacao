(() => {
"use strict";

const $=id=>document.getElementById(id);
const qsa=(sel,root=document)=>[...root.querySelectorAll(sel)];
const AREAS={"Identidade":"#ff0046","Liderança":"#00bddd","Novas Gerações":"#ffb800","Discipulado":"#00c97b"};
const AREA_ICONS={"Identidade":"assets/icone_identidade.png","Liderança":"assets/icone_lideranca.png","Novas Gerações":"assets/icone_novasgeracoes.png","Discipulado":"assets/icone_discipulado.png"};
const MONTHS=[["1","Janeiro"],["2","Fevereiro"],["3","Março"],["4","Abril"],["5","Maio"],["6","Junho"],["7","Julho"],["8","Agosto"],["9","Setembro"],["10","Outubro"],["11","Novembro"],["12","Dezembro"]];
const MODULE_TO_VIEW={dashboard:"dashboard",prioridades:"priorities",planner:"planner",linha_tempo:"timeline",relatorios:"reports",requisitos:"requirements",minha_igreja:"myChurch",desenvolvedor:"admin"};
const VIEW_TITLES={dashboard:"Dashboard Executivo",priorities:"Prioridades Estratégicas",planner:"Planner",timeline:"Linha do tempo",reports:"Relatórios",requirements:"Requisitos",myChurch:"Minha Igreja",admin:"Opções do Desenvolvedor"};

let state={
  token:sessionStorage.getItem("prioridades_token")||localStorage.getItem("prioridades_token")||"",
  user:null,modules:[],scope:{polos:[],distritos:[],igrejas:[],filtros:{}},
  context:{polo_id:"",distrito_id:"",igreja_id:"",data_inicio:"",data_fim:""},
  dashboard:null,requirements:[],results:[],planner:[],reports:[],difficulties:[],
  fofaItems:[],fofaEvaluations:[],fofaHistory:[],fofaCurrent:null,fofaAxis:"Identidade",fofaSmart:null,fofaCatalog:{},fofaCompletion:null,
  churchProfile:null,departments:[],churchFormDirty:false,users:[],developer:null,
  currentPriority:"Identidade",selectedRequirementId:"",currentAiReport:"",currentReport:null,editingReportId:""
};


/* =========================================================
   v2.2.3 — SALVAMENTO ASSÍNCRONO ESTÁVEL
   - rascunho por requisito / item FOFA
   - salvamento em segundo plano
   - resposta anterior nunca redesenha/apaga o formulário atual
   ========================================================= */

const criterionDrafts=new Map();
const criterionSaveTimers=new Map();
const criterionPendingSaves=new Map();
const criterionSaveStatus=new Map();

const fofaDrafts=new Map();
const fofaSaveTimers=new Map();
const fofaPendingSaves=new Map();
const fofaSaveStatus=new Map();

function sessionMapRead(name){
  try{
    const raw=sessionStorage.getItem(name);
    const obj=raw?JSON.parse(raw):{};
    return obj&&typeof obj==="object"?obj:{};
  }catch(_e){return {}}
}
function sessionMapWrite(name,map){
  try{
    const obj={};
    map.forEach((v,k)=>obj[k]=v);
    sessionStorage.setItem(name,JSON.stringify(obj));
  }catch(_e){}
}
function hydrateDraftMaps(){
  Object.entries(sessionMapRead("prioridades_criterion_drafts")).forEach(([k,v])=>criterionDrafts.set(k,v));
  Object.entries(sessionMapRead("prioridades_fofa_drafts")).forEach(([k,v])=>fofaDrafts.set(k,v));
}
hydrateDraftMaps();

function criterionDraftKey(reqId=state.selectedRequirementId){
  const year=String(state.context?.data_inicio||$("yearSingle")?.value||"").slice(0,4);
  return [selectedChurchId()||"",reqId||"",year||""].join("|");
}
function fofaDraftKey(itemId){
  return [state.fofaCurrent?.evaluation?.avaliacao_id||"",itemId||""].join("|");
}
function criterionFieldValues(){
  return {
    alcancado:$("reachedInputV51")?.value||"",
    plano_acao:$("actionPlanV51")?.value||"",
    responsavel:$("responsibleInputV51")?.value||"",
    data_inicial:$("dateInputV51")?.value||"",
    data_final:$("dateEndInputV222")?.value||"",
    voto:$("voteInputV51")?.value||"",
    material:$("materialInputV51")?.value||""
  };
}
function writeCriterionDraft(){
  if(!state.selectedRequirementId||!selectedChurchId())return null;
  const key=criterionDraftKey();
  const previous=criterionDrafts.get(key)||{};
  const draft={
    key,
    requisito_id:state.selectedRequirementId,
    igreja_id:selectedChurchId(),
    revision:Number(previous.revision||0)+1,
    updatedAt:Date.now(),
    values:criterionFieldValues()
  };
  criterionDrafts.set(key,draft);
  criterionSaveStatus.set(key,"dirty");
  sessionMapWrite("prioridades_criterion_drafts",criterionDrafts);
  return draft;
}
function criterionDraftFor(reqId){
  return criterionDrafts.get(criterionDraftKey(reqId))||null;
}
function clearCriterionDraftIfRevision(key,revision){
  const current=criterionDrafts.get(key);
  if(current&&Number(current.revision||0)===Number(revision||0)){
    criterionDrafts.delete(key);
    sessionMapWrite("prioridades_criterion_drafts",criterionDrafts);
  }
}
function rememberCriterionDraft(){
  // v2.2.4: preencher NÃO grava na planilha.
  // Apenas preserva localmente o formulário até o usuário clicar em Salvar.
  const draft=writeCriterionDraft();
  if(draft)criterionButtonState();
  return draft;
}
function criterionButtonState(){
  const btn=$("saveCriterionV51");
  if(!btn||!state.selectedRequirementId)return;
  const key=criterionDraftKey();
  const status=criterionSaveStatus.get(key)||"idle";

  btn.disabled=false;
  if(status==="saving")btn.textContent="✓ Salvo";
  else if(status==="verified")btn.textContent="✓ Salvo";
  else if(status==="error")btn.textContent="⚠ Salvar novamente";
  else btn.textContent="Salvar";
}

function updatePriorityVisualsOnly(){
  const rows=state.requirements.filter(r=>r.prioridade===state.currentPriority);
  const totals=rows.reduce((a,r)=>{
    const g=effectiveGoal(r),v=reachedFor(r.requisito_id);
    a.g+=g;a.v+=v;return a;
  },{g:0,v:0});
  const pp=pct(totals.v,totals.g);

  if($("priorityPercentV7"))$("priorityPercentV7").textContent=Math.round(pp)+"%";
  if($("priorityProgressV7"))$("priorityProgressV7").style.width=pp+"%";
  if($("priorityGoalV7"))$("priorityGoalV7").textContent=fmt(totals.g);
  if($("priorityReachedV7"))$("priorityReachedV7").textContent=fmt(totals.v);
  if($("priorityCountV7"))$("priorityCountV7").textContent=rows.length;

  const status=$("criteriaStatusFilter")?.value||"Todos";
  const visible=rows.filter(r=>{
    const p=pct(reachedFor(r.requisito_id),effectiveGoal(r));
    const s=p>=100?"Concluído":p>=60?"Em andamento":"Atenção";
    return status==="Todos"||s===status;
  });

  if($("criteriaListV51")){
    $("criteriaListV51").innerHTML=visible.map((r,i)=>{
      const p=pct(reachedFor(r.requisito_id),effectiveGoal(r));
      const s=p>=100?"Concluído":p>=60?"Em andamento":"Atenção";
      return `<button class="criterion-v51 ${state.selectedRequirementId===r.requisito_id?"active":""}" data-id="${r.requisito_id}">
        <b>${String(i+1).padStart(2,"0")}</b>
        <span><strong>${esc(r.titulo)}</strong><small>${s}</small></span>
        <em>${Math.round(p)}%</em>
      </button>`;
    }).join("");

    qsa(".criterion-v51").forEach(b=>b.onclick=()=>{
      state.selectedRequirementId=b.dataset.id;
      renderCriterion();
    });
  }
}

function comparableText_(v){return String(v??"").trim()}
function comparableNumber_(v){return Number(v||0)}
function resultMatchesPayload_(row,payload){
  if(!row)return false;
  return comparableNumber_(row.alcancado)===comparableNumber_(payload.alcancado) &&
    comparableText_(row.plano_acao)===comparableText_(payload.plano_acao) &&
    comparableText_(row.responsavel)===comparableText_(payload.responsavel) &&
    comparableText_(row.data_inicial).slice(0,10)===comparableText_(payload.data_inicial).slice(0,10) &&
    comparableText_(row.data_final).slice(0,10)===comparableText_(payload.data_final).slice(0,10) &&
    comparableText_(row.voto)===comparableText_(payload.voto) &&
    comparableText_(row.material)===comparableText_(payload.material);
}

async function verifyCriterionSavedInBackground(payload,key,revision){
  try{
    const rs=await api("list_results",currentRequest(),{noRetry:false});
    const year=String(payload.data_realizacao||"").slice(0,4);
    const row=(rs.data||[]).find(x=>
      String(x.igreja_id||"")===String(payload.igreja_id||"") &&
      String(x.requisito_id||"")===String(payload.requisito_id||"") &&
      String(x.data_realizacao||"").slice(0,4)===year
    );

    if(!resultMatchesPayload_(row,payload)){
      criterionSaveStatus.set(key,"error");
      if(criterionDraftKey()===key)criterionButtonState();
      setSyncState("Divergência de sincronização","error");
      console.error("Validação pós-gravação divergente.",{payload,row});
      return false;
    }

    patchLocalResult(row,row.resultado_id||"");
    criterionSaveStatus.set(key,"verified");
    clearCriterionDraftIfRevision(key,revision);
    if(criterionDraftKey()===key)criterionButtonState();
    setSyncState("Conectado","ok");

    cacheSet("priorities",{requirements:state.requirements,results:state.results});
    return true;
  }catch(e){
    // A gravação já pode ter ocorrido; preserva o draft para nova validação/tentativa.
    criterionSaveStatus.set(key,"error");
    if(criterionDraftKey()===key)criterionButtonState();
    setSyncState("Verificação pendente","error");
    console.warn("Não foi possível validar a gravação do requisito:",e);
    return false;
  }
}

function fofaPayloadMatches_(row,payload){
  if(!row)return false;
  return comparableNumber_(row.nota)===comparableNumber_(payload.nota) &&
    comparableText_(row.evidencia)===comparableText_(payload.evidencia) &&
    comparableNumber_(row.impacto)===comparableNumber_(payload.impacto) &&
    comparableNumber_(row.urgencia)===comparableNumber_(payload.urgencia) &&
    comparableNumber_(row.governabilidade)===comparableNumber_(payload.governabilidade) &&
    comparableNumber_(row.alinhamento)===comparableNumber_(payload.alinhamento);
}

async function verifyFofaSavedInBackground(itemId,payload,key,revision){
  try{
    const r=await api("get_fofa_evaluation",{avaliacao_id:payload.avaliacao_id});
    const detail=r.data||r;
    const row=(detail.responses||[]).find(x=>String(x.fofa_item_id||"")===String(itemId));

    if(!fofaPayloadMatches_(row,payload)){
      fofaSaveStatus.set(key,"error");
      updateFofaButtonState(itemId);
      setSyncState("Divergência de sincronização","error");
      console.error("Validação FOFA divergente.",{payload,row});
      return false;
    }

    patchLocalFofaResponse(itemId,payload,row||{});
    fofaSaveStatus.set(key,"verified");
    clearFofaDraftIfRevision(key,revision);
    updateFofaButtonState(itemId);

    state.fofaCurrent={
      ...state.fofaCurrent,
      ...detail,
      responses:detail.responses||state.fofaCurrent?.responses||[]
    };
    state.fofaCompletion=detail.completion||state.fofaCompletion;
    setSyncState("Conectado","ok");
    return true;
  }catch(e){
    fofaSaveStatus.set(key,"error");
    updateFofaButtonState(itemId);
    setSyncState("Verificação pendente","error");
    console.warn("Não foi possível validar a gravação FOFA:",e);
    return false;
  }
}

function patchLocalResult(payload,resultId=""){
  const targetYear=String(payload.data_realizacao||"").slice(0,4);
  const idx=state.results.findIndex(x=>
    String(x.igreja_id)===String(payload.igreja_id)&&
    String(x.requisito_id)===String(payload.requisito_id)&&
    String(x.data_realizacao||"").slice(0,4)===targetYear
  );
  const patch={
    ...payload,
    atualizado_em:new Date().toISOString()
  };
  if(idx>=0)state.results[idx]={...state.results[idx],...patch,resultado_id:resultId||state.results[idx].resultado_id};
  else state.results.push({resultado_id:resultId||("LOCAL-"+Date.now()),...patch});
}
async function syncPrioritiesDerivedBackground(){
  try{
    const [rq,rs]=await Promise.all([
      api("list_requirements",currentRequest()),
      api("list_results",currentRequest())
    ]);
    state.requirements=rq.data||state.requirements;
    state.results=rs.data||state.results;
    cacheSet("priorities",{requirements:state.requirements,results:state.results});
    if(!document.querySelector("#prioritiesView.active")){
      // Não redesenha o formulário enquanto o usuário edita Prioridades.
    }
  }catch(e){console.warn("Sincronização silenciosa de prioridades:",e)}
  try{
    const d=await api("dashboard",currentRequest());
    cacheSet("dashboard",d);
    localCacheWrite("dashboard",d);
    if(document.querySelector("#dashboardView.active")){
      state.dashboard=d;
      state.context={...state.context,...d.context};
      renderDashboard(d);renderContext();
    }
  }catch(e){console.warn("Sincronização silenciosa do Dashboard:",e)}
}
function fofaCaptureCard(itemId){
  const card=document.querySelector(`[data-fofa-item="${CSS.escape(itemId)}"]`);
  if(!card)return null;
  const val=name=>card.querySelector(`[data-fofa-field="${name}"]`)?.value||"";
  const key=fofaDraftKey(itemId);
  const previous=fofaDrafts.get(key)||{};
  const draft={
    key,itemId,
    revision:Number(previous.revision||0)+1,
    updatedAt:Date.now(),
    values:{
      nota:val("nota"),evidencia:val("evidencia"),
      impacto:val("impacto"),urgencia:val("urgencia"),
      governabilidade:val("governabilidade"),alinhamento:val("alinhamento")
    }
  };
  fofaDrafts.set(key,draft);
  fofaSaveStatus.set(key,"dirty");
  sessionMapWrite("prioridades_fofa_drafts",fofaDrafts);
  return draft;
}
function fofaDraftFor(itemId){return fofaDrafts.get(fofaDraftKey(itemId))||null}
function rememberFofaDraft(itemId){
  // v2.2.4: edição de campos FOFA fica apenas no front/sessionStorage
  // até o botão Salvar do próprio fator ser acionado.
  const draft=fofaCaptureCard(itemId);
  if(draft)updateFofaButtonState(itemId);
  return draft;
}
function clearFofaDraftIfRevision(key,revision){
  const current=fofaDrafts.get(key);
  if(current&&Number(current.revision||0)===Number(revision||0)){
    fofaDrafts.delete(key);
    sessionMapWrite("prioridades_fofa_drafts",fofaDrafts);
  }
}
function updateFofaButtonState(itemId){
  const card=document.querySelector(`[data-fofa-item="${CSS.escape(itemId)}"]`);
  const btn=card?.querySelector("[data-save-fofa]");
  if(!btn)return;
  const status=fofaSaveStatus.get(fofaDraftKey(itemId))||"idle";

  btn.disabled=false;
  btn.textContent=
    status==="saving"?"✓ Salvo":
    status==="verified"?"✓ Salvo":
    status==="error"?"⚠ Salvar novamente":
    "Salvar";
}
function patchLocalFofaResponse(itemId,payload,response={}){
  if(!state.fofaCurrent)return;
  const list=state.fofaCurrent.responses||(state.fofaCurrent.responses=[]);
  const idx=list.findIndex(x=>String(x.fofa_item_id||"")===String(itemId));
  const item=(state.fofaItems||[]).find(x=>String(x.fofa_item_id||"")===String(itemId))||{};
  const patch={
    ...(idx>=0?list[idx]:{}),
    ...payload,
    ...response,
    fofa_item_id:itemId,
    eixo:item.eixo||response.eixo||"",
    tipo_fofa:item.tipo_fofa||response.tipo_fofa||"",
    fator:item.fator||response.fator||""
  };
  if(idx>=0)list[idx]=patch;else list.push(patch);
}
async function refreshFofaMetadataBackground(){
  const id=state.fofaCurrent?.evaluation?.avaliacao_id;
  if(!id)return;
  try{
    const r=await api("get_fofa_evaluation",{avaliacao_id:id});
    const detail=r.data||r;
    if(detail?.evaluation){
      state.fofaCurrent={
        ...state.fofaCurrent,
        ...detail,
        responses:detail.responses||state.fofaCurrent.responses||[]
      };
      state.fofaCompletion=detail.completion||state.fofaCompletion;
      // Deliberadamente sem renderFofa(): não pode apagar campos em edição.
    }
  }catch(e){console.warn("Atualização silenciosa FOFA:",e)}
}
async function flushFofaDrafts(){
  // v2.2.4: conclusão NÃO transforma rascunhos não salvos em gravação automática.
  const dirty=[...fofaDrafts.entries()]
    .filter(([key])=>(fofaSaveStatus.get(key)||"dirty")==="dirty");

  if(dirty.length){
    throw new Error(
      `Há ${dirty.length} item(ns) FOFA preenchido(s) ainda não salvo(s). `+
      `Clique em Salvar nos respectivos itens antes de concluir a avaliação.`
    );
  }

  await Promise.allSettled([...fofaPendingSaves.values()]);
}
function setAiPriorityProgress(step,title,text){
  qsa("#aiReportLoading [data-ai-step]").forEach(el=>{
    const n=Number(el.dataset.aiStep||0);
    el.classList.toggle("done",n<step);
    el.classList.toggle("active",n===step);
    el.classList.toggle("pending",n>step);
  });
  if($("aiProgressTitleV223"))$("aiProgressTitleV223").textContent=title||"";
  if($("aiProgressTextV223"))$("aiProgressTextV223").textContent=text||"";
}
function finishAiPriorityProgress(){
  qsa("#aiReportLoading [data-ai-step]").forEach(el=>{
    el.classList.add("done");el.classList.remove("active","pending");
  });
}
async function refreshCurrentModule(){
  const active=document.querySelector(".view.active")?.id?.replace(/View$/,"")||"dashboard";
  const btn=$("moduleRefreshButton");
  if(btn){btn.disabled=true;btn.classList.add("spinning-v223")}
  setSyncState("Atualizando","sync");
  try{
    if(active==="dashboard")await loadDashboard({background:true});
    else if(active==="priorities")await loadPriorities({background:true});
    else if(active==="planner")await loadPlanner({background:true});
    else if(active==="timeline")await loadTimeline({background:true});
    else if(active==="reports")await loadReports({background:true});
    else if(active==="requirements")await loadRequirements({background:true});
    else if(active==="myChurch")await loadMyChurch({background:true});
    else if(active==="admin")await loadDeveloper({background:true});
    setSyncState("Conectado","ok");
  }catch(e){
    setSyncState("Erro de sincronização","error");
    toast(e.message||"Não foi possível atualizar o módulo.");
  }finally{
    if(btn){btn.disabled=false;btn.classList.remove("spinning-v223")}
  }
}



/* v2.2.5 — Performance Enterprise / Navegação Instantânea */
const ENTERPRISE_CACHE_V225={stale:60*60*1000,prefix:"prioridades_v225_"};
function contextSignatureV225(){const r=currentRequest();return [state.user?.usuario_id,r.polo_id,r.distrito_id,r.igreja_id,r.periodo,r.ano,r.mes,r.ano_inicio,r.ano_fim,r.data_inicio,r.data_fim].map(x=>String(x||"")).join("|")}
function enterpriseKeyV225(name){return ENTERPRISE_CACHE_V225.prefix+name+"::"+contextSignatureV225()}
function enterpriseReadV225(name){try{const raw=localStorage.getItem(enterpriseKeyV225(name));if(!raw)return null;const o=JSON.parse(raw);if(!o?.savedAt||Date.now()-o.savedAt>ENTERPRISE_CACHE_V225.stale)return null;return o}catch(_e){return null}}
function enterpriseWriteV225(name,data){try{localStorage.setItem(enterpriseKeyV225(name),JSON.stringify({savedAt:Date.now(),data}))}catch(_e){}}
function stableStringifyV225(v){try{return JSON.stringify(v)}catch(_e){return String(Date.now())}}
function changedV225(a,b){return stableStringifyV225(a)!==stableStringifyV225(b)}
function startBackgroundV225(p){Promise.resolve(p).catch(e=>console.warn("Background v2.2.5:",e))}
function viewIsActiveV225(name){return !!document.querySelector(`#${name}View.active`)}
function renderCachedModuleV225(name,s){
  if(!s?.data)return false;const d=s.data;
  if(name==="dashboard"){state.dashboard=d;state.context={...state.context,...(d.context||{})};renderDashboard(d);renderContext();return true}
  if(name==="priorities"){state.requirements=d.requirements||[];state.results=d.results||[];renderPriorities();return true}
  if(name==="planner"){state.planner=d.tasks||[];renderPlanner();return true}
  if(name==="timeline"){state.timeline=d.timeline||[];renderTimeline();return true}
  if(name==="requirements"){state.requirements=d.requirements||[];state.goals=d.goals||[];renderRequirements();return true}
  if(name==="myChurch"){state.churchProfile=d.profile||{};state.departments=d.departments||[];state.churchDepartments=d.churchDepartments||[];renderMyChurch();return true}
  if(name==="reports"){state.reports=d.reports||[];state.difficulties=d.difficulties||[];renderReports();return true}
  if(name==="developer"){state.users=d.users||[];renderUsers();return true}
  return false;
}
const PERF={ttl:{bootstrap:300000,dashboard:60000,priorities:300000,planner:45000,timeline:45000,reports:60000,requirements:300000,myChurch:120000,developer:120000},memory:new Map(),inflight:new Map()};
function cacheContextKey(){return JSON.stringify(currentRequest())}
function cacheKey(name,extra=""){return `${name}|${extra||cacheContextKey()}`}
function cacheGet(name,extra=""){const k=cacheKey(name,extra),i=PERF.memory.get(k);if(!i)return null;const ttl=PERF.ttl[name]||60000;if(Date.now()-i.savedAt>ttl){PERF.memory.delete(k);return null}return i.data}
function cacheSet(name,data,extra=""){PERF.memory.set(cacheKey(name,extra),{savedAt:Date.now(),data});return data}
function cacheInvalidate(names=null){if(!names){PERF.memory.clear();return}const list=Array.isArray(names)?names:[names];[...PERF.memory.keys()].forEach(k=>{if(list.some(n=>k.startsWith(n+"|")))PERF.memory.delete(k)})}
function localCacheRead(name){try{const raw=localStorage.getItem(`prioridades_cache_${name}`);if(!raw)return null;const o=JSON.parse(raw),ttl=PERF.ttl[name]||60000;return o&&Date.now()-Number(o.savedAt||0)<=ttl?o.data:null}catch(_e){return null}}
function localCacheWrite(name,data){try{localStorage.setItem(`prioridades_cache_${name}`,JSON.stringify({savedAt:Date.now(),data}))}catch(_e){}}

function authSnapshotRead(){
  try{
    const raw=sessionStorage.getItem("prioridades_auth_snapshot");
    return raw?JSON.parse(raw):null;
  }catch(_e){return null}
}
function authSnapshotWrite(){
  try{
    sessionStorage.setItem("prioridades_auth_snapshot",JSON.stringify({
      user:state.user||null,
      modules:state.modules||[],
      scope:state.scope||null,
      savedAt:Date.now()
    }));
  }catch(_e){}
}
function persistSessionToken(token){
  state.token=String(token||"");
  if(state.token)sessionStorage.setItem("prioridades_token",state.token);
  else sessionStorage.removeItem("prioridades_token");
  // Remove token persistente legado: F5 continua na sessão, fechar a aba encerra o acesso local.
  localStorage.removeItem("prioridades_token");
}
function uiStateWrite(){
  try{
    const active=document.querySelector(".view.active")?.id||"dashboardView";
    sessionStorage.setItem("prioridades_ui_state",JSON.stringify({
      usuario_id:String(state.user?.usuario_id||""),
      view:active.replace(/View$/,""),
      priority:state.currentPriority||"Identidade",
      periodMode:$("periodMode")?.value||"ano",
      yearSingle:$("yearSingle")?.value||"",
      monthSingle:$("monthSingle")?.value||"",
      yearStart:$("yearStart")?.value||"",
      yearEnd:$("yearEnd")?.value||"",
      monthStart:$("monthStart")?.value||"",
      monthEnd:$("monthEnd")?.value||"",
      dateStart:$("dateStart")?.value||"",
      dateEnd:$("dateEnd")?.value||"",
      pole:$("poleFilter")?.value||"",
      district:$("districtFilter")?.value||"",
      church:$("churchFilter")?.value||""
    }));
  }catch(_e){}
}
function uiStateRead(){
  try{
    const raw=sessionStorage.getItem("prioridades_ui_state");
    return raw?JSON.parse(raw):null;
  }catch(_e){return null}
}

function clearFreshLoginUiState(){
  sessionStorage.removeItem("prioridades_ui_state");
  sessionStorage.removeItem("prioridades_criterion_drafts");
  sessionStorage.removeItem("prioridades_fofa_drafts");
  criterionDrafts.clear();
  fofaDrafts.clear();

  // Evita mostrar, mesmo por instantes, Dashboard/contexto de outro acesso.
  localStorage.removeItem("prioridades_cache_dashboard");
  localStorage.removeItem("prioridades_dashboard");
  cacheInvalidate(["dashboard","priorities","planner","timeline","reports","requirements","myChurch","developer"]);
}

function resetTerritoryFiltersForFreshLogin(){
  const f=state.scope?.filtros||{};

  if($("poleFilter") && f.permitir_todos_polos){
    $("poleFilter").value="";
  }
  fillDistricts();

  if($("districtFilter") && f.permitir_todos_distritos){
    $("districtFilter").value="";
  }
  fillChurches();

  if($("churchFilter") && f.permitir_todas_igrejas && !f.igreja_fixa){
    $("churchFilter").value="";
  }
}

function restoreUiControls(){
  const s=uiStateRead();
  if(!s)return;
  if(s.usuario_id && String(s.usuario_id)!==String(state.user?.usuario_id||""))return;
  if(s.periodMode&&$("periodMode"))$("periodMode").value=s.periodMode;
  [["yearSingle",s.yearSingle],["monthSingle",s.monthSingle],["yearStart",s.yearStart],["yearEnd",s.yearEnd],
   ["monthStart",s.monthStart],["monthEnd",s.monthEnd],["dateStart",s.dateStart],["dateEnd",s.dateEnd]]
    .forEach(([id,v])=>{if($(id)&&v!==undefined&&v!=="")$(id).value=v});
  updatePeriodVisibility();

  if($("poleFilter")&&s.pole){
    $("poleFilter").value=s.pole;fillDistricts();
  }
  if($("districtFilter")&&s.district){
    $("districtFilter").value=s.district;fillChurches();
  }
  if($("churchFilter")&&s.church)$("churchFilter").value=s.church;

  if(s.priority)state.currentPriority=s.priority;
}
async function restoreUiView(){
  const s=uiStateRead();
  const sameUser=!s?.usuario_id||String(s.usuario_id)===String(state.user?.usuario_id||"");
  const view=sameUser?(s?.view||"dashboard"):"dashboard";
  const target=VIEW_TITLES[view]?view:"dashboard";
  await showView(target,{restore:true});
}
function bindClick(id,handler){
  const el=$(id);if(el)el.addEventListener("click",handler);
}
function bindChange(id,handler){
  const el=$(id);if(el)el.addEventListener("change",handler);
}
function bindInput(id,handler){
  const el=$(id);if(el)el.addEventListener("input",handler);
}


async function once(key,fn){if(PERF.inflight.has(key))return PERF.inflight.get(key);const p=Promise.resolve().then(fn).finally(()=>PERF.inflight.delete(key));PERF.inflight.set(key,p);return p}
function setSyncState(text,kind="ok"){const b=$("syncBadge");if(!b)return;const c=kind==="sync"?"#ffb800":kind==="error"?"#ff0046":"";b.innerHTML=`<i${c?` style="background:${c}"`:""}></i>${text}`}
function moduleBusy(id,on,text="Atualizando..."){const el=$(id);if(!el)return;let x=el.querySelector('.module-sync-indicator-v112');if(on){if(!x){x=document.createElement('div');x.className='module-sync-indicator-v112';el.prepend(x)}x.textContent=text}else x?.remove()}


const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const num=v=>Number(v||0);
const pct=(a,b)=>b?Math.max(0,Math.min(100,a/b*100)):0;
const fmt=v=>Number(v||0).toLocaleString("pt-BR",{maximumFractionDigits:1});
const percent=v=>`${Number(v||0).toFixed(1).replace(".",",")}%`;

function dateIsoOnly(value){
  const s=String(value||"").trim();
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m?`${m[1]}-${m[2]}-${m[3]}`:"";
}
function formatDateBR(value){
  const iso=dateIsoOnly(value);if(!iso)return "—";
  const [y,m,d]=iso.split("-");return `${d}/${m}/${y}`;
}
function localTodayIso(){
  const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function formatDateTimeBR(value){
  if(!value)return "—";
  const d=new Date(value);if(isNaN(d.getTime()))return formatDateBR(value);
  return d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
function currentDistrictName(districtId){
  return (state.scope.distritos||[]).find(x=>String(x.distrito_id||"")===String(districtId||""))?.distrito||"";
}


function toast(msg){const e=$("toast");if(!e)return;e.textContent=msg;e.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.remove("show"),2800)}
function loading(on,text="Carregando...",critical=true){if(!critical)return;$("loadingText").textContent=text;$("loadingOverlay").classList.toggle("hidden-v111",!on)}
function endpoint(){return String(window.APP_CONFIG?.API_PROXY_URL||"").replace(/\/+$/,"")}
async function api(action,payload={},options={}){
  const body={...payload,action};
  if(state.token&&!body.token)body.token=state.token;
  const maxAttempts=options.noRetry?1:2;
  let lastError=null;

  for(let attempt=1;attempt<=maxAttempts;attempt++){
    try{
      const response=await fetch(endpoint(),{
        method:"POST",
        headers:{"Content-Type":"application/json;charset=UTF-8","X-Prioridades-Version":"1.11.8"},
        body:JSON.stringify(body),
        cache:"no-store"
      });

      const text=await response.text();
      let data;
      try{data=JSON.parse(text)}catch(_e){
        throw new Error("A API retornou uma resposta inválida.");
      }

      if(!response.ok||!data?.ok){
        const message=data?.error||`Erro HTTP ${response.status}.`;
        const detail=String(data?.detail||"");

        if(/Sessão inválida ou expirada/i.test(message)){
          hardLogout();
        }

        const transient=
          response.status>=500 ||
          /HTML em vez de JSON|temporariamente|timeout|tempo esgotado/i.test(message+" "+detail);

        if(transient && attempt<maxAttempts){
          await new Promise(r=>setTimeout(r,700*attempt));
          continue;
        }

        const error=new Error(message);
        error.detail=detail;
        error.status=response.status;
        throw error;
      }

      return data;
    }catch(e){
      lastError=e;
      const transient=/Falha ao comunicar|resposta inválida|HTML em vez de JSON|timeout|tempo esgotado/i.test(String(e?.message||e));
      if(transient && attempt<maxAttempts){
        await new Promise(r=>setTimeout(r,700*attempt));
        continue;
      }
      break;
    }
  }

  throw lastError||new Error("Falha ao comunicar com a API do Prioridades DSA.");
}
function hardLogout(){
  sessionStorage.removeItem("prioridades_token");
  sessionStorage.removeItem("prioridades_auth_snapshot");
  sessionStorage.removeItem("prioridades_ui_state");
  localStorage.removeItem("prioridades_token");
  state.token="";state.user=null;
}
async function logout(){try{if(state.token)await api("logout",{})}catch(_e){}finally{hardLogout();location.reload()}}

function periodPayload(){
  const mode=$("periodMode").value;
  if(mode==="ano")return{modo:"ano",ano:+$("yearSingle").value};
  if(mode==="mes")return{modo:"mes",ano:+$("yearSingle").value,mes:+$("monthSingle").value};
  if(mode==="anos")return{modo:"anos",ano_inicio:+$("yearStart").value,ano_fim:+$("yearEnd").value};
  if(mode==="meses")return{modo:"meses",ano_inicio:+$("yearStart").value,mes_inicio:+$("monthStart").value,ano_fim:+$("yearEnd").value,mes_fim:+$("monthEnd").value};
  return{data_inicio:$("dateStart").value,data_fim:$("dateEnd").value};
}
function currentRequest(){
  return {...periodPayload(),
    polo_id:$("poleFilterWrap").classList.contains("hidden-v111")?"":$("poleFilter").value,
    distrito_id:$("districtFilterWrap").classList.contains("hidden-v111")?"":$("districtFilter").value,
    igreja_id:state.scope?.filtros?.igreja_fixa?(state.scope.igrejas?.[0]?.igreja_id||""):$("churchFilter").value,
    ranking_nivel:rankingLevelValue()
  };
}
function selectedChurchId(){return currentRequest().igreja_id}
function selectedChurch(){const id=selectedChurchId();return(state.scope.igrejas||[]).find(x=>x.igreja_id===id)||null}

function setLoginProgress(step,title,text){
  const box=$("loginProgressV20");if(!box)return;
  box.classList.remove("hidden-v111");
  box.classList.add("sequential-pulse-v224r1");
  qsa("#loginProgressV20 [data-login-step]").forEach(el=>{const n=Number(el.dataset.loginStep||0);el.classList.toggle("done",n<step);el.classList.toggle("active",n===step);el.classList.toggle("pending",n>step)});
  $("loginProgressTitleV20").textContent=title||"";$("loginProgressTextV20").textContent=text||"";
}
function resetLoginProgress(){const box=$("loginProgressV20");if(!box)return;box.classList.add("hidden-v111");box.classList.remove("sequential-pulse-v224r1");qsa("#loginProgressV20 [data-login-step]").forEach(el=>el.classList.remove("done","active","pending"))}
function finishLoginProgress(){setLoginProgress(4,"Tudo pronto!","Ambiente carregado com sucesso.");qsa("#loginProgressV20 [data-login-step]").forEach(el=>{el.classList.add("done");el.classList.remove("active","pending")})}

async function login(){
  $("loginMessage").textContent="";
  $("loginButton").disabled=true;
  $("loginButton").textContent="Entrando...";
  let slowTimer=null;

  try{
    setLoginProgress(1,"Validando acesso...","Conectando ao ambiente seguro.");
    slowTimer=setTimeout(()=>{
      if($("loginProgressTextV20"))$("loginProgressTextV20").textContent="A conexão está levando um pouco mais de tempo. Continuamos processando seu acesso...";
    },6000);

    const r=await api("login",{login:$("loginEmail").value.trim(),senha:$("loginCode").value});

    setLoginProgress(2,"Carregando seu perfil...","Identificando função, módulos e permissões.");
    persistSessionToken(r.token);
    state.user=r.user;
    state.modules=r.modules||[];
    state.scope=r.scope||state.scope;

    // Login digitado é uma nova entrada no sistema:
    // não herda igreja/filtros de uma sessão anterior.
    clearFreshLoginUiState();

    applyModules();
    setupTerritory();
    resetTerritoryFiltersForFreshLogin();
    renderProfile();
    authSnapshotWrite();

    setLoginProgress(3,"Preparando seu ambiente...","Abrindo o sistema enquanto os indicadores sincronizam.");

    const cachedDashboard=dashboardCacheRead();
    if(cachedDashboard){
      state.dashboard=cachedDashboard;
      state.context={...state.context,...cachedDashboard.context};
      cacheSet("dashboard",cachedDashboard);
      renderDashboard(cachedDashboard);
      renderContext();
    }else{
      renderDashboardShell();
      renderContext();
    }

    // Acesso visual imediato: Dashboard não bloqueia mais a entrada.
    finishLoginProgress();
    startApp();
    await showView("dashboard",{freshLogin:true});
    resetLoginProgress();

    setSyncState("Sincronizando","sync");
    loadDashboard({background:true})
      .then(()=>{setSyncState("Conectado","ok");schedulePrefetchCoreModules()})
      .catch(err=>{console.warn("Dashboard inicial:",err);setSyncState("Erro de sincronização","error")});
  }catch(e){
    resetLoginProgress();
    $("loginMessage").textContent=e.message;
  }finally{
    if(slowTimer)clearTimeout(slowTimer);
    $("loginButton").disabled=false;
    $("loginButton").innerHTML='Entrar <span aria-hidden="true">→</span>';
  }
}
async function restore(){
  if(!state.token)return false;

  // Migra token legado para sessionStorage.
  persistSessionToken(state.token);

  const snap=authSnapshotRead();
  if(snap?.user){
    state.user=snap.user;
    state.modules=snap.modules||[];
    state.scope=snap.scope||state.scope;

    // Valida sem bloquear F5. Falha de rede não derruba a sessão.
    api("session",{}, {noRetry:true})
      .then(r=>{
        state.user=r.user||state.user;
        state.modules=r.modules||state.modules;
        authSnapshotWrite();
        applyModules();
        renderProfile();
      })
      .catch(e=>{
        if(/Sessão inválida ou expirada/i.test(String(e?.message||""))){
          hardLogout();
          location.reload();
        }else{
          console.warn("Validação de sessão em background:",e);
        }
      });

    return true;
  }

  try{
    const r=await api("session",{}, {noRetry:false});
    state.user=r.user;
    state.modules=r.modules||[];
    authSnapshotWrite();
    return true;
  }catch(e){
    if(/Sessão inválida ou expirada/i.test(String(e?.message||"")))hardLogout();
    return false;
  }
}

function resolveProfilePhotoUrl(url){
  const raw=String(url||'').trim();
  if(!raw)return "assets/icone_192.png";
  const m=raw.match(/[?&]id=([^&]+)/) || raw.match(/\/d\/([^/]+)/);
  if(m&&m[1])return "https://drive.google.com/thumbnail?id="+encodeURIComponent(m[1])+"&sz=w256";
  return raw;
}
function applyProfilePhoto(){
  const img=$("profilePhoto");
  if(!img)return;
  img.onerror=()=>{img.onerror=null;img.src="assets/icone_192.png"};
  img.referrerPolicy="no-referrer";
  img.src=resolveProfilePhotoUrl(state.user?.foto_url);
}

function startApp(){
  $("loginScreen").classList.add("hidden");$("appRoot").classList.remove("hidden");
  $("profileName").textContent=state.user?.nome||"Usuário";$("profileRole").textContent=state.user?.perfil||"";
  applyProfilePhoto();
  applyModules();
}
function applyModules(){
  const allowed=new Set((state.modules||[]).map(x=>x.modulo));
  qsa(".nav-button[data-view]").forEach(btn=>{
    const module=Object.entries(MODULE_TO_VIEW).find(([,v])=>v===btn.dataset.view)?.[0];
    btn.classList.toggle("hidden",module&&!allowed.has(module));
  });
  const hasPriorities=allowed.has("prioridades");
  $("prioritiesToggle").classList.toggle("hidden",!hasPriorities);
  $("prioritySubmenu").classList.toggle("hidden",!hasPriorities);
}
async function bootstrap(options={}){
  const background=!!options.background;
  const cached=cacheGet("bootstrap","global")||localCacheRead("bootstrap");

  if(cached){
    state.user=cached.user||state.user;
    state.modules=cached.modules||state.modules;
    state.scope=cached.scope||state.scope;

    applyModules();
    setupTerritory();
    renderProfile();
  }else if(!background){
    loading(true,"Carregando ambiente...");
  }

  try{
    const r=await once(
      "bootstrap",
      ()=>api("bootstrap",{})
    );

    state.user=r.user||state.user;
    state.modules=r.modules||state.modules;
    state.scope=r.scope||state.scope;

    // Não persiste Dashboard dentro do bootstrap na R7.
    const bootstrapCache={
      user:state.user,
      modules:state.modules,
      scope:state.scope,
      app:r.app||null,
      bootstrap_mode:"light"
    };

    cacheSet("bootstrap",bootstrapCache,"global");
    localCacheWrite("bootstrap",bootstrapCache);

    applyModules();
    setupTerritory();
    renderProfile();

    const cachedDashboard=dashboardCacheRead();
    if(cachedDashboard){
      state.dashboard=cachedDashboard;
      state.context={...state.context,...cachedDashboard.context};
      cacheSet("dashboard",cachedDashboard);
      renderDashboard(cachedDashboard);
      renderContext();
    }else{
      renderDashboardShell();
    }

    setSyncState("Sincronizando dashboard","sync");

    loadDashboard({background:true})
      .then(()=>schedulePrefetchCoreModules())
      .catch(e=>{
        setSyncState("Erro de sincronização","error");
        toast(e.message);
      });

    return r;
  }finally{
    if(!background)loading(false);
  }
}

function prefetchCoreModules(){
  const jobs=[];

  if(state.modules.some(x=>x.modulo==="prioridades")){
    jobs.push(loadPriorities({background:true,prefetch:true}).catch(()=>{}));
  }

  if(state.modules.some(x=>x.modulo==="planner")){
    jobs.push(loadPlanner({background:true,prefetch:true}).catch(()=>{}));
  }

  if(state.modules.some(x=>x.modulo==="requisitos")){
    jobs.push(loadRequirements({background:true,prefetch:true}).catch(()=>{}));
  }

  return Promise.allSettled(jobs);
}

function schedulePrefetchCoreModules(){
  setTimeout(()=>{startBackgroundV225(loadPriorities({background:true}));startBackgroundV225(loadPlanner({background:true}));startBackgroundV225(loadRequirements({background:true}))},500);
  setTimeout(()=>{startBackgroundV225(loadTimeline({background:true}));startBackgroundV225(loadMyChurch({background:true}));startBackgroundV225(loadReports({background:true}))},1800);
}

function renderProfile(){
  $("profileName").textContent=state.user?.nome||"";$("profileRole").textContent=state.user?.perfil||"";
  applyProfilePhoto();
setupRankingFilter();
}
function setupTerritory(){
  const f=state.scope?.filtros||{};
  $("poleFilterWrap").classList.toggle("hidden-v111",!f.mostrar_polo);
  $("districtFilterWrap").classList.toggle("hidden-v111",!f.mostrar_distrito);
  $("churchFilterWrap").classList.toggle("hidden-v111",f.igreja_fixa===true);
  fillPoles();fillDistricts();fillChurches();
}
function fillPoles(){
  const all=state.scope?.filtros?.permitir_todos_polos;
  const arr=[...(all?[{polo_id:"",polo:"Todos"}]:[]),...(state.scope.polos||[])];
  $("poleFilter").innerHTML=arr.map(x=>`<option value="${esc(x.polo_id)}">${esc(x.polo)}</option>`).join("");
}
function fillDistricts(){
  const pole=$("poleFilter").value;let arr=state.scope.distritos||[];if(pole)arr=arr.filter(x=>x.polo_id===pole);
  const all=state.scope?.filtros?.permitir_todos_distritos;
  $("districtFilter").innerHTML=[...(all?[{distrito_id:"",distrito:"Todos"}]:[]),...arr].map(x=>`<option value="${esc(x.distrito_id)}">${esc(x.distrito)}</option>`).join("");
}
function fillChurches(){
  const d=$("districtFilter").value;let arr=state.scope.igrejas||[];if(d)arr=arr.filter(x=>x.distrito_id===d);
  const all=state.scope?.filtros?.permitir_todas_igrejas;
  $("churchFilter").innerHTML=[...(all?[{igreja_id:"",igreja:"Todas"}]:[]),...arr].map(x=>`<option value="${esc(x.igreja_id)}">${esc(x.igreja)}</option>`).join("");
}
function setupPeriod(){
  const years=[];for(let y=2026;y<=2035;y++)years.push(y);
  ["yearSingle","yearStart","yearEnd","goalYearInput"].forEach(id=>$(id).innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join(""));
  ["monthSingle","monthStart","monthEnd"].forEach(id=>$(id).innerHTML=MONTHS.map(([v,n])=>`<option value="${v}">${n}</option>`).join(""));
  const now=new Date(),y=Math.max(2026,now.getFullYear());$("yearSingle").value=y;$("yearStart").value=2026;$("yearEnd").value=y;$("monthSingle").value=now.getMonth()+1;$("monthStart").value=1;$("monthEnd").value=12;$("dateStart").value="2026-01-01";$("dateEnd").value=`${y}-12-31`;
  updatePeriodVisibility();
}
function updatePeriodVisibility(){
  const m=$("periodMode").value,show={yearSingleWrap:["ano","mes"].includes(m),monthSingleWrap:m==="mes",yearStartWrap:["anos","meses"].includes(m),monthStartWrap:m==="meses",yearEndWrap:["anos","meses"].includes(m),monthEndWrap:m==="meses",dateStartWrap:m==="personalizado",dateEndWrap:m==="personalizado"};
  Object.entries(show).forEach(([id,on])=>$(id).classList.toggle("hidden-v111",!on));
}
function renderContext(){
  const req=currentRequest();
  const c=selectedChurch();
  let d=(state.scope.distritos||[]).find(x=>x.distrito_id===req.distrito_id);
  if(!d&&c?.distrito_id)d=(state.scope.distritos||[]).find(x=>x.distrito_id===c.distrito_id);
  let p=(state.scope.polos||[]).find(x=>x.polo_id===req.polo_id);
  if(!p&&d?.polo_id)p=(state.scope.polos||[]).find(x=>x.polo_id===d.polo_id);

  const names=[window.APP_CONFIG.FIELD,p?.polo,d?.distrito,c?.igreja].filter(Boolean);
  $("fieldContext").textContent=names.join(" · ").toUpperCase();
  $("contextText").textContent=`${c?.igreja||d?.distrito||p?.polo||window.APP_CONFIG.FIELD} · ${formatDateBR(state.context.data_inicio)} a ${formatDateBR(state.context.data_fim)}`;
  $("lastUpdate").textContent="Última atualização: "+new Date().toLocaleString("pt-BR");
}
async function applyFilters(){setSyncState("Aplicando filtros","sync");cacheInvalidate(["dashboard","priorities","planner","timeline","reports","requirements","myChurch"]);try{await loadDashboard({background:false});const active=document.querySelector(".view.active")?.id;if(active==="prioritiesView")await loadPriorities({background:false});else if(active==="plannerView")await loadPlanner({background:false});else if(active==="timelineView")await loadTimeline({background:false});else if(active==="reportsView")await loadReports({background:false});else if(active==="requirementsView")await loadRequirements({background:false});else if(active==="myChurchView")await loadMyChurch({background:false})}catch(e){toast(e.message)}finally{setSyncState("Conectado","ok")}}
async function loadDashboard(options={}){
  const before=state.dashboard||null;
  const d=await api("dashboard",currentRequest());
  state.dashboard=d;state.context={...state.context,...(d.context||{})};
  enterpriseWriteV225("dashboard",d);cacheSet("dashboard",d);localCacheWrite("dashboard",d);
  if(viewIsActiveV225("dashboard")&&(changedV225(before,d)||!options.background)){renderDashboard(d);renderContext()}
  return d;
}
function renderDashboardShell(){
  // Mantém estrutura estável enquanto sincroniza e evita tela congelada.
  $("overallPercent").textContent=state.dashboard?Math.round(num(state.dashboard?.geral?.percentual))+"%":"—";
  $("overallGoal").textContent=state.dashboard?fmt(state.dashboard?.geral?.meta):"—";
  $("overallReached").textContent=state.dashboard?fmt(state.dashboard?.geral?.alcancado):"—";

  if(!state.dashboard){
    $("priorityCards").innerHTML=Object.keys(AREAS).map(area=>`
      <div class="priority-card dashboard-skeleton-v114" style="--accent:${AREAS[area]}">
        <div class="skeleton-line-v114 w40"></div>
        <div class="skeleton-line-v114 w70"></div>
        <div class="skeleton-line-v114 w55"></div>
      </div>`).join("");

    $("trafficGrid").innerHTML='<div class="dashboard-inline-loading-v114">Sincronizando indicadores...</div>';
    $("alertsList").innerHTML='<div class="dashboard-inline-loading-v114">Carregando alertas...</div>';
    $("rankingList").innerHTML='<div class="dashboard-inline-loading-v114">Carregando ranking...</div>';
  }
}

function dashboardCacheRead(){
  const mem=cacheGet("dashboard");
  if(mem)return mem;

  try{
    const raw=localStorage.getItem("prioridades_cache_dashboard");
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    if(!parsed?.data)return null;

    // Dashboard persistente pode ser exibido por até 30 minutos,
    // mas sempre é revalidado em background.
    if(Date.now()-Number(parsed.savedAt||0)>30*60*1000)return null;
    return parsed.data;
  }catch(_e){
    return null;
  }
}

function rankingRoleOptions(){
  const role=String(state.user?.perfil||"");
  if(role==="Desenvolvedor"||role==="Administrador"){
    return [
      {value:"igrejas",label:"Todos"},
      {value:"polos",label:"Polos"},
      {value:"distritos",label:"Distritos"}
    ];
  }
  if(role==="Coordenador do Polo"){
    return [
      {value:"igrejas",label:"Todos"},
      {value:"distritos",label:"Distritos"}
    ];
  }
  return [];
}
function setupRankingFilter(){
  const opts=rankingRoleOptions();
  const wrap=$("rankingLevelWrap"),sel=$("rankingLevel");
  if(!wrap||!sel)return;
  wrap.classList.toggle("hidden-v111",opts.length===0);
  if(opts.length){
    const previous=sel.value||"igrejas";
    sel.innerHTML=opts.map(x=>`<option value="${x.value}">${x.label}</option>`).join("");
    sel.value=opts.some(x=>x.value===previous)?previous:"igrejas";
  }else{
    sel.innerHTML='<option value="igrejas">Igrejas</option>';
    sel.value="igrejas";
  }
}
function rankingLevelValue(){return $("rankingLevel")?.value||"igrejas"}
function rankingLabel(level){return level==="polos"?"Polos":level==="distritos"?"Distritos":"Igrejas"}
function renderDashboard(d){
  const g=d.geral||{},p=num(g.percentual);$("overallRadial").style.setProperty("--value",p);$("overallPercent").textContent=Math.round(p)+"%";$("overallGoal").textContent=fmt(g.meta);$("overallReached").textContent=fmt(g.alcancado);
  $("dailyBibleVerse").textContent=`Resultados de ${formatDateBR(d.context?.data_inicio)} a ${formatDateBR(d.context?.data_fim)}.`;
  $("priorityCards").innerHTML=(d.prioridades||[]).map(x=>`<button class="priority-card" data-area="${esc(x.prioridade)}" style="--accent:${AREAS[x.prioridade]||'#102333'}"><div style="display:flex;align-items:center;justify-content:space-between"><img class="priority-card-icon-v8" src="${AREA_ICONS[x.prioridade]||'assets/icone_192.png'}"><strong>${Math.round(num(x.percentual))}%</strong></div><h3>${esc(x.prioridade)}</h3><p>${fmt(x.alcancado)} de ${fmt(x.meta)} realizados</p><div class="progress"><i style="width:${Math.min(100,num(x.percentual))}%"></i></div></button>`).join("");
  qsa(".priority-card").forEach(b=>b.onclick=()=>openPriority(b.dataset.area));
  $("trafficGrid").innerHTML=(d.prioridades||[]).map(x=>{const c=num(x.percentual)>=80?"#00c97b":num(x.percentual)>=60?"#ffb800":"#ff0046";return`<div class="traffic-card"><strong><i class="traffic-status-dot" style="background:${c}"></i>${esc(x.prioridade)}</strong><span>${percent(x.percentual)} alcançado</span><img class="traffic-priority-icon" src="${AREA_ICONS[x.prioridade]}"></div>`}).join("");
  $("alertsList").innerHTML=(d.alertas||[]).map(x=>`<div class="alert-item"><img class="alert-priority-icon" src="${AREA_ICONS[x.prioridade]||'assets/icone_192.png'}"><div><strong>${esc(x.titulo)}</strong><span>${esc(x.igreja||"")} · ${esc(x.prioridade||"")}</span></div><strong>${Math.round(num(x.percentual))}%</strong></div>`).join("")||'<div class="empty-v111">Nenhum alerta no contexto atual.</div>';
  const rankingLevel=(d.ranking||[])[0]?.nivel||rankingLevelValue();
  $("rankingTitle").textContent=rankingLabel(rankingLevel);
  const rankingLimitRaw=$("rankingLimitV20")?.value||"all";const rankingLimit=rankingLimitRaw==="all"?Infinity:Number(rankingLimitRaw||Infinity);const rankingRows=(d.ranking||[]).slice(0,rankingLimit);$("rankingList").innerHTML=rankingRows.map(x=>`<div class="ranking-item"><b>${x.posicao}</b><div><strong>${esc(x.nome||x.igreja||"")}</strong><span>${fmt(x.alcancado)} de ${fmt(x.meta)}</span></div><strong>${Math.round(num(x.percentual))}%</strong></div>`).join("")||'<div class="empty-v111">Sem ranking disponível.</div>';
}


async function showView(name,options={}){
  qsa(".view").forEach(v=>v.classList.remove("active"));
  $(name+"View")?.classList.add("active");
  qsa(".nav-button[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  $("viewTitle").textContent=VIEW_TITLES[name]||name;
  $("sidebar").classList.remove("open");
  uiStateWrite();

  const snapshot=enterpriseReadV225(name);
  const rendered=renderCachedModuleV225(name,snapshot);
  setSyncState(rendered?"Atualizando em segundo plano":"Carregando dados","sync");

  startBackgroundV225((async()=>{
    try{
      if(name==="dashboard")await loadDashboard({background:true});
      else if(name==="priorities")await loadPriorities({background:true});
      else if(name==="planner")await loadPlanner({background:true});
      else if(name==="timeline")await loadTimeline({background:true});
      else if(name==="reports")await loadReports({background:true});
      else if(name==="requirements")await loadRequirements({background:true});
      else if(name==="myChurch")await loadMyChurch({background:true});
      else if(name==="admin")await loadDeveloper({background:true});
      setSyncState("Conectado","ok");
    }catch(e){
      setSyncState("Erro de sincronização","error");
      if(!rendered)toast(e.message||"Não foi possível carregar o módulo.");
    }
  })());
  return true;
}
function openPriority(area){
  state.currentPriority=area||"Identidade";
  state.selectedRequirementId="";

  // Renderiza a prioridade clicada ANTES de qualquer chamada remota.
  renderPriorityShell(state.currentPriority);
  showView("priorities");
}
function renderPriorityShell(area){
  state.currentPriority=area||state.currentPriority||"Identidade";
  document.documentElement.style.setProperty(
    "--current",
    AREAS[state.currentPriority]||AREAS.Identidade
  );

  const desc={
    "Identidade":"Fortalecer a identidade profética da Igreja, as crenças fundamentais e o estilo de vida adventista.",
    "Liderança":"Formar e desenvolver líderes, fortalecendo competências espirituais, administrativas e pastorais.",
    "Novas Gerações":"Integrar crianças, adolescentes e jovens à comunhão, fidelidade, liderança e missão.",
    "Discipulado":"Desenvolver comunhão, relacionamento, missão e multiplicação por meio de uma jornada contínua de discipulado."
  };

  $("priorityAreaTitle").textContent=state.currentPriority;
  $("priorityAreaDescription").textContent=desc[state.currentPriority]||"";
  $("priorityShapeV7").src=AREA_ICONS[state.currentPriority]||AREA_ICONS.Identidade;
  $("priorityWatermarkV8").src=AREA_ICONS[state.currentPriority]||AREA_ICONS.Identidade;

  // Zera somente a área dinâmica para impedir conteúdo estático da prioridade anterior.
  $("priorityPercentV7").textContent="—";
  $("priorityGoalV7").textContent="—";
  $("priorityReachedV7").textContent="—";
  $("priorityCountV7").textContent="—";
  $("priorityProgressV7").style.width="0%";
  $("criteriaListV51").innerHTML='<div class="priority-inline-loading-v114">Carregando critérios...</div>';
  $("criterionTitleV51").textContent="Selecione um critério";
  $("criterionStatusV51").textContent="—";
  $("criterionDescriptionV51").textContent="—";
  $("criterionQuestionV51").textContent="—";
}

async function loadPriorities(options={}){
  const before={requirements:state.requirements||[],results:state.results||[]};
  const [rq,rs]=await Promise.all([api("list_requirements",currentRequest()),api("list_results",currentRequest())]);
  const next={requirements:rq.data||[],results:rs.data||[]};
  state.requirements=next.requirements;state.results=next.results;enterpriseWriteV225("priorities",next);cacheSet("priorities",next);
  if(viewIsActiveV225("priorities")&&(changedV225(before,next)||!options.background))renderPriorities();
  return next;
}
function effectiveGoal(req){
  const year=Number(String(state.context.data_inicio||$("yearSingle").value).slice(0,4));const e=(req.metas_efetivas||[]).find(x=>+x.ano===year);return e?num(e.meta):num(req.meta_padrao)
}
function resultRecencyClient_(x){
  const a=Date.parse(x?.atualizado_em||"");
  if(Number.isFinite(a))return a;
  const d=Date.parse(String(x?.data_realizacao||"").slice(0,10));
  return Number.isFinite(d)?d:0;
}
function latestResultFor(reqId){
  const churchId=selectedChurchId();
  return (state.results||[])
    .filter(x=>String(x.requisito_id||"")===String(reqId||"")&&(!churchId||String(x.igreja_id||"")===String(churchId)))
    .sort((a,b)=>resultRecencyClient_(b)-resultRecencyClient_(a))[0]||null;
}
function reachedFor(reqId){
  const raw=Math.max(0,num(latestResultFor(reqId)?.alcancado||0));
  const req=state.requirements.find(x=>String(x.requisito_id||"")===String(reqId||""));
  const goal=req?effectiveGoal(req):0;
  return goal>=0?Math.min(raw,goal):raw;
}
function renderPriorities(){
  document.documentElement.style.setProperty("--current",AREAS[state.currentPriority]);
  const desc={"Identidade":"Fortalecer a identidade profética da Igreja, as crenças fundamentais e o estilo de vida adventista.","Liderança":"Formar e desenvolver líderes, fortalecendo competências espirituais, administrativas e pastorais.","Novas Gerações":"Integrar crianças, adolescentes e jovens à comunhão, fidelidade, liderança e missão.","Discipulado":"Desenvolver comunhão, relacionamento, missão e multiplicação por meio de uma jornada contínua de discipulado."};
  $("priorityAreaTitle").textContent=state.currentPriority;$("priorityAreaDescription").textContent=desc[state.currentPriority];$("priorityShapeV7").src=AREA_ICONS[state.currentPriority];$("priorityWatermarkV8").src=AREA_ICONS[state.currentPriority];
  $("priorityTabs").innerHTML=Object.entries(AREAS).map(([a,c])=>`<button class="priority-tab-v7 ${a===state.currentPriority?"active":""}" data-area="${a}" style="--tab:${c}"><span class="priority-tab-copy-v7"><img class="priority-tab-icon-v8" src="${AREA_ICONS[a]}">${a}</span><small>${state.requirements.filter(r=>r.prioridade===a).length} critérios</small></button>`).join("");
  qsa(".priority-tab-v7").forEach(b=>b.onclick=()=>{state.currentPriority=b.dataset.area;state.selectedRequirementId="";renderPriorities()});
  const rows=state.requirements.filter(r=>r.prioridade===state.currentPriority);const totals=rows.reduce((a,r)=>{const g=effectiveGoal(r),v=reachedFor(r.requisito_id);a.g+=g;a.v+=v;return a},{g:0,v:0}),pp=pct(totals.v,totals.g);
  $("priorityPercentV7").textContent=Math.round(pp)+"%";$("priorityProgressV7").style.width=pp+"%";$("priorityGoalV7").textContent=fmt(totals.g);$("priorityReachedV7").textContent=fmt(totals.v);$("priorityCountV7").textContent=rows.length;
  const status=$("criteriaStatusFilter").value;
  const visible=rows.filter(r=>{const p=pct(reachedFor(r.requisito_id),effectiveGoal(r));const s=p>=100?"Concluído":p>=60?"Em andamento":"Atenção";return status==="Todos"||s===status});
  $("criteriaListV51").innerHTML=visible.map((r,i)=>{const p=pct(reachedFor(r.requisito_id),effectiveGoal(r));const s=p>=100?"Concluído":p>=60?"Em andamento":"Atenção";return`<button class="criterion-v51 ${state.selectedRequirementId===r.requisito_id?"active":""}" data-id="${r.requisito_id}"><b>${String(i+1).padStart(2,"0")}</b><span><strong>${esc(r.titulo)}</strong><small>${s}</small></span><em>${Math.round(p)}%</em></button>`}).join("");
  qsa(".criterion-v51").forEach(b=>b.onclick=()=>{
    // v2.2.4: mudar de critério nunca inicia gravação.
    // Rascunhos não salvos continuam apenas no front/sessionStorage.
    state.selectedRequirementId=b.dataset.id;
    renderCriterion();
  });
  if(!state.selectedRequirementId&&rows[0])state.selectedRequirementId=rows[0].requisito_id;renderCriterion();
}
function renderCriterion(){
  const r=state.requirements.find(x=>x.requisito_id===state.selectedRequirementId);if(!r)return;
  const goal=effectiveGoal(r),reached=reachedFor(r.requisito_id),p=pct(reached,goal),churchId=selectedChurchId(),server=latestResultFor(r.requisito_id)||{};
  const draft=criterionDraftFor(r.requisito_id);
  const last=draft?{...server,...draft.values}:server;

  $("criterionTitleV51").textContent=r.titulo;
  $("criterionStatusV51").textContent=p>=100?"Concluído":p>=60?"Em andamento":"Atenção";
  $("criterionDescriptionV51").textContent=r.direcionamento||"—";
  $("criterionQuestionV51").textContent=r.pergunta||"—";
  $("actionPlanV51").value=last.plano_acao||"";
  $("goalInputV51").value=goal;
  $("reachedInputV51").max=String(Math.max(0,goal));
  $("reachedInputV51").min="0";
  $("reachedInputV51").value=Math.min(Math.max(0,num(last.alcancado??0)),Math.max(0,goal));
  $("responsibleInputV51").value=last.responsavel||"";
  $("dateInputV51").value=last.data_inicial||"";
  $("dateEndInputV222").value=last.data_final||"";
  $("voteInputV51").value=last.voto||"";
  $("materialInputV51").value=last.material||"";
  updateLive();

  const disabled=!churchId;
  ["actionPlanV51","reachedInputV51","responsibleInputV51","dateInputV51","dateEndInputV222","voteInputV51","materialInputV51","saveCriterionV51"]
    .forEach(id=>{if($(id))$(id).disabled=disabled});
  $("goalInputV51").disabled=true;
  if(disabled)$("saveCriterionV51").textContent="Selecione uma igreja para editar";
  else criterionButtonState();
}
function updateLive(){
  const g=Math.max(0,num($("goalInputV51").value));
  let r=Math.max(0,num($("reachedInputV51").value));
  if(r>g){
    r=g;
    $("reachedInputV51").value=String(g);
    toast("O valor alcançado foi limitado à meta do requisito.");
  }
  $("reachedInputV51").max=String(g);
  const p=pct(r,g);
  $("livePercentV51").textContent=Math.round(p)+"%";
  $("liveProgressV51").style.width=Math.min(100,p)+"%";
}
function recordDateForCurrentPeriod(){
  const today=localTodayIso();
  const start=String(state.context?.data_inicio||"").slice(0,10);
  const end=String(state.context?.data_fim||"").slice(0,10);
  if(start&&end&&today>=start&&today<=end)return today;
  return end||start||today;
}
async function saveCriterion(){
  const draft=writeCriterionDraft();
  if(!draft)return toast("Selecione uma igreja.");
  return saveCriterionDraftByKey(draft.key,{silent:false,reason:"manual"});
}
async function saveCriterionDraftByKey(key,options={}){
  const draft=criterionDrafts.get(key);
  if(!draft)return;

  const revision=Number(draft.revision||0);
  const goalReq=state.requirements.find(x=>String(x.requisito_id)===String(draft.requisito_id));
  const goal=goalReq?effectiveGoal(goalReq):0;
  const reached=Math.max(0,num(draft.values.alcancado));

  if(reached>goal){
    draft.values.alcancado=String(goal);
    criterionDrafts.set(key,draft);
    sessionMapWrite("prioridades_criterion_drafts",criterionDrafts);
    if(state.selectedRequirementId===draft.requisito_id){
      $("reachedInputV51").value=String(goal);updateLive();
    }
    toast(`O valor alcançado não pode ser maior que a meta (${fmt(goal)}).`);
    return;
  }

  const payload={
    igreja_id:draft.igreja_id,
    requisito_id:draft.requisito_id,
    data_realizacao:recordDateForCurrentPeriod(),
    alcancado:reached,
    plano_acao:draft.values.plano_acao||"",
    responsavel:draft.values.responsavel||"",
    data_inicial:draft.values.data_inicial||"",
    data_final:draft.values.data_final||"",
    voto:draft.values.voto||"",
    material:draft.values.material||""
  };

  // 1. Clique em Salvar = compromisso local imediato.
  patchLocalResult(payload);
  criterionSaveStatus.set(key,"saving");
  criterionButtonState();
  updatePriorityVisualsOnly();
  setSyncState("Sincronizando","sync");

  // 2. A chamada à planilha ocorre em background. Não bloqueia navegação.
  const promise=(async()=>{
    try{
      const r=await api("save_result",payload);
      patchLocalResult(payload,r.resultado_id||"");
      cacheInvalidate(["priorities","dashboard"]);

      // 3. Validação explícita Planilha x front também acontece em background.
      await verifyCriterionSavedInBackground(payload,key,revision);

      // Atualiza derivados sem reconstruir o critério que o usuário estiver preenchendo.
      syncPrioritiesDerivedBackground().catch(()=>{});
      return r;
    }catch(e){
      criterionSaveStatus.set(key,"error");
      if(criterionDraftKey()===key)criterionButtonState();
      setSyncState("Erro de sincronização","error");
      console.error("Erro ao salvar requisito:",e);
      if(!options.silent)toast(e.message||"Não foi possível sincronizar o resultado.");
      throw e;
    }finally{
      criterionPendingSaves.delete(key);
    }
  })();

  criterionPendingSaves.set(key,promise);
  return promise;
}

async function loadPlanner(options={}){
  const before=(state.planner||[]).slice();const r=await api("list_planner",currentRequest());const next=r.data||[];
  state.planner=next;enterpriseWriteV225("planner",{tasks:next});cacheSet("planner",next);
  if(viewIsActiveV225("planner")&&(changedV225(before,next)||!options.background))renderPlanner();
  return next;
}
function renderPlanner(){
  const statuses=["Não iniciado","Em andamento","Concluído"];
  $("kanbanBoard").innerHTML=statuses.map(s=>`<section class="kanban-column"><h3>${s}</h3>${state.planner.filter(t=>t.status===s).map(t=>{
    const title=t.requisito_titulo||t.titulo||"Tarefa";
    const church=t.igreja||selectedChurch()?.igreja||"Igreja não informada";
    const district=t.distrito||currentDistrictName(t.distrito_id)||"Distrito não informado";
    return `<article class="task-card task-card-r5" style="--task-color:${AREAS[t.prioridade]||'#9aaab3'}"><button class="task-edit-button" data-task="${t.tarefa_id}">✎</button><div class="task-main-r5"><span class="task-priority-r5"><img src="${AREA_ICONS[t.prioridade]||'assets/icone_192.png'}">${esc(t.prioridade||"Sem prioridade")}</span><strong class="task-title-r5">${esc(title)} <em>(${esc(church)})</em></strong></div><div class="task-info-r5"><span><b>Responsável:</b> ${esc(t.responsavel||"Não informado")}</span><span><b>Prazo:</b> ${formatDateBR(t.prazo)}</span><span><b>Distrito:</b> ${esc(district)}</span></div></article>`;
  }).join("")}</section>`).join("");
  qsa("[data-task]").forEach(b=>b.onclick=()=>openTaskModal(b.dataset.task));
  $("newTaskButton").disabled=!(state.scope?.igrejas||[]).length;
}
function openTaskModal(id=""){
  const t=state.planner.find(x=>x.tarefa_id===id)||{};
  const defaultChurchId=
    t.igreja_id ||
    selectedChurchId() ||
    (state.scope?.igrejas?.length===1 ? state.scope.igrejas[0].igreja_id : "");

  $("taskModalTitle").textContent=id?"Editar item do planejamento":"Nova tarefa";
  $("taskId").value=id;
  plannerChurchOptions(defaultChurchId);
  $("taskTitle").value=t.titulo||t.requisito_titulo||"";
  $("taskArea").value=t.prioridade||"Identidade";
  $("taskOwner").value=t.responsavel||"";
  $("taskDue").value=dateIsoOnly(t.prazo);
  $("taskStatus").value=t.status||"Não iniciado";
  $("deleteTask").classList.toggle("hidden",!id);
  $("taskModal").classList.add("open");
}
async function saveTask(){
  const churchId=$("taskChurch").value;
  if(!churchId)return toast("Selecione a igreja no formulário da tarefa.");
  const title=$("taskTitle").value.trim();if(!title)return toast("Informe o título.");
  const editingId=$("taskId").value;
  const old=state.planner.find(x=>x.tarefa_id===editingId)||{};
  const church=(state.scope?.igrejas||[]).find(c=>String(c.igreja_id||"")===String(churchId))||{};
  const districtName=currentDistrictName(church.distrito_id);
  const payload={tarefa_id:editingId,igreja_id:churchId,requisito_id:old.requisito_id||"",titulo:title,prioridade:$("taskArea").value,responsavel:$("taskOwner").value,prazo:$("taskDue").value,status:$("taskStatus").value};
  const snapshot=state.planner.map(x=>({...x}));
  const localTask={...old,...payload,tarefa_id:editingId||`LOCAL-${Date.now()}`,igreja:church.igreja||"",distrito_id:church.distrito_id||"",distrito:districtName,requisito_titulo:old.requisito_titulo||title,ativo:true};
  const idx=state.planner.findIndex(x=>x.tarefa_id===editingId);
  if(idx>=0)state.planner[idx]=localTask;else state.planner.push(localTask);
  renderPlanner();
  $("taskModal").classList.remove("open");
  setSyncState("Salvando tarefa","sync");
  try{
    const r=await api("save_planner_task",payload);
    localTask.tarefa_id=r.tarefa_id||localTask.tarefa_id;
    cacheInvalidate(["planner","timeline"]);
    cacheSet("planner",state.planner);
    toast("Tarefa salva.");setSyncState("Conectado","ok");
    Promise.allSettled([loadPlanner({background:true}),loadTimeline({background:true})]);
  }catch(e){
    state.planner=snapshot;renderPlanner();
    cacheInvalidate(["planner","timeline"]);
    setSyncState("Erro de sincronização","error");
    toast(e.message||"Não foi possível salvar a tarefa.");
  }
}
async function reauth(){
  const modal=$("passwordConfirmModal"),input=$("activePasswordInput"),button=$("confirmPasswordButton");
  if(!modal||!input||!button)return "";
  input.value="";modal.classList.add("open");document.body.classList.add("modal-open-v118");
  return new Promise(resolve=>{
    let settled=false;
    const finish=token=>{if(settled)return;settled=true;button.onclick=null;input.onkeydown=null;close.onclick=null;closeModalById("passwordConfirmModal");resolve(token||"")};
    const close=modal.querySelector('[data-close="passwordConfirmModal"]');
    const confirm=async()=>{const senha=input.value;if(!senha){input.focus();return}button.disabled=true;try{const r=await api("reauth",{senha});finish(String(r.reauth_token||r.data?.reauth_token||""))}catch(e){toast(e.message)}finally{input.value="";button.disabled=false}};
    button.onclick=confirm;input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();confirm()}};
    if(close)close.onclick=()=>finish("");
    setTimeout(()=>input.focus(),0);
  });
}
async function deleteTask(){
  const reauthToken=await reauth();if(!reauthToken)return;
  loading(true,"Excluindo tarefa...");
  try{
    const result=await api("delete_planner_task",{tarefa_id:$("taskId").value,reauth_token:reauthToken});
    if(result?.deleted!==true)throw new Error("A exclusão da tarefa não foi confirmada.");
    closeModalById("taskModal");cacheInvalidate(["planner","timeline"]);await loadPlanner({background:true});
    setSyncState("Conectado","ok");toast("Tarefa excluída e registrada no histórico.");
  }catch(e){
    setSyncState("Erro de sincronização","error");toast(e.message||"Não foi possível excluir a tarefa.");console.error(e);
  }finally{loading(false)}
}
async function loadTimeline(options={}){
  const before=(state.timeline||[]).slice();const r=await api("list_timeline",currentRequest());const next=r.data||[];
  state.timeline=next;enterpriseWriteV225("timeline",{timeline:next});cacheSet("timeline",next);
  if(viewIsActiveV225("timeline")&&(changedV225(before,next)||!options.background))renderTimeline();
  return next;
}
function renderTimeline(){
  $("timelineList").innerHTML=state.timeline.map(t=>{
    const title=t.requisito_titulo||t.titulo||"Tarefa";
    const church=t.igreja||"Igreja não informada";
    return `<article class="timeline-item timeline-item-r5" style="--timeline-color:${AREAS[t.prioridade]||'#00bddd'}"><div class="timeline-title-r5"><strong>${esc(title)}</strong><span class="timeline-area"><img src="${AREA_ICONS[t.prioridade]||'assets/icone_192.png'}">${esc(t.prioridade||"")}</span><em>(${esc(church)})</em></div><span>${esc(t.responsavel||"Não informado")} · ${esc(t.status||"")} · ${formatDateBR(t.evento_data||t.prazo||t.data_conclusao)}</span></article>`;
  }).join("")||'<div class="empty-v111">Nenhum item na linha do tempo.</div>';
}
async function loadRequirements(options={}){
  const before={requirements:state.requirements||[],goals:state.goals||[]};
  const [rq,g]=await Promise.all([api("list_requirements",currentRequest()),api("list_goals",currentRequest())]);
  const next={requirements:rq.data||[],goals:g.data||[]};state.requirements=next.requirements;state.goals=next.goals;enterpriseWriteV225("requirements",next);cacheSet("requirements",next);
  if(viewIsActiveV225("requirements")&&(changedV225(before,next)||!options.background))renderRequirements();
  return next;
}

function canEditRequirements(){
  const role=String(state.user?.perfil||"");
  return role==="Desenvolvedor"||role==="Administrador";
}

function effectiveRequirementGoal(requirementId){
  const view=state.requirementGoalView||{};
  const year=Number($("yearFilter")?.value||new Date().getFullYear());
  const churchId=selectedChurchId();

  if(churchId){
    const row=(view.effective_goals||[]).find(x=>
      String(x.requisito_id||"")===String(requirementId||"") &&
      String(x.igreja_id||"")===String(churchId||"") &&
      Number(x.ano||0)===year
    );
    if(row)return Number(row.meta||0);
  }

  const req=state.requirements.find(x=>String(x.requisito_id||"")===String(requirementId||""));
  return Number(req?.meta_padrao||0);
}

function renderRequirements(){
  if(!$("requirementsGrid"))return;

  const q=String($("requirementSearch")?.value||"").trim().toLowerCase();
  const rows=(state.requirements||[]).filter(r=>
    `${r.codigo||""} ${r.titulo||""} ${r.prioridade||""}`.toLowerCase().includes(q)
  );

  $("requirementsCount").textContent=`${rows.length} requisito${rows.length===1?"":"s"}`;

  const editable=canEditRequirements();
  $("newRequirementButton").classList.toggle("hidden-v111",!editable);

  $("requirementsGrid").innerHTML=rows.map(r=>{
    const color=AREAS[r.prioridade]||"#102333";
    const goal=effectiveRequirementGoal(r.requisito_id);
    const active=r.ativo!==false;

    return `<article class="requirement-card" style="--current:${color}">
      <div class="requirement-top">
        <span class="requirement-code">${esc(r.codigo||r.requisito_id||"")}</span>
        <span class="access-pill ${active?"active":"inactive"}"><i></i>${active?"Ativo":"Inativo"}</span>
      </div>
      <h3>${esc(r.titulo||"")}</h3>
      <p>${esc(r.direcionamento||"")}</p>
      <div class="requirement-meta">
        <span>${esc(r.prioridade||"")}</span>
        <span>Meta: ${fmt(goal)}</span>
      </div>
      ${editable?`<div class="requirement-actions-v118">
        <button class="requirement-edit" data-edit-requirement="${esc(r.requisito_id)}">Editar</button>
        <button class="requirement-edit" data-goal-requirement="${esc(r.requisito_id)}">Meta</button>
      </div>`:""}
    </article>`;
  }).join("")||'<div class="empty-v111">Nenhum requisito encontrado.</div>';

  qsa("[data-edit-requirement]").forEach(b=>{
    b.onclick=()=>openRequirement(b.dataset.editRequirement);
  });

  qsa("[data-goal-requirement]").forEach(b=>{
    b.onclick=()=>openGoal(b.dataset.goalRequirement);
  });
}

function openRequirement(id=""){
  const r=state.requirements.find(x=>x.requisito_id===id)||{};$("requirementModalTitle").textContent=id?"Editar requisito":"Novo requisito";$("requirementOriginalCode").value=id;$("requirementCodeInput").value=r.codigo||"";$("requirementAreaInput").value=r.prioridade||"Identidade";$("requirementTitleInput").value=r.titulo||"";$("requirementDescriptionInput").value=r.direcionamento||"";$("requirementQuestionInput").value=r.pergunta||"";$("requirementGoalInput").value=r.meta_padrao??0;$("requirementActiveInput").value=String(r.ativo!==false);$("requirementModal").classList.add("open")
}
async function saveRequirement(){
  loading(true,"Salvando requisito...");try{await api("save_requirement",{requisito_id:$("requirementOriginalCode").value,codigo:$("requirementCodeInput").value,prioridade:$("requirementAreaInput").value,titulo:$("requirementTitleInput").value,direcionamento:$("requirementDescriptionInput").value,pergunta:$("requirementQuestionInput").value,meta_padrao:num($("requirementGoalInput").value),ativo:$("requirementActiveInput").value==="true"});$("requirementModal").classList.remove("open");cacheInvalidate(["requirements","priorities","dashboard"]);await loadRequirements({background:true});toast("Requisito salvo.")}finally{loading(false)}
}
function openGoal(id){
  const r=state.requirements.find(x=>x.requisito_id===id)||{};$("goalRequirementId").value=id;$("goalModalTitle").textContent=selectedChurchId()?`Meta específica — ${r.titulo}`:`Meta global — ${r.titulo}`;$("goalYearInput").value=String(new Date().getFullYear());$("goalValueInput").value=r.meta_padrao??0;$("resetGoalButton").classList.toggle("hidden",!selectedChurchId());$("goalModal").classList.add("open")
}
async function saveGoal(){
  const id=$("goalRequirementId").value,meta=num($("goalValueInput").value),year=+$("goalYearInput").value;loading(true,"Salvando meta...");
  try{if(selectedChurchId())await api("save_church_goal",{igreja_id:selectedChurchId(),requisito_id:id,ano:year,meta});else await api("save_global_goal",{requisito_id:id,meta});$("goalModal").classList.remove("open");cacheInvalidate(["requirements","priorities","dashboard"]);await loadRequirements({background:true});toast("Meta salva.")}finally{loading(false)}
}
async function resetGoal(){loading(true,"Restaurando meta...");try{await api("reset_church_goal",{igreja_id:selectedChurchId(),requisito_id:$("goalRequirementId").value,ano:+$("goalYearInput").value});$("goalModal").classList.remove("open");cacheInvalidate(["requirements","priorities","dashboard"]);await loadRequirements({background:true});toast("Meta padrão restaurada.")}finally{loading(false)}}


function effectiveMyChurchId(){
  return (
    selectedChurchId() ||
    state.churchProfile?.igreja_id ||
    (state.scope?.igrejas?.length===1 ? state.scope.igrejas[0].igreja_id : "")
  );
}

function setChurchSaveState(dirty){
  state.churchFormDirty=!!dirty;
  const btn=$("saveChurchProfileButton");const btnBottom=$("saveChurchProfileButtonBottom");
  if(!btn)return;

  if(state.churchFormDirty){
    btn.disabled=false;
    btn.textContent="Salvar Informações";if(btnBottom)btnBottom.textContent="Salvar Informações";
    btn.classList.remove("saved-state-r6");
  }else{
    btn.disabled=false;
    btn.textContent="Salvo ✔️";if(btnBottom)btnBottom.textContent="Salvo ✔️";
    btn.classList.add("saved-state-r6");
  }
}

function bindChurchDirtyTracking(){
  const ids=[
    "churchEldersInput","churchFamiliesInput","churchUapgsInput",
    "churchFirstElderInput","churchFirstElderPhoneInput",
    "churchAddressInput","churchEmailInput","churchNotesInput"
  ];

  ids.forEach(id=>{
    const el=$(id);
    if(!el || el.dataset.dirtyBound==="1")return;
    el.dataset.dirtyBound="1";
    el.addEventListener("input",()=>setChurchSaveState(true));
    el.addEventListener("change",()=>setChurchSaveState(true));
  });

  qsa("#churchOfficersChecks input").forEach(el=>{
    if(el.dataset.dirtyBound==="1")return;
    el.dataset.dirtyBound="1";
    el.addEventListener("input",()=>setChurchSaveState(true));
    el.addEventListener("change",()=>setChurchSaveState(true));
  });
}

function plannerChurchOptions(selectedId=""){
  const districtId=currentRequest().distrito_id||"";
  let churches=[...(state.scope?.igrejas||[])];

  if(districtId){
    churches=churches.filter(c=>String(c.distrito_id||"")===String(districtId));
  }

  churches.sort((x,y)=>String(x.igreja||"").localeCompare(String(y.igreja||""),"pt-BR"));

  $("taskChurch").innerHTML=
    '<option value="">Selecione a igreja</option>'+
    churches.map(c=>`<option value="${esc(c.igreja_id)}">${esc(c.igreja)}</option>`).join("");

  if(selectedId && churches.some(c=>String(c.igreja_id)===String(selectedId))){
    $("taskChurch").value=selectedId;
  }
}

async function loadMyChurch(options={}){
  const churchId=selectedChurchId();if(!churchId)return;
  const before={profile:state.churchProfile||{},departments:state.departments||[],churchDepartments:state.churchDepartments||[]};
  const r=await api("get_my_church",{...currentRequest(),igreja_id:churchId});
  const next={profile:r.profile||{},departments:r.departamentos||r.departments||[],churchDepartments:r.igreja_departamentos||r.church_departments||[]};
  state.churchProfile=next.profile;state.departments=next.departments;state.churchDepartments=next.churchDepartments;enterpriseWriteV225("myChurch",next);cacheSet("myChurch",next);
  if(viewIsActiveV225("myChurch")&&(changedV225(before,next)||!options.background))renderMyChurch();
  return next;
}
function renderMyChurch(r={}){
  const p=state.churchProfile||{};$("churchProfileName").textContent=p.igreja||"Selecione uma igreja";const disabled=!p.igreja_id;$("churchEldersInput").value=p.quantidade_anciaos||0;$("churchFamiliesInput").value=p.quantidade_familias||0;$("churchUapgsInput").value=p.quantidade_uapgs||0;$("churchFirstElderInput").value=p.primeiro_anciao_diretor||"";$("churchFirstElderPhoneInput").value=p.contato_primeiro_anciao_diretor||"";$("churchAddressInput").value=p.endereco||"";$("churchNotesInput").value=p.observacoes||"";
  $("churchOfficersChecks").innerHTML=(state.departments||[]).map(d=>`<label class="dept-item-v111"><input type="checkbox" data-dept="${d.departamento_id}" ${d.tem_lider?"checked":""}><span><strong>${esc(d.departamento)}</strong><input type="text" data-dept-name="${d.departamento_id}" value="${esc(d.nome_lider||"")}" placeholder="Nome do líder"></span></label>`).join("");
  ["churchEldersInput","churchFamiliesInput","churchUapgsInput","churchFirstElderInput","churchFirstElderPhoneInput","churchAddressInput","churchNotesInput","saveChurchProfileButton","saveChurchProfileButtonBottom"].forEach(id=>$(id).disabled=disabled);

  bindChurchDirtyTracking();

  if(!disabled){
    setChurchSaveState(false);
  }else{
    const btn=$("saveChurchProfileButton");const btnBottom=$("saveChurchProfileButtonBottom");
    btn.textContent="Selecione uma igreja";
  }
}
async function saveMyChurch(){
  const churchId=effectiveMyChurchId();
  if(!churchId)return toast("Selecione uma igreja.");

  const btn=$("saveChurchProfileButton");
  const btnBottom=$("saveChurchProfileButtonBottom");
  btn.disabled=true;if(btnBottom)btnBottom.disabled=true;
  btn.textContent="Salvando...";if(btnBottom)btnBottom.textContent="Salvando...";

  try{
    await api("save_my_church",{
      igreja_id:churchId,
      quantidade_anciaos:+$("churchEldersInput").value,
      quantidade_familias:+$("churchFamiliesInput").value,
      quantidade_uapgs:+$("churchUapgsInput").value,
      primeiro_anciao_diretor:$("churchFirstElderInput").value,
      contato_primeiro_anciao_diretor:$("churchFirstElderPhoneInput").value,
      endereco:$("churchAddressInput").value,
      observacoes:$("churchNotesInput").value
    });

    const items=qsa("[data-dept]").map(cb=>({
      departamento_id:cb.dataset.dept,
      tem_lider:cb.checked,
      nome_lider:document.querySelector(
        `[data-dept-name="${cb.dataset.dept}"]`
      )?.value||""
    }));

    await api("save_church_departments_batch",{
      igreja_id:churchId,
      departamentos:items
    });

    cacheInvalidate("myChurch");
    setChurchSaveState(false);
    toast("Informações salvas.");

    // Revalidação silenciosa, sem retirar o estado Salvo.
    loadMyChurch({background:true}).catch(()=>{});
  }catch(e){
    setChurchSaveState(true);
    toast(e.message||"Não foi possível salvar as informações.");
  }finally{
    btn.disabled=false;if(btnBottom)btnBottom.disabled=false;
  }
}


function showReportArea(area){
  qsa(".report-tab-v21").forEach(b=>b.classList.toggle("active",b.dataset.reportArea===area));
  qsa(".report-area-v21").forEach(x=>x.classList.remove("active"));
  $(`reportArea${area==="ai"?"Ai":area==="fofa"?"Fofa":"History"}`)?.classList.add("active");
  if(area==="fofa")loadFofa({background:true}).catch(e=>toast(e.message));
  if(area==="history")loadFofaHistory({background:true}).catch(e=>toast(e.message));
}

async function loadFofa(options={}){
  const churchId=selectedChurchId();
  if(!churchId){
    state.fofaItems=[];state.fofaEvaluations=[];state.fofaCurrent=null;state.fofaProgress=null;state.fofaSmart=null;state.fofaCatalog={};state.fofaCompletion=null;
    renderFofa();
    return;
  }
  const ws=await api("fofa_workspace",currentRequest());
  state.fofaItems=Array.isArray(ws.items)?ws.items:[];
  state.fofaEvaluations=Array.isArray(ws.evaluations)?ws.evaluations:[];
  state.fofaCurrent=ws.current||null;
  state.fofaSmart=ws.smart_diagnostic||null;
  state.fofaCatalog=ws.catalog||{};
  state.fofaCompletion=ws.completion||state.fofaCurrent?.completion||null;
  state.fofaProgress=ws.progress||{total:state.fofaItems.length,answered:0,axis_totals:{},axis_answered:{}};
  renderFofa();
}
function fofaResponseMap(){
  const m=new Map();
  (state.fofaCurrent?.responses||[]).forEach(r=>m.set(String(r.fofa_item_id||""),r));
  return m;
}


function fofaSmartFactorOptions(axis,type,selectedId="",candidates=[]){
  const key=v=>String(v??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ");
  let rows=Array.isArray(candidates)&&candidates.length?candidates:[];
  if(!rows.length){
    rows=(state.fofaCatalog?.[axis]?.[type]||[]);
  }
  if(!rows.length){
    rows=(state.fofaItems||[]).filter(x=>key(x.eixo)===key(axis)&&key(x.tipo_fofa)===key(type));
  }
  const seen=new Set();
  rows=rows.filter(x=>{
    const id=String(x.fofa_item_id||"");
    if(!id||seen.has(id))return false;
    seen.add(id);return true;
  });
  return '<option value="">Selecione o fator FOFA...</option>'+rows.map((x,i)=>
    `<option value="${esc(x.fofa_item_id)}" ${String(x.fofa_item_id)===String(selectedId)?"selected":""}>${i===0&&Number(x.similaridade||0)>0?"★ ":""}${esc(x.fator)}</option>`
  ).join("");
}

function renderFofaSmartDiagnostic(){
  const host=$("fofaSmartDiagnostic"); if(!host)return;
  const d=state.fofaSmart;
  if(!selectedChurchId()){host.innerHTML='<div class="empty-v111">Selecione uma igreja para gerar o diagnóstico inteligente.</div>';return}
  if(!d||d.ok===false){host.innerHTML='<div class="empty-v111">Diagnóstico inteligente indisponível.</div>';return}

  const axes=["Identidade","Liderança","Novas Gerações","Discipulado"];
  const summaries=axes.map(axis=>{
    const x=d.by_axis?.[axis]||{};
    return `<div class="fofa-smart-axis-card-v21r2"><strong>${esc(axis)}</strong><b>${percent(x.percentual||0)}</b>
      <span>${fmt(x.alcancado||0)} de ${fmt(x.meta||0)} · ${Number(x.metas_configuradas||0)}/${Number(x.requisitos||0)} metas</span>
      <small>${Number(x.forcas_sugeridas||0)} força(s) · ${Number(x.fraquezas_sugeridas||0)} fraqueza(s)</small></div>`;
  }).join("");

  const currentRows=(d.requirements||[]).filter(x=>String(x.prioridade||"")===String(state.fofaAxis||""));
  const canApply=!!state.fofaCurrent&&String(state.fofaCurrent.evaluation?.status||"")!=="Concluído";

  const rows=currentRows.map(r=>{
    const type=r.tipo_sugerido||"", cls=type==="Força"?"force":"weakness";
    return `<article class="fofa-smart-requirement-v21r2" data-smart-req="${esc(r.requisito_id)}">
      <div class="fofa-smart-req-head-v21r2"><div><small>${esc(r.codigo||r.requisito_id)}</small><strong>${esc(r.titulo)}</strong></div>
      <span class="fofa-smart-badge-v21r2 ${cls}">${esc(type||"Sem sugestão")}</span></div>
      <div class="fofa-smart-metrics-v21r2"><span>Meta <b>${fmt(r.meta||0)}</b></span><span>Realizado <b>${fmt(r.alcancado||0)}</b></span>
      <span>Atingimento <b>${percent(r.percentual||0)}</b></span><span>Gap <b>${fmt(r.gap||0)}</b></span></div>
      <p>${esc(r.evidencia_sugerida||"")}</p>
      ${type?`<div class="fofa-smart-apply-v21r2">
        <label><span>Vincular ao fator FOFA · ${(r.fatores_compativeis||[]).length} opção(ões)</span><select data-smart-target>${fofaSmartFactorOptions(r.prioridade,type,r.fofa_item_sugerido_id||"",r.fatores_compativeis||[])}</select></label>
        <label><span>Nota sugerida · baseada no atingimento</span><select data-smart-note>${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(r.nota_sugerida)===n?"selected":""}>${n}</option>`).join("")}</select></label>
        <button data-apply-smart="${esc(r.requisito_id)}" ${canApply?"":"disabled"}>${canApply?"Aplicar na FOFA":"Inicie uma avaliação"}</button>
      </div>`:`<div class="fofa-smart-no-meta-v21r2">Configure uma meta para habilitar a sugestão automática.</div>`}
    </article>`;
  }).join("");

  host.innerHTML=`<div class="fofa-smart-head-v21r2"><div><p class="eyebrow">DIAGNÓSTICO INTELIGENTE</p><h3>REQUISITOS + METAS + RESULTADOS</h3>
    <p>Forças e Fraquezas são sugeridas pelo atingimento das metas e só são gravadas após validação da liderança. Oportunidades e Ameaças permanecem manuais.</p></div>
    <button id="refreshSmartFofaButton" class="secondary-v21r2">↻ Atualizar diagnóstico</button></div>
    <div class="fofa-smart-kpis-v21r2"><div><span>Metas configuradas</span><strong>${percent(d.indice_meta||0)}</strong></div>
    <div><span>Índice de execução</span><strong>${percent(d.indice_execucao||0)}</strong></div>
    <div><span>Meta total</span><strong>${fmt(d.total_meta||0)}</strong></div><div><span>Realizado</span><strong>${fmt(d.total_realizado||0)}</strong></div></div>
    <div class="fofa-smart-axis-grid-v21r2">${summaries}</div>
    <div class="fofa-smart-list-title-v21r2"><strong>${esc(state.fofaAxis)}</strong><span>${currentRows.length} requisito(s)</span></div>
    <div class="fofa-smart-requirements-v21r2">${rows||'<div class="empty-v111">Nenhum requisito nesta prioridade.</div>'}</div>`;

  $("refreshSmartFofaButton").onclick=refreshFofaSmart;
  qsa("[data-apply-smart]",host).forEach(b=>b.onclick=()=>applyFofaSmartSuggestion(b.dataset.applySmart));
}

async function refreshFofaSmart(){
  try{
    const payload={...currentRequest()};
    if(state.fofaCurrent?.evaluation?.avaliacao_id)payload.avaliacao_id=state.fofaCurrent.evaluation.avaliacao_id;
    await api("refresh_fofa_smart_diagnostic",payload);
    toast("Diagnóstico inteligente atualizado ✔️");
    await loadFofa({background:true});
  }catch(e){toast(e.message||"Não foi possível atualizar o diagnóstico.")}
}

async function applyFofaSmartSuggestion(requirementId){
  const card=document.querySelector(`[data-smart-req="${CSS.escape(requirementId)}"]`);
  if(!card||!state.fofaCurrent?.evaluation?.avaliacao_id)return toast("Inicie uma avaliação FOFA.");
  const target=card.querySelector("[data-smart-target]")?.value||"";
  const note=card.querySelector("[data-smart-note]")?.value||"";
  if(!target)return toast("Selecione um fator FOFA. A lista deve exibir fatores do mesmo eixo e do tipo sugerido.");
  const btn=card.querySelector("[data-apply-smart]"); btn.disabled=true; btn.textContent="Aplicando...";
  try{
    await api("apply_fofa_smart_suggestion",{...currentRequest(),
      avaliacao_id:state.fofaCurrent.evaluation.avaliacao_id,requisito_id:requirementId,fofa_item_id:target,nota:note});
    toast("Evidência aplicada à FOFA ✔️"); await loadFofa({background:true});
  }catch(e){toast(e.message||"Não foi possível aplicar a sugestão.")}
  finally{btn.disabled=false}
}



function renderFofaReadingStatus(){
  const c=state.fofaCompletion||state.fofaCurrent?.completion||{};
  const host=$("fofaReadingStatus");
  if(!host)return;
  if(!state.fofaCurrent){
    host.innerHTML='<div class="fofa-reading-empty-v22">Inicie uma avaliação para acompanhar a leitura completa da Matriz FOFA.</div>';
    return;
  }
  const axes=["Identidade","Liderança","Novas Gerações","Discipulado"];
  const types=["Força","Fraqueza","Oportunidade","Ameaça"];
  host.innerHTML=`<div class="fofa-reading-head-v22">
      <div><p class="eyebrow">LEITURA DA MATRIZ</p><h3>${c.pronto_para_concluir?"Avaliação apta para conclusão":"Avaliação em construção"}</h3>
      <p>${esc(c.regra||"")}</p></div>
      <span class="fofa-ready-badge-v22 ${c.pronto_para_concluir?"ready":"pending"}">${c.pronto_para_concluir?"✓ Pronta":"Em avaliação"}</span>
    </div>
    <div class="fofa-reading-grid-v22">
      ${axes.map(x=>`<div><span>${esc(x)}</span><strong>${Number(c.por_eixo?.[x]||0)}</strong><small>resposta(s)</small></div>`).join("")}
      ${types.map(x=>`<div><span>${esc(x)}</span><strong>${Number(c.por_tipo?.[x]||0)}</strong><small>resposta(s)</small></div>`).join("")}
    </div>
    ${(!c.pronto_para_concluir)?`<div class="fofa-reading-pending-v22">
      ${c.eixos_pendentes?.length?`<span>Prioridades pendentes: <b>${esc(c.eixos_pendentes.join(", "))}</b></span>`:""}
      ${c.quadrantes_pendentes?.length?`<span>Quadrantes pendentes: <b>${esc(c.quadrantes_pendentes.join(", "))}</b></span>`:""}
    </div>`:""}`;
}


function renderFofa(){
  const church=selectedChurch();
  const current=state.fofaCurrent;
  $("startFofaButton").disabled=!selectedChurchId();
  $("concludeFofaButton").disabled=!current || String(current.evaluation?.status||"")==="Concluído";

  if(!selectedChurchId()){
    $("fofaCurrentSummary").innerHTML='<div class="empty-v111">Selecione uma igreja para iniciar ou consultar a Matriz FOFA.</div>';
    $("fofaMatrixGrid").innerHTML="";
    return;
  }

  if(current){
    const ind=current.indices||{};
    $("fofaCurrentSummary").innerHTML=`<div><strong>${esc(church?.igreja||"")}</strong><span>${esc(current.evaluation?.tipo_ciclo||"")} · ${esc(current.evaluation?.status||"")}</span></div>
      <div class="fofa-index-chips-v21">
        <span>🔴 ${percent(ind.Identidade||0)}</span><span>🔵 ${percent(ind.Liderança||0)}</span>
        <span>🟡 ${percent(ind["Novas Gerações"]||0)}</span><span>🟢 ${percent(ind.Discipulado||0)}</span>
        <span class="fofa-total-progress-v21r1">✓ ${Number(state.fofaProgress?.answered||0)} / ${Number(state.fofaProgress?.total||state.fofaItems.length||0)} avaliados</span>
      </div>`;
  }else{
    $("fofaCurrentSummary").innerHTML='<div class="empty-v111">Nenhuma avaliação FOFA iniciada para esta igreja.</div>';
  }

  renderFofaSmartDiagnostic();
  renderFofaReadingStatus();
  qsa("[data-fofa-axis]").forEach(b=>b.classList.toggle("active",b.dataset.fofaAxis===state.fofaAxis));
  const responseMap=fofaResponseMap();
  const textKey=v=>String(v??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ");
  const items=(state.fofaItems||[]).filter(x=>textKey(x.eixo)===textKey(state.fofaAxis));
  const progress=state.fofaProgress||{};
  const axisTotal=Number(progress.axis_totals?.[state.fofaAxis]||items.length||0);
  const axisAnswered=Number(progress.axis_answered?.[state.fofaAxis]||0);
  const progressHtml=`<div class="fofa-progress-v21r1"><strong>${axisAnswered} de ${axisTotal}</strong><span>critérios avaliados em ${esc(state.fofaAxis)}</span><div><i style="width:${axisTotal?Math.round(axisAnswered/axisTotal*100):0}%"></i></div></div>`;
  const types=["Força","Fraqueza","Oportunidade","Ameaça"];
  $("fofaMatrixGrid").innerHTML=progressHtml+types.map(type=>{
    const rows=items.filter(x=>textKey(x.tipo_fofa)===textKey(type));
    return `<section class="fofa-quadrant-v21 fofa-${type.toLowerCase().replace("ç","c")}" data-fofa-type="${type}">
      <div class="fofa-quadrant-head-v21"><strong>${type.toUpperCase()}</strong><span>${type==="Força"||type==="Fraqueza"?"Ambiente interno":"Ambiente externo"}</span></div>
      ${rows.length?rows.map(item=>{
        const server=responseMap.get(String(item.fofa_item_id))||{};const draft=fofaDraftFor(item.fofa_item_id);const r=draft?{...server,...draft.values}:server;
        return `<article class="fofa-factor-v21" data-fofa-item="${item.fofa_item_id}">
          <strong>${esc(item.fator)}</strong>
          <small>${esc(item.meta_relacionada||"")}</small>
          <div class="fofa-fields-v21">
            <label><span>Nota</span><select data-fofa-field="nota"><option value="">—</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(r.nota)===n?"selected":""}>${n}</option>`).join("")}</select></label>
            <label class="wide"><span>Evidência</span><input data-fofa-field="evidencia" value="${esc(r.evidencia||"")}" placeholder="Dado, lista, percentual ou evidência observável"></label>
            <label><span>Impacto</span><select data-fofa-field="impacto">${fofaScoreOptions(r.impacto)}</select></label>
            <label><span>Urgência</span><select data-fofa-field="urgencia">${fofaScoreOptions(r.urgencia)}</select></label>
            <label><span>Governabilidade</span><select data-fofa-field="governabilidade">${fofaScoreOptions(r.governabilidade)}</select></label>
            <label><span>Alinhamento</span><select data-fofa-field="alinhamento">${fofaScoreOptions(r.alinhamento)}</select></label>
          </div>
          <div class="fofa-factor-actions-v21"><span>${r.indice_prioridade?`Prioridade: <b>${r.indice_prioridade}</b> · ${esc(r.classificacao||"")}`:""}</span><button data-save-fofa="${item.fofa_item_id}">Salvar</button></div>
        </article>`;
      }).join(""):`<div class="fofa-empty-quadrant-v21r1">Nenhum critério carregado neste quadrante.<br><small>Eixo: ${esc(state.fofaAxis)} · Tipo: ${esc(type)}</small></div>`}
    </section>`;
  }).join("");

  qsa("[data-save-fofa]").forEach(b=>{
    b.onclick=()=>saveFofaItem(b.dataset.saveFofa,{silent:false,reason:"manual"});
    updateFofaButtonState(b.dataset.saveFofa);
  });
  qsa("[data-fofa-item]").forEach(card=>{
    const itemId=card.dataset.fofaItem;
    qsa("[data-fofa-field]",card).forEach(field=>{
      const handler=()=>rememberFofaDraft(itemId);
      field.addEventListener("input",handler);
      field.addEventListener("change",handler);
    });
  });
}

function fofaScoreOptions(value){
  return '<option value="">—</option>'+[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(value)===n?"selected":""}>${n}</option>`).join("");
}

async function startFofa(){
  if(!selectedChurchId())return toast("Selecione uma igreja.");
  $("fofaStartDate").value=localTodayIso();
  $("fofaStartModal").classList.add("open");
}

async function confirmStartFofa(){
  const r=await api("start_fofa_evaluation",{
    ...currentRequest(),
    igreja_id:selectedChurchId(),
    ano:Number($("yearFilter")?.value||new Date().getFullYear()),
    tipo_ciclo:$("fofaCycleType").value,
    data_inicio:$("fofaStartDate").value
  });
  $("fofaStartModal").classList.remove("open");
  toast("Avaliação FOFA iniciada.");
  await loadFofa({background:true});
}

async function saveFofaItem(itemId,options={}){
  if(!state.fofaCurrent?.evaluation?.avaliacao_id){
    toast("Inicie uma avaliação FOFA.");
    return;
  }

  // Captura o conteúdo exatamente no momento do clique Salvar.
  const draft=fofaCaptureCard(itemId);
  if(!draft)return;

  const key=draft.key;
  const revision=Number(draft.revision||0);
  const payload={
    avaliacao_id:state.fofaCurrent.evaluation.avaliacao_id,
    fofa_item_id:itemId,
    nota:draft.values.nota||"",
    evidencia:draft.values.evidencia||"",
    impacto:draft.values.impacto||"",
    urgencia:draft.values.urgencia||"",
    governabilidade:draft.values.governabilidade||"",
    alinhamento:draft.values.alinhamento||""
  };

  // Front recebe imediatamente aquilo que o usuário decidiu salvar.
  patchLocalFofaResponse(itemId,payload,{});
  fofaSaveStatus.set(key,"saving");
  updateFofaButtonState(itemId);
  setSyncState("Sincronizando","sync");

  const promise=(async()=>{
    try{
      const r=await api("save_fofa_response",payload);

      // Não chama loadFofa()/renderFofa(): o item seguinte não perde conteúdo.
      patchLocalFofaResponse(itemId,payload,r||{});
      await verifyFofaSavedInBackground(itemId,payload,key,revision);
      return r;
    }catch(e){
      fofaSaveStatus.set(key,"error");
      updateFofaButtonState(itemId);
      setSyncState("Erro de sincronização","error");
      console.error("Erro ao salvar FOFA:",e);
      if(!options.silent)toast(e.message||"Não foi possível sincronizar o item FOFA.");
      throw e;
    }finally{
      fofaPendingSaves.delete(key);
    }
  })();

  fofaPendingSaves.set(key,promise);
  return promise;
}

async function concludeFofa(){
  if(!state.fofaCurrent?.evaluation?.avaliacao_id)return;
  try{
    await flushFofaDrafts();
  }catch(e){
    return toast(e.message);
  }
  await refreshFofaMetadataBackground();
  const answered=Number(state.fofaProgress?.answered||0),total=Number(state.fofaProgress?.total||state.fofaItems.length||0);
  if(!answered)return toast("Avaliação vazia. Registre respostas antes de concluir.");
  const c=state.fofaCompletion||state.fofaCurrent?.completion||{};
  if(c.pronto_para_concluir===false){
    const parts=[];
    if(c.eixos_pendentes?.length)parts.push("Prioridades: "+c.eixos_pendentes.join(", "));
    if(c.quadrantes_pendentes?.length)parts.push("Quadrantes: "+c.quadrantes_pendentes.join(", "));
    return toast("Avaliação incompleta. "+parts.join(" | "));
  }
  if(!confirm(`Concluir esta avaliação FOFA? ${answered} de ${total} critérios possuem resposta. Os índices e a classificação serão consolidados.`))return;
  try{
    const r=await api("conclude_fofa_evaluation",{avaliacao_id:state.fofaCurrent.evaluation.avaliacao_id});
    toast(`FOFA concluída · Índice geral ${percent(r.indice_geral||0)}`);
    await Promise.all([loadFofa({background:true}),loadFofaHistory({background:true})]);
  }catch(e){toast(e.message||"Não foi possível concluir a avaliação.")}
}

async function loadFofaHistory(options={}){
  if(!selectedChurchId()){
    state.fofaHistory=[];renderFofaHistory();return;
  }
  const r=await api("fofa_history",currentRequest());
  state.fofaHistory=r.data||[];
  renderFofaHistory();
}

function renderFofaHistory(){
  const rows=state.fofaHistory||[];
  $("fofaHistoryList").innerHTML=rows.map(x=>{
    const e=x.avaliacao||{},i=x.indices||{};
    return `<article class="fofa-history-card-v21">
      <div><strong>${esc(e.tipo_ciclo||"Avaliação FOFA")}</strong><span>${esc(e.status||"")} · ${formatDateBR(e.data_inicio)}${e.data_conclusao?` → ${formatDateBR(e.data_conclusao)}`:""}</span></div>
      <div class="fofa-history-side-v221"><div class="fofa-history-indices-v21"><span>🔴 ${percent(i.Identidade||0)}</span><span>🔵 ${percent(i.Liderança||0)}</span><span>🟡 ${percent(i["Novas Gerações"]||0)}</span><span>🟢 ${percent(i.Discipulado||0)}</span><strong>Geral ${percent(x.indice_geral||0)}</strong></div>
      <div class="fofa-history-actions-v221"><button data-fofa-view="${e.avaliacao_id}">Visualizar</button><button data-fofa-pdf="${e.avaliacao_id}">PDF</button><button data-fofa-wa="${e.avaliacao_id}">WhatsApp</button><button data-fofa-edit="${e.avaliacao_id}">Editar</button></div></div>
    </article>`;
  }).join("")||'<div class="empty-v111">Nenhum ciclo FOFA registrado.</div>';
  qsa("[data-fofa-view]").forEach(b=>b.onclick=()=>openFofaHistoryDetail(b.dataset.fofaView,false));
  qsa("[data-fofa-pdf]").forEach(b=>b.onclick=()=>openFofaHistoryDetail(b.dataset.fofaPdf,true));
  qsa("[data-fofa-wa]").forEach(b=>b.onclick=()=>shareFofaHistory(b.dataset.fofaWa));
  qsa("[data-fofa-edit]").forEach(b=>b.onclick=()=>editFofaHistory(b.dataset.fofaEdit));
}


function fofaSummaryMarkdown(detail){
  const e=detail?.evaluation||{},i=detail?.indices||{},responses=detail?.responses||[];
  const groups=["Força","Fraqueza","Oportunidade","Ameaça"].map(type=>{
    const rows=responses.filter(r=>String(r.tipo_fofa||"")===type);
    return `## ${type}\n`+(rows.length?rows.map(r=>`- **${r.eixo}** — ${r.fator||r.fofa_item_id}: nota ${r.nota||0}${r.evidencia?` — ${r.evidencia}`:""}`).join("\n"):"- Nenhum registro.");
  }).join("\n\n");
  return `# Matriz FOFA Estratégica\n\n**Ciclo:** ${e.tipo_ciclo||"Avaliação FOFA"}\n**Status:** ${e.status||""}\n**Período:** ${formatDateBR(e.data_inicio)} a ${formatDateBR(e.data_conclusao||e.data_fim||e.data_inicio)}\n\n## Índices\n- Identidade: ${percent(i.Identidade||0)}\n- Liderança: ${percent(i.Liderança||0)}\n- Novas Gerações: ${percent(i["Novas Gerações"]||0)}\n- Discipulado: ${percent(i.Discipulado||0)}\n- Geral: ${percent(detail?.indice_geral||0)}\n\n${groups}`;
}
async function openFofaHistoryDetail(id,printNow=false){
  try{
    const r=await api("get_fofa_evaluation",{avaliacao_id:id});
    const d=r.data||r;
    const md=fofaSummaryMarkdown(d);
    if(printNow){
      printStandaloneContent(`Matriz FOFA — ${selectedChurch()?.igreja||"Igreja"}`,md);
      return;
    }
    state.currentAiReport=md;state.currentReport=null;
    $("aiReportTitle").textContent=`Matriz FOFA — ${selectedChurch()?.igreja||"Igreja"}`;
    $("aiReportContext").textContent=`${d.evaluation?.tipo_ciclo||"Avaliação FOFA"} · ${d.evaluation?.status||""}`;
    $("aiReportContent").innerHTML=markdownToHtml(md);
    $("aiReportModal").classList.add("open");
  }catch(e){toast(e.message||"Não foi possível visualizar a avaliação FOFA.")}
}
async function shareFofaHistory(id){
  try{
    const r=await api("get_fofa_evaluation",{avaliacao_id:id});
    openWhatsAppApp(fofaSummaryMarkdown(r.data||r));
  }catch(e){toast(e.message||"Não foi possível compartilhar a avaliação FOFA.")}
}
async function editFofaHistory(id){
  try{
    await api("reopen_fofa_evaluation",{avaliacao_id:id});
    showReportArea("fofa");
    await loadFofa({background:false});
    toast("Avaliação FOFA reaberta para edição.");
  }catch(e){toast(e.message||"Não foi possível editar a avaliação FOFA.")}
}
function printStandaloneContent(title,md){
  const w=window.open("","_blank","noopener,noreferrer");
  if(!w)return toast("O navegador bloqueou a janela de impressão.");
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;color:#102333;line-height:1.55}h1{font-size:22px}h2{font-size:17px;margin-top:24px;border-bottom:1px solid #d8e2e7;padding-bottom:5px}footer{position:fixed;bottom:0;font-size:9px;color:#667b86}</style></head><body><div>${markdownToHtml(md)}</div><footer>Prioridades Estratégicas | DSA · ${new Date().toLocaleDateString("pt-BR")}</footer></body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),250);
}

async function loadReports(options={}){
  const before={reports:state.reports||[],difficulties:state.difficulties||[]};
  const [a,b]=await Promise.all([api("list_reports",currentRequest()),api("list_difficulties",currentRequest())]);
  const next={reports:a.data||[],difficulties:b.data||[]};state.reports=next.reports;state.difficulties=next.difficulties;enterpriseWriteV225("reports",next);cacheSet("reports",next);
  if(viewIsActiveV225("reports")&&(changedV225(before,next)||!options.background))renderReports();
  return next;
}

function standardizedReportTitle(r){
  const church=r?.igreja||selectedChurch()?.igreja||"Igreja";
  return `Relatório Estratégico — ${church} — ${formatDateBR(r?.data_inicio)} a ${formatDateBR(r?.data_fim)}`;
}
function renderReports(){
  $("reportDifficultyChecks").innerHTML=(state.difficulties||[]).map(d=>`<label class="check-v101"><input type="checkbox" value="${d.dificuldade_id}"><span>${esc(d.descricao||d.dificuldade||"")}</span></label>`).join("");
  $("reportHistoryList").innerHTML=(state.reports||[]).map(r=>`<article class="report-history-item-v111"><strong>${esc(standardizedReportTitle(r))}</strong><span>${formatDateTimeBR(r.gerado_em)}</span><div class="report-history-actions-v111"><button data-report-open="${r.relatorio_id}">Visualizar</button><button data-report-pdf="${r.relatorio_id}">PDF</button><button data-report-wa="${r.relatorio_id}">WhatsApp</button><button data-report-edit="${r.relatorio_id}">Editar</button><button class="danger-action-soft-v221" data-report-delete="${r.relatorio_id}">Excluir</button></div></article>`).join("")||'<div class="empty-v111">Nenhum relatório gerado.</div>';
  qsa("[data-report-open]").forEach(b=>b.onclick=()=>openReport(b.dataset.reportOpen));
  qsa("[data-report-pdf]").forEach(b=>b.onclick=()=>printReportById(b.dataset.reportPdf));
  qsa("[data-report-wa]").forEach(b=>b.onclick=()=>shareReport(b.dataset.reportWa));
  qsa("[data-report-edit]").forEach(b=>b.onclick=()=>editReport(b.dataset.reportEdit));
  qsa("[data-report-delete]").forEach(b=>b.onclick=()=>deleteReport(b.dataset.reportDelete));
  $("aiReportButton").disabled=false;
}

async function deleteReport(id){
  const r=state.reports.find(x=>x.relatorio_id===id);
  if(!r)return;
  const senha=prompt(`Excluir este relatório?\n\n${standardizedReportTitle(r)}\n\nDigite sua senha para confirmar:`);
  if(senha===null)return;
  if(!senha)return toast("Digite sua senha para confirmar a exclusão.");
  try{
    await api("delete_report",{relatorio_id:id,senha},{noRetry:true});
    cacheInvalidate("reports");
    await loadReports({background:true});
    toast("Relatório excluído ✔️");
  }catch(e){toast(e.message||"Não foi possível excluir o relatório.")}
}

function markdownToHtml(md){let t=esc(md||"");t=t.replace(/^### (.*)$/gm,"<h3>$1</h3>").replace(/^## (.*)$/gm,"<h2>$1</h2>").replace(/^# (.*)$/gm,"<h1>$1</h1>").replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br>");return t}
function openReport(id){const r=state.reports.find(x=>x.relatorio_id===id);if(!r)return;state.currentReport=r;state.currentAiReport=r.conteudo_completo||"";$("aiReportTitle").textContent=standardizedReportTitle(r);$("aiReportContext").textContent=`${r.igreja} · ${formatDateBR(r.data_inicio)} a ${formatDateBR(r.data_fim)}`;$("aiReportContent").innerHTML=markdownToHtml(state.currentAiReport);$("aiReportModal").classList.add("open")}
function editReport(id){const r=state.reports.find(x=>x.relatorio_id===id);if(!r)return;state.editingReportId=id;$("editingReportId").value=id;$("editingReportText").value=r.conteudo_completo||"";$("reportEditModal").classList.add("open")}
async function saveEditedReport(){
  const r=state.reports.find(x=>x.relatorio_id===state.editingReportId);if(!r)return;loading(true,"Salvando relatório...");
  try{await api("save_report",{relatorio_id:r.relatorio_id,igreja_id:r.igreja_id,data_inicio:r.data_inicio,data_fim:r.data_fim,titulo:r.titulo,conteudo_completo:$("editingReportText").value,resumo_whatsapp:r.resumo_whatsapp,resultado_geral:r.resultado_geral,status:r.status,observacoes:r.observacoes});$("reportEditModal").classList.remove("open");cacheInvalidate("reports");await loadReports({background:true});toast("Relatório atualizado.")}finally{loading(false)}
}
function openWhatsAppApp(text){
  const msg=String(text||"").trim();if(!msg)return toast("Não há conteúdo para compartilhar.");
  let fallbackTimer=null;
  const cancel=()=>{if(document.hidden&&fallbackTimer){clearTimeout(fallbackTimer);fallbackTimer=null}};
  document.addEventListener("visibilitychange",cancel,{once:true});
  fallbackTimer=setTimeout(()=>{window.open("https://api.whatsapp.com/send?text="+encodeURIComponent(msg),"_blank","noopener")},900);
  window.location.href="whatsapp://send?text="+encodeURIComponent(msg);
}
function reportPrintHtml(r){
  const content=markdownToHtml(r?.conteudo_completo||state.currentAiReport||"");
  const church=r?.igreja||selectedChurch()?.igreja||"Igreja";
  const district=r?.distrito||currentDistrictName(r?.distrito_id)||"";
  const title=r?.titulo||"Relatório Estratégico";
  const start=formatDateBR(r?.data_inicio||state.context.data_inicio),end=formatDateBR(r?.data_fim||state.context.data_fim);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:18mm 16mm 22mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#102333;font-size:11pt;line-height:1.55;margin:0}header{border-bottom:2px solid #102333;padding-bottom:12px;margin-bottom:24px}header .brand{font-weight:800;font-size:16pt}header .field{font-size:9pt;letter-spacing:.08em;text-transform:uppercase;color:#607784}h1{font-size:19pt;margin:14px 0 4px}h2{font-size:15pt;margin-top:24px;border-bottom:1px solid #d7e2e7;padding-bottom:5px}h3{font-size:12pt;margin-top:18px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;background:#f3f7f8;padding:12px;border-radius:8px;margin-bottom:24px}.content{padding-bottom:28mm}footer{position:fixed;left:0;right:0;bottom:0;border-top:1px solid #ccd9de;padding-top:7px;font-size:8.5pt;color:#607784;display:flex;justify-content:space-between}strong{color:#102333}@media print{button{display:none}}</style></head><body><header><div class="field">${esc(window.APP_CONFIG?.FIELD||"Missão Oeste do Pará")}</div><div class="brand">Prioridades Estratégicas | DSA</div><h1>${esc(title)}</h1></header><section class="meta"><div><strong>Igreja:</strong> ${esc(church)}</div><div><strong>Distrito:</strong> ${esc(district||"—")}</div><div><strong>Período:</strong> ${start} a ${end}</div><div><strong>Gerado em:</strong> ${formatDateTimeBR(r?.gerado_em||new Date().toISOString())}</div></section><main class="content">${content}</main><footer><span>Prioridades Estratégicas | DSA · ${esc(window.APP_CONFIG?.FIELD||"")}</span><span>Relatório gerado pelo sistema</span></footer><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`;
}
function printReportObject(r){
  if(!r)return toast("Selecione ou gere um relatório.");
  const w=window.open("","_blank");if(!w)return toast("Permita pop-ups para imprimir o relatório.");
  w.document.open();w.document.write(reportPrintHtml(r));w.document.close();
}
function printReportById(id){printReportObject(state.reports.find(x=>x.relatorio_id===id))}
async function shareReport(id){const r=state.reports.find(x=>x.relatorio_id===id);if(!r)return;openWhatsAppApp(r.resumo_whatsapp||r.conteudo_completo||r.titulo)}
async function generateAI(){
  const churchId=selectedChurchId();

  if(!churchId){
    toast("Selecione uma igreja específica antes de gerar o relatório.");
    return;
  }

  const church=selectedChurch();
  const btn=$("aiReportButton");

  // Feedback imediato: o usuário precisa saber que o clique foi recebido.
  state.currentAiReport="";
  state.currentReport=null;

  $("aiReportModal").classList.add("open");
  $("aiReportLoading").classList.remove("hidden");
  $("aiReportContent").innerHTML="";
  $("aiReportTitle").textContent="Gerando Relatório Estratégico...";
  $("aiReportContext").textContent=
    `${church?.igreja||""} · ${formatDateBR(state.context.data_inicio)} a ${formatDateBR(state.context.data_fim)}`;

  setAiPriorityProgress(1,"Preparando a análise estratégica...","Validando o Gemini e organizando os dados da igreja.");

  btn.disabled=true;
  btn.textContent="✦ Gerando relatório...";
  setSyncState("Gerando relatório com IA","sync");

  let progressTimer=null;
  let elapsed=0;

  try{
    // Valida configuração antes da operação longa.
    const status=await api("ai_status",{}, {noRetry:false});

    if(!status.configured){
      throw new Error("A chave GEMINI_API_KEY não está configurada no Apps Script.");
    }

    setAiPriorityProgress(2,"Analisando os dados da igreja...",`Gemini ${status.model||""} · consolidando Identidade e Liderança.`);

    progressTimer=setInterval(()=>{
      elapsed+=10;
      if(elapsed<30){
        setAiPriorityProgress(2,"Analisando indicadores...","Consolidando metas, resultados e dificuldades.");
      }else if(elapsed<60){
        setAiPriorityProgress(3,"Construindo o diagnóstico...","Relacionando Novas Gerações às prioridades estratégicas.");
      }else{
        setAiPriorityProgress(4,"Finalizando recomendações...","Consolidando Discipulado, plano de ação e síntese executiva.");
      }
    },10000);

    const difficulty_ids=qsa("#reportDifficultyChecks input:checked").map(x=>x.value);

    const r=await api(
      "generate_ai_report",
      {
        ...currentRequest(),
        igreja_id:churchId,
        dificuldades:difficulty_ids,
        salvar:true
      },
      {noRetry:true}
    );

    const report=r.report||r.data||r;
    const content=String(report.conteudo_completo||report.report||"").trim();

    if(!content){
      throw new Error("O relatório foi concluído, mas nenhum texto foi retornado.");
    }

    finishAiPriorityProgress();
    state.currentAiReport=content;
    state.currentReport={
      ...report,
      igreja:church?.igreja||"",
      igreja_id:churchId,
      distrito_id:church?.distrito_id||"",
      distrito:currentDistrictName(church?.distrito_id),
      data_inicio:state.context.data_inicio,
      data_fim:state.context.data_fim
    };

    $("aiReportTitle").textContent=report.titulo||"Relatório Estratégico";
    $("aiReportContext").textContent=
      `${church?.igreja||""} · ${formatDateBR(state.context.data_inicio)} a ${formatDateBR(state.context.data_fim)}`;
    $("aiReportContent").innerHTML=markdownToHtml(content);

    toast("Relatório gerado e registrado com sucesso.");
    setSyncState("Conectado","ok");

    // O histórico sincroniza depois. Não prende a conclusão da IA.
    cacheInvalidate("reports");
    loadReports({background:true}).catch(e=>console.warn("Histórico:",e));

  }catch(e){
    console.error("Erro ao gerar relatório IA:",e);

    $("aiReportTitle").textContent="Não foi possível gerar o relatório";
    $("aiReportContent").innerHTML=
      `<div class="inline-message report-ai-error-r2">
        <strong>Erro na geração do relatório.</strong><br>
        ${esc(e.message||"Falha desconhecida ao comunicar com o Gemini.")}
      </div>`;

    toast(e.message||"Não foi possível gerar o relatório.");
    setSyncState("Erro na geração de IA","error");

  }finally{
    if(progressTimer)clearInterval(progressTimer);
    $("aiReportLoading").classList.add("hidden");
    btn.disabled=false;
    btn.textContent="✦ Gerar Relatório Completo com IA";
  }
}
async function whatsappSummary(){try{const r=await api("whatsapp_summary",currentRequest());openWhatsAppApp(r.texto||r.text||r.resumo||r.data||"")}catch(e){toast(e.message)}}
function exportCSV(){const rows=state.results||[];if(!rows.length)return toast("Nenhum resultado carregado.");const keys=["igreja","data_realizacao","prioridade","titulo","alcancado","plano_acao","responsavel"];const csv=[keys,...rows.map(r=>keys.map(k=>r[k]??""))].map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv"}));a.download="prioridades-dsa.csv";a.click();URL.revokeObjectURL(a.href)}

async function loadDeveloper(options={}){
  const before=(state.users||[]).slice();const r=await api("developer_bootstrap",currentRequest());const developer=r.data||r;const next=developer.usuarios||[];
  state.developer=developer;
  state.users=next;enterpriseWriteV225("developer",{users:next});cacheSet("developer",next);
  if(viewIsActiveV225("admin")&&(changedV225(before,next)||!options.background))renderUsers();
  return next;
}
function renderUsers(){const q=($("userSearch").value||"").toLowerCase(),rows=state.users.filter(u=>`${u.nome} ${u.login} ${u.perfil}`.toLowerCase().includes(q));$("usersCount").textContent=`${rows.length} usuário${rows.length===1?"":"s"}`;$("usersTableBody").innerHTML=rows.map(u=>`<tr><td><strong>${esc(u.nome)}</strong></td><td>${esc(u.perfil)}</td><td>${esc(u.polo_id||"")} / ${esc(u.distrito_id||"")} / ${esc(u.igreja_id||"")}</td><td>${esc(u.login)}</td><td>••••••</td><td><span class="access-pill ${u.ativo?"active":"inactive"}"><i></i>${u.ativo?"Ativo":"Inativo"}</span></td><td><div class="user-actions"><button class="user-action edit" data-user="${u.usuario_id}">Editar</button><button class="user-action toggle" data-toggle="${u.usuario_id}">${u.ativo?"Inativar":"Ativar"}</button></div></td></tr>`).join("");qsa("[data-user]").forEach(b=>b.onclick=()=>openUser(b.dataset.user));qsa("[data-toggle]").forEach(b=>b.onclick=()=>toggleUser(b.dataset.toggle))}
function populateUserTerritory(u={}){
  $("userPoleInput").innerHTML='<option value="">—</option>'+state.scope.polos.map(x=>`<option value="${x.polo_id}">${esc(x.polo)}</option>`).join("");
  $("userDistrictInput").innerHTML='<option value="">—</option>'+state.scope.distritos.map(x=>`<option value="${x.distrito_id}">${esc(x.distrito)}</option>`).join("");
  $("userChurchInput").innerHTML='<option value="">—</option>'+state.scope.igrejas.map(x=>`<option value="${x.igreja_id}">${esc(x.igreja)}</option>`).join("");
  $("userPoleInput").value=u.polo_id||"";$("userDistrictInput").value=u.distrito_id||"";$("userChurchInput").value=u.igreja_id||"";
}
async function openUser(id=""){
  try{
  let detail=null,userModules=[];if(id){const r=await api("get_user_admin",{usuario_id:id});detail=r.data||r;userModules=detail.modules||[];detail=detail.user||detail}
  const u=detail||{};$("editingUserId").value=id;$("userModalTitle").textContent=id?"Editar usuário":"Novo usuário";$("userNameInput").value=u.nome||"";$("userRoleInput").value=u.perfil||"Secretário(a)";$("userLoginInput").value=u.login||"";$("userPasswordInput").value="";$("userPhotoInput").value="";$("userPhotoCurrentV20").textContent=u.foto_url?"Foto atual cadastrada ✔️":"Nenhuma foto cadastrada";$("userPhotoCurrentV20").title=u.foto_url||"";$("userActiveInput").value=String(u.ativo!==false);populateUserTerritory(u);
  const modulesBase=(state.developer?.modulos||[]);
  const permittedIds=new Set(userModules.filter(x=>x.permitido===true||["true","1","sim","ativo"].includes(String(x.permitido||"").toLowerCase())).map(x=>String(x.modulo_id||"")));
  const legacyModules=new Set(String(u.modulos_legado||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean));
  const isDeveloper=String(u.perfil||"").toLowerCase()==="desenvolvedor";
  const isPermitted=m=>permittedIds.has(String(m.modulo_id||""))||(!permittedIds.size&&legacyModules.has(String(m.modulo||"").trim().toLowerCase()))||(!permittedIds.size&&!legacyModules.size&&isDeveloper);
  $("userModulesChecks").innerHTML=modulesBase.map(m=>`<label class="check-v101"><input type="checkbox" value="${m.modulo_id}" ${id?(isPermitted(m)?"checked":""):"checked"}><span>${esc(m.titulo||m.modulo)}</span></label>`).join("");
  $("deleteUserButtonV222")?.classList.toggle("hidden",!id);$("saveUserButton").textContent="Salvar";
  $("userModal").classList.add("open");
  document.body.classList.add("modal-open-v118");
  const card=$("userModal").querySelector(".user-modal-card");if(card)card.scrollTop=0;
  }catch(e){toast(e.message||"Não foi possível abrir o cadastro de usuário.");console.error(e)}
}
async function saveUser(){
  const reauthToken=await reauth();
  if(!reauthToken)return;

  const btn=$("saveUserButton");
  const modulos=qsa("#userModulesChecks input").map(x=>({modulo_id:x.value,permitido:x.checked}));
  const payload={
    usuario_id:$("editingUserId").value,
    nome:$("userNameInput").value.trim(),
    login:$("userLoginInput").value.trim(),
    senha:$("userPasswordInput").value,
    perfil:$("userRoleInput").value,
    polo_id:$("userPoleInput").value,
    distrito_id:$("userDistrictInput").value,
    igreja_id:$("userChurchInput").value,
    ativo:$("userActiveInput").value==="true",
    modulos
  };

  if(!payload.nome||!payload.login)return toast("Preencha nome e login.");

  btn.disabled=true;
  btn.textContent="Salvando...";
  setSyncState("Salvando usuário","sync");

  try{
    const r=await api("save_user_admin",payload);
    const id=r.usuario_id||payload.usuario_id;

    const file=$("userPhotoInput").files[0];
    if(file){
      const dataUrl=await fileBase64(file);
      await api("upload_user_photo_admin",{
        usuario_id:id,
        nome_arquivo:file.name,
        mime_type:file.type,
        arquivo_base64:dataUrl.split(",")[1]
      },{noRetry:true});
    }

    cacheInvalidate("developer");
    await loadDeveloper({background:true});
    btn.textContent="Salvo ✔️";
    toast("Usuário salvo e sincronizado com a Planilha-Mestre.");
    setSyncState("Conectado","ok");

    // Fecha automaticamente após confirmação da gravação.
    setTimeout(()=>closeModalById("userModal"),250);
  }catch(e){
    btn.textContent="Salvar";
    toast(e.message||"Não foi possível salvar o usuário.");
    setSyncState("Erro de sincronização","error");
  }finally{
    btn.disabled=false;
    if(btn.textContent!=="Salvo ✔️")btn.textContent="Salvar";
  }
}

async function deleteUserV222(){
  const id=$("editingUserId")?.value||"";
  if(!id)return toast("Nenhum usuário selecionado.");

  const target=state.users.find(x=>String(x.usuario_id)===String(id));
  if(!await confirmDeleteUserV222(target?.nome||id))return;

  const reauthToken=await reauth();
  if(!reauthToken)return;

  const btn=$("deleteUserButtonV222");
  if(btn){btn.disabled=true;btn.textContent="Excluindo..."}

  try{
    const result=await api("delete_user_admin",{usuario_id:id,reauth_token:reauthToken},{noRetry:true});
    if(result?.deleted!==true)throw new Error("A exclusão do usuário não foi confirmada.");
    closeModalById("userModal");
    cacheInvalidate("developer");
    await loadDeveloper({background:true});
    setSyncState("Conectado","ok");toast("Usuário excluído e registrado no histórico.");
  }catch(e){
    setSyncState("Erro de sincronização","error");toast(e.message||"Não foi possível excluir o usuário.");console.error(e);
  }finally{
    if(btn){btn.disabled=false;btn.textContent="Excluir usuário"}
  }
}

function confirmDeleteUserV222(name){
  const modal=$("deleteUserConfirmModal"),text=$("deleteUserConfirmText"),button=$("confirmDeleteUserButton"),cancel=$("cancelDeleteUserButton");
  if(!modal||!text||!button||!cancel)return Promise.resolve(false);
  text.textContent=`Você tem certeza que deseja excluir definitivamente o usuário "${name}"? Esta ação não pode ser desfeita.`;
  modal.classList.add("open");
  return new Promise(resolve=>{
    let settled=false;
    const close=modal.querySelector('[data-close="deleteUserConfirmModal"]');
    const finish=value=>{if(settled)return;settled=true;button.onclick=null;cancel.onclick=null;if(close)close.onclick=null;closeModalById("deleteUserConfirmModal");resolve(value)};
    button.onclick=()=>finish(true);cancel.onclick=()=>finish(false);if(close)close.onclick=()=>finish(false);
  });
}

function fileBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsDataURL(file)})}
async function toggleUser(id){
  const reauthToken=await reauth();
  if(!reauthToken)return;
  const u=state.users.find(x=>x.usuario_id===id);
  if(!u)return;

  setSyncState("Atualizando acesso","sync");
  try{
    const result=await api(u.ativo?"deactivate_user_admin":"reactivate_user_admin",{
      usuario_id:id,
      reauth_token:reauthToken
    });
    if(u.ativo&&result?.inactive!==true)throw new Error("A inativação do usuário não foi confirmada.");
    if(!u.ativo&&result?.active!==true)throw new Error("A reativação do usuário não foi confirmada.");
    cacheInvalidate("developer");
    await loadDeveloper({background:true});
    toast(u.ativo?"Usuário inativado e registrado no histórico.":"Usuário reativado e registrado no histórico.");
    setSyncState("Conectado","ok");
  }catch(e){
    setSyncState("Erro de sincronização","error");
    toast(e.message);
  }
}

function toggleSidebar(){
  document.body.classList.toggle("sidebar-collapsed");
  localStorage.setItem("sidebarCollapsed",document.body.classList.contains("sidebar-collapsed")?"1":"0");
}
async function presentation(){
  try{
    if(!document.fullscreenElement)await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  }catch(e){toast("Não foi possível alternar o modo apresentação.")}
}
let deferredPrompt=null;
function setupPWA(){
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e});
  const install=$("installButton");
  if(install)install.onclick=async()=>{
    if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}
    else $("installHelpModal")?.classList.add("open")
  };
  if("serviceWorker" in navigator)navigator.serviceWorker.register("./service-worker.js",{scope:"./"}).catch(console.warn);
}

function closeModalById(id){
  const modal=$(id);
  if(!modal)return;
  modal.classList.remove("open");
  if(id==="userModal"){
    document.body.classList.remove("modal-open-v118");
    if($("saveUserButton"))$("saveUserButton").textContent="Salvar";
  }
}

function bindReportAIDelegation(){
  document.addEventListener("click",e=>{
    const ai=e.target.closest("#aiReportButton");
    if(!ai)return;
    e.preventDefault();
    if(ai.dataset.aiRunning==="1")return;
    ai.dataset.aiRunning="1";
    Promise.resolve(generateAI()).finally(()=>{ai.dataset.aiRunning="0"});
  });
}

function bindAdminDelegation(){
  document.addEventListener("click",e=>{
    const close=e.target.closest("[data-close]");
    if(close){e.preventDefault();e.stopPropagation();closeModalById(close.dataset.close);return}

    const newUser=e.target.closest("#newUserButton");
    if(newUser){e.preventDefault();openUser();return}

    const edit=e.target.closest("[data-user]");
    if(edit){e.preventDefault();openUser(edit.dataset.user);return}

    const toggle=e.target.closest("[data-toggle]");
    if(toggle){e.preventDefault();toggleUser(toggle.dataset.toggle);return}
  });

  $("userModal")?.addEventListener("click",e=>{
    if(e.target===$("userModal"))closeModalById("userModal");
  });
}
function bind(){
  bindClick("loginButton",login);
  ["loginEmail","loginCode"].forEach(id=>{
    const el=$(id);if(el)el.addEventListener("keydown",e=>{if(e.key==="Enter")login()});
  });
  bindClick("logoutButton",logout);

  qsa(".nav-button[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
  bindClick("prioritiesToggle",()=>$("prioritySubmenu")?.classList.toggle("open"));
  qsa("[data-priority]").forEach(b=>b.onclick=()=>openPriority(b.dataset.priority));

  bindChange("poleFilter",()=>{fillDistricts();fillChurches();uiStateWrite()});
  bindChange("districtFilter",()=>{fillChurches();uiStateWrite()});
  bindChange("churchFilter",uiStateWrite);
  bindChange("periodMode",()=>{updatePeriodVisibility();uiStateWrite()});
  ["yearSingle","monthSingle","yearStart","yearEnd","monthStart","monthEnd","dateStart","dateEnd"]
    .forEach(id=>bindChange(id,uiStateWrite));
  bindClick("applyFiltersButton",applyFilters);

  bindClick("sidebarLogoButton",toggleSidebar);
  bindClick("mobileMenu",()=>$("sidebar")?.classList.toggle("open"));
  bindClick("moduleRefreshButton",refreshCurrentModule);
  bindClick("presentationButton",presentation);

  bindChange("criteriaStatusFilter",renderPriorities);
  ["goalInputV51","reachedInputV51"].forEach(id=>bindInput(id,updateLive));
  ["actionPlanV51","reachedInputV51","responsibleInputV51","dateInputV51","dateEndInputV222","voteInputV51","materialInputV51"]
    .forEach(id=>{
      bindInput(id,()=>{if(id==="reachedInputV51")updateLive();rememberCriterionDraft()});
      bindChange(id,()=>{if(id==="reachedInputV51")updateLive();rememberCriterionDraft()});
    });
  bindClick("saveCriterionV51",saveCriterion);

  bindClick("newTaskButton",()=>openTaskModal());
  bindClick("saveTask",saveTask);
  bindClick("deleteTask",deleteTask);

  bindClick("newRequirementButton",()=>openRequirement());
  bindClick("saveRequirementButton",saveRequirement);
  bindInput("requirementSearch",renderRequirements);
  bindClick("saveGoalButton",saveGoal);
  bindClick("resetGoalButton",resetGoal);

  bindClick("saveChurchProfileButton",saveMyChurch);
  bindClick("saveChurchProfileButtonBottom",saveMyChurch);

  bindClick("printAiReportButton",()=>printReportObject(state.currentReport||state.reports[0]));
  bindClick("shareAiReportButton",()=>openWhatsAppApp(state.currentReport?.resumo_whatsapp||state.currentAiReport));
  bindClick("whatsappButton",whatsappSummary);
  bindClick("excelButton",exportCSV);
  bindClick("pdfButton",()=>printReportObject(state.currentReport||state.reports[0]));
  bindClick("emailButton",()=>toast("Envio por e-mail será conectado em atualização posterior."));
  bindClick("saveEditedReportButton",saveEditedReport);

  qsa("[data-report-area]").forEach(b=>b.onclick=()=>showReportArea(b.dataset.reportArea));
  qsa("[data-fofa-axis]").forEach(b=>b.onclick=()=>{state.fofaAxis=b.dataset.fofaAxis;renderFofa()});
  bindClick("startFofaButton",startFofa);
  bindClick("confirmStartFofaButton",confirmStartFofa);
  bindClick("concludeFofaButton",concludeFofa);

  bindClick("saveUserButton",saveUser);
  bindClick("deleteUserButtonV222",deleteUserV222);
  bindInput("userSearch",renderUsers);

  bindChange("rankingLevel",()=>{
    cacheInvalidate("dashboard");
    setSyncState("Atualizando ranking","sync");
    loadDashboard({background:true})
      .then(()=>setSyncState("Conectado","ok"))
      .catch(e=>{setSyncState("Erro de sincronização","error");toast(e.message)});
  });
  bindChange("rankingLimitV20",()=>{
    if(state.dashboard)renderDashboard(state.dashboard);
  });

  bindAdminDelegation();
  bindReportAIDelegation();

  if($("closeInstallHelpButton")){
    $("closeInstallHelpButton").onclick=()=>$("installHelpModal")?.classList.remove("open");
  }

  window.addEventListener("beforeunload",()=>{
    uiStateWrite();
    sessionMapWrite("prioridades_criterion_drafts",criterionDrafts);
    sessionMapWrite("prioridades_fofa_drafts",fofaDrafts);
  });
}
async function init(){
  setupPeriod();
  bind();
  setupPWA();
  if($("userSearch"))$("userSearch").value="";
  if($("activePasswordInput"))$("activePasswordInput").value="";

  if(localStorage.getItem("prioridades_cache_schema")!=="10"){
    [
      "bootstrap","dashboard","priorities","planner",
      "timeline","reports","requirements","myChurch","developer"
    ].forEach(name=>localStorage.removeItem(`prioridades_cache_${name}`));

    localStorage.setItem("prioridades_cache_schema","10");
    cacheInvalidate();
  }

  if(localStorage.getItem("sidebarCollapsed")==="1"){
    document.body.classList.add("sidebar-collapsed");
  }

  if(await restore()){
    startApp();
    applyModules();
    renderProfile();

    // Com snapshot, F5 retorna imediatamente à tela anterior.
    if(state.scope?.igrejas?.length||state.scope?.distritos?.length||state.scope?.polos?.length){
      setupTerritory();
      restoreUiControls();
      await restoreUiView();
    }

    bootstrap({background:true})
      .then(async()=>{
        authSnapshotWrite();
        restoreUiControls();
        await restoreUiView();
      })
      .catch(e=>{
        setSyncState("Erro de sincronização","error");
        toast(e.message);
      });
  }
}
document.addEventListener("DOMContentLoaded",init);
})();
