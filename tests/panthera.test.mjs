import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const html=readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
const APP_KEY="panthera-ace.v4";
const AUTH_KEY="ace-loop-os.cloud.auth.v1";

function res(body={},status=200){
  const txt=typeof body==="string"?body:JSON.stringify(body);
  return {
    ok:status>=200&&status<300,status,
    async json(){if(body==="")return {};return typeof body==="string"?JSON.parse(body):body},
    async text(){return txt},
    clone(){return res(body,status)}
  };
}
async function boot(opts={}){
  const calls=[],alerts=[],prompts=[...(opts.prompts||[])];
  let clipboard=opts.clipboardText||"";
  const fetcher=async(url,init={})=>{
    const u=String(url);calls.push({url:u,init});
    if(opts.fetchHandler){
      const custom=await opts.fetchHandler(u,init);
      if(custom)return custom;
    }
    if(u.includes("/rest/v1/rpc/bootstrap_personal_kernel"))return res({onboarding_status:"needs_baseline",bootstrap_mode:"legacy"});
    if(u.includes("/rest/v1/rpc/claim_organization_invites"))return res([]);
    if(u.includes("/auth/v1/otp"))return res({});
    if(u.includes("/auth/v1/token"))return res({access_token:"refreshed_access",refresh_token:"refreshed_refresh",expires_in:3600,user:{id:"user-1",email:"aaamstadt@icloud.com"}});
    if(u.includes("/auth/v1/verify"))return res({access_token:"verified_access",refresh_token:"verified_refresh",expires_in:3600,user:{id:"user-1",email:"aaamstadt@icloud.com"}});
    if(u.includes("/auth/v1/user"))return res({id:"user-1",email:"aaamstadt@icloud.com"});
    if(u.includes("/rest/v1/"))return init.method&&init.method!=="GET"?res(""):res([]);
    return res({});
  };
  const dom=new JSDOM(html,{
    url:opts.url||"https://alessandro666777.github.io/ace-loop-os/",
    runScripts:"dangerously",
    pretendToBeVisual:true,
    beforeParse(w){
      try{w.crypto.randomUUID=randomUUID}catch{}
      w.fetch=fetcher;
      w.alert=m=>alerts.push(String(m));
      w.prompt=()=>prompts.length?prompts.shift():null;
      w.HTMLElement.prototype.scrollIntoView=function(){};
      if(!w.URL.createObjectURL)w.URL.createObjectURL=()=>"blob:test";
      if(!w.URL.revokeObjectURL)w.URL.revokeObjectURL=()=>{};
      Object.defineProperty(w.navigator,"clipboard",{configurable:true,value:{readText:async()=>clipboard}});
      w.__setClipboard=v=>clipboard=v;
      for(const [k,v] of Object.entries(opts.storage||{}))w.localStorage.setItem(k,typeof v==="string"?v:JSON.stringify(v));
    }
  });
  await new Promise(r=>setTimeout(r,35));
  return {dom,w:dom.window,d:dom.window.document,calls,alerts,res,close:()=>dom.window.close()};
}
function state(w){
  let key=APP_KEY;
  try{const a=JSON.parse(w.localStorage.getItem(AUTH_KEY)||"null");if(a?.user?.id)key=APP_KEY+":"+a.user.id}catch{}
  return JSON.parse(w.localStorage.getItem(key));
}
function setVal(w,id,value,event="input"){
  const el=w.document.getElementById(id);el.value=String(value);el.dispatchEvent(new w.Event(event,{bubbles:true}));return el;
}
function click(w,id){w.document.getElementById(id).click()}
function fillCommitments(w){
  setVal(w,"win","Heute messbar gewinnen");
  setVal(w,"nextMove","Ersten echten Anruf machen");
  [...w.document.querySelectorAll("#proofs .target")].forEach((el,i)=>{el.value="Commitment "+i;el.dispatchEvent(new w.Event("input",{bubbles:true}))});
}
function todayISO(){const d=new Date();return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function previousISO(){const d=new Date();d.setDate(d.getDate()-1);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function weakProofs(){return Object.fromEntries(["body","revenue","people","build","close"].map(k=>[k,{target:"x",done:false,evidence:""}]))}

test("01 fresh boot opens in LOCAL mode",async t=>{const x=await boot();t.after(x.close);assert.equal(x.d.getElementById("cloudBadge").textContent,"LOCAL")});
test("02 canonical local portfolio contains 37 goals",async t=>{const x=await boot();t.after(x.close);assert.equal(state(x.w).goals.length,37)});
test("03 only three skills are active by default",async t=>{const x=await boot();t.after(x.close);assert.equal(state(x.w).skills.filter(s=>s.active).length,3)});
test("04 TODAY exposes exactly four Tier-1 goals",async t=>{const x=await boot();t.after(x.close);assert.equal(x.w.todayGoals().length,4)});
test("05 AUTO goal selects the nearest dated Tier-1 front",async t=>{const x=await boot();t.after(x.close);assert.equal(x.w.strategicGoal("").name,"Nullpunkt 5 Kunden + 5 Partner je Person")});
test("06 AUTO skill bottleneck is relevant to AUTO goal",async t=>{const x=await boot();t.after(x.close);assert.ok(["Sales","Leadership"].includes(x.w.goalBottleneck(x.w.strategicGoal("").name).name))});
test("07 fresh day stays STANDARD without readiness data",async t=>{const x=await boot();t.after(x.close);assert.equal(x.d.getElementById("dayMode").textContent,"STANDARD DAY")});
test("08 rested high-energy day becomes ATTACK",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"sleep",8);setVal(x.w,"energy",9);setVal(x.w,"state","green");x.w.persist();assert.equal(x.d.getElementById("dayMode").textContent,"ATTACK DAY")});
test("09 low sleep forces RECOVERY",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"sleep",4.5);setVal(x.w,"energy",9);x.w.persist();assert.equal(x.d.getElementById("dayMode").textContent,"RECOVERY DAY")});
test("10 low energy forces RECOVERY",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"sleep",8);setVal(x.w,"energy",3);x.w.persist();assert.equal(x.d.getElementById("dayMode").textContent,"RECOVERY DAY")});
test("11 red state forces RECOVERY",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"sleep",8);setVal(x.w,"energy",9);setVal(x.w,"state","red");x.w.persist();assert.equal(x.d.getElementById("dayMode").textContent,"RECOVERY DAY")});
test("12 DAY COMMIT blocks missing win and next move",async t=>{const x=await boot();t.after(x.close);click(x.w,"lockDay");assert.ok(x.alerts.some(a=>a.includes("Sieg und Next Move")));assert.equal(state(x.w).entries[0].locked,false)});
test("13 DAY COMMIT blocks missing proof commitments",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"win","win");setVal(x.w,"nextMove","move");click(x.w,"lockDay");assert.ok(x.alerts.some(a=>a.includes("fünf Proof")));assert.equal(state(x.w).entries[0].locked,false)});
test("14 valid DAY COMMIT locks the day",async t=>{const x=await boot();t.after(x.close);fillCommitments(x.w);click(x.w,"lockDay");assert.equal(state(x.w).entries[0].locked,true)});
test("15 proof cannot close without evidence",async t=>{const x=await boot();t.after(x.close);const btn=x.d.querySelector("#proofs .proof button");btn.click();assert.ok(x.alerts.some(a=>a.includes("Evidence Gate")));assert.equal(state(x.w).entries[0].proofs.body.done,false)});
test("16 proof closes after evidence exists",async t=>{const x=await boot();t.after(x.close);const ev=x.d.querySelector("#proofs .proof .evidence");ev.value="Training erledigt";ev.dispatchEvent(new x.w.Event("input",{bubbles:true}));x.d.querySelector("#proofs .proof button").click();assert.equal(state(x.w).entries[0].proofs.body.done,true)});
test("17 locked day cannot unlock without reason",async t=>{const x=await boot({prompts:[null]});t.after(x.close);fillCommitments(x.w);click(x.w,"lockDay");click(x.w,"lockDay");assert.equal(state(x.w).entries[0].locked,true)});
test("18 locked day unlocks with explicit reason",async t=>{const x=await boot({prompts:["Reale Lage hat sich verändert"]});t.after(x.close);fillCommitments(x.w);click(x.w,"lockDay");click(x.w,"lockDay");assert.equal(state(x.w).entries[0].locked,false)});
test("19 NEXT MOVE without move does not emit execution event",async t=>{const x=await boot();t.after(x.close);click(x.w,"startMove");assert.equal(state(x.w).events.some(e=>e.type==="execution.next_move"),false)});
test("20 NEXT MOVE with move emits execution event",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"nextMove","Call starten");click(x.w,"startMove");assert.equal(state(x.w).events.some(e=>e.type==="execution.next_move"),true)});
test("21 weak previous day activates recovery notice",async t=>{const stored={version:4,entries:[{date:previousISO(),proofs:weakProofs()}]};const x=await boot({storage:{[APP_KEY]:stored}});t.after(x.close);assert.equal(x.d.getElementById("recoveryNotice").classList.contains("hidden"),false)});
test("22 skill selector contains AUTO plus three active skills",async t=>{const x=await boot();t.after(x.close);assert.equal(x.d.getElementById("skillFocus").options.length,4)});
test("23 goal selector contains AUTO plus four Tier-1 goals",async t=>{const x=await boot();t.after(x.close);assert.equal(x.d.getElementById("goalFocus").options.length,5)});
test("24 PROINVEST S4 bottleneck stays inside Sales/Leadership",async t=>{const x=await boot();t.after(x.close);assert.ok(["Sales","Leadership"].includes(x.w.goalBottleneck("PROINVEST S4").name))});
test("25 routine goal maps to Self-Leadership",async t=>{const x=await boot();t.after(x.close);assert.equal(x.w.goalBottleneck("Tagesroutine stabilisieren").name,"Self-Leadership")});
test("26 unverified skill is always due for retest",async t=>{const x=await boot();t.after(x.close);assert.equal(x.w.retestDue({baselineVerified:false,lastTestedAt:null}),true)});
test("27 recently verified skill is not due for retest",async t=>{const x=await boot();t.after(x.close);assert.equal(x.w.retestDue({baselineVerified:true,lastTestedAt:new Date().toISOString()}),false)});
test("28 assessment requires evidence",async t=>{const x=await boot();t.after(x.close);const sk=state(x.w).skills[0];x.w.openAssessment(sk.id);click(x.w,"saveAssessment");assert.ok(x.alerts.some(a=>a.includes("Evidence")));assert.equal(state(x.w).assessments.length,0)});
test("29 independent passing assessment verifies baseline",async t=>{const x=await boot();t.after(x.close);const sk=state(x.w).skills.find(s=>s.name==="Sales");x.w.openAssessment(sk.id);setVal(x.w,"assessmentType","apply","change");setVal(x.w,"assessmentScore",85);setVal(x.w,"assessmentDifficulty",3,"change");setVal(x.w,"assessmentIndependent","yes","change");setVal(x.w,"assessmentEvidence","Realer Verkaufscase abgeschlossen");click(x.w,"saveAssessment");assert.equal(state(x.w).skills.find(s=>s.name==="Sales").baselineVerified,true)});
test("30 assisted passing assessment does not verify baseline",async t=>{const x=await boot();t.after(x.close);const sk=state(x.w).skills.find(s=>s.name==="Leadership");x.w.openAssessment(sk.id);setVal(x.w,"assessmentType","apply","change");setVal(x.w,"assessmentScore",90);setVal(x.w,"assessmentDifficulty",3,"change");setVal(x.w,"assessmentIndependent","no","change");setVal(x.w,"assessmentEvidence","Mit starker Hilfe delegiert");click(x.w,"saveAssessment");assert.equal(state(x.w).skills.find(s=>s.name==="Leadership").baselineVerified,false)});
test("31 failed assessment lowers confidence",async t=>{const x=await boot();t.after(x.close);const sk=state(x.w).skills.find(s=>s.name==="Sales"),before=sk.confidence;x.w.openAssessment(sk.id);setVal(x.w,"assessmentScore",40);setVal(x.w,"assessmentDifficulty",2,"change");setVal(x.w,"assessmentEvidence","Test nicht bestanden");click(x.w,"saveAssessment");assert.ok(state(x.w).skills.find(s=>s.name==="Sales").confidence<before)});
test("32 review evidence increments skill evidence and independence",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"skillFocus","Sales");setVal(x.w,"skillEvidence","10 Follow-ups real durchgeführt");setVal(x.w,"evidenceQuality",4,"input");setVal(x.w,"assistanceLevel",0,"input");click(x.w,"closeReview");const st=state(x.w);assert.equal(st.evidenceItems.length,1);assert.equal(st.independenceChecks.length,1)});
test("33 pressure review records pressure evidence",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"skillFocus","Sales");setVal(x.w,"skillEvidence","Unter Ablehnung sauber weitergeführt");setVal(x.w,"pressureEvidence","yes");click(x.w,"closeReview");assert.equal(state(x.w).evidenceItems[0].type,"pressure")});
test("34 prediction without statement is blocked",async t=>{const x=await boot();t.after(x.close);click(x.w,"addPrediction");assert.ok(x.alerts.some(a=>a.includes("Vorhersage")));assert.equal(state(x.w).predictions.length,0)});
test("35 valid prediction is stored",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"predictionStatement","Termin kommt zustande");setVal(x.w,"predictionProbability",70);click(x.w,"addPrediction");assert.equal(state(x.w).predictions.length,1)});
test("36 prediction resolution stores outcome",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"predictionStatement","Termin kommt zustande");click(x.w,"addPrediction");const id=state(x.w).predictions[0].id;x.w.resolvePrediction(id,true);assert.equal(state(x.w).predictions[0].outcome,true)});
test("37 high-stakes decision is blocked with incomplete firewall",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"decisionTitle","Großer Deal");setVal(x.w,"decisionStakes","high","change");click(x.w,"saveDecision");assert.ok(x.alerts.some(a=>a.includes("Blind-Spot")));assert.equal(state(x.w).decisions.length,0)});
test("38 complete high-stakes decision saves at complexity 4",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"decisionTitle","Großer Deal");setVal(x.w,"decisionStakes","high","change");["bsVariable","bsCausal","bsBaseRate","bsActor","bsEvidence","bsSecond","decisionCounter","decisionFalsifier"].forEach(id=>setVal(x.w,id,"geprüft"));click(x.w,"saveDecision");assert.equal(state(x.w).decisions[0].complexityBudget,4)});
test("39 medium decision uses complexity 2",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"decisionTitle","Mittlere Entscheidung");setVal(x.w,"decisionStakes","medium","change");click(x.w,"saveDecision");assert.equal(state(x.w).decisions[0].complexityBudget,2)});
test("40 low reversible decision uses complexity 1",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"decisionTitle","Kleine Entscheidung");setVal(x.w,"decisionStakes","low","change");setVal(x.w,"decisionReversibility","high","change");click(x.w,"saveDecision");assert.equal(state(x.w).decisions[0].complexityBudget,1)});
test("41 brand decision routes Moon Architect",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"decisionClass","brand","change");assert.ok(x.w.routeDecision().mods.includes("Moon Architect"))});
test("42 execution decision routes ACE and Kael",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"decisionClass","execution","change");const r=x.w.routeDecision();assert.ok(r.mods.includes("ACE Execution"));assert.ok(r.lenses.includes("Kael"))});
test("43 malformed V4 local storage falls back to base",async t=>{const x=await boot({storage:{[APP_KEY]:"{broken"}});t.after(x.close);assert.equal(state(x.w).goals.length,37)});
test("44 V3 migration restores active focus skills",async t=>{const v3={entries:[],skills:[{name:"Sales",level:3},{name:"Leadership",level:2},{name:"Self-Leadership",level:3}]};const x=await boot({storage:{"ace-loop-os.v3":v3}});t.after(x.close);assert.equal(state(x.w).skills.filter(s=>s.active).length,3)});
test("45 V2 migration carries daily win forward",async t=>{const v2=[{date:todayISO(),win:"Legacy Win",nextMove:"Legacy Move"}];const x=await boot({storage:{"ace-loop-os.entries.v2":v2}});t.after(x.close);assert.equal(state(x.w).entries.find(e=>e.date===todayISO()).win,"Legacy Win")});
test("46 invalid auth email never calls OTP endpoint",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"authEmail","bad");click(x.w,"magicBtn");await new Promise(r=>setTimeout(r,10));assert.equal(x.calls.some(c=>c.url.includes("/auth/v1/otp")),false);assert.ok(x.d.getElementById("authStatus").textContent.includes("gültige E-Mail"))});
test("47 magic-link request uses GitHub Pages redirect",async t=>{const x=await boot();t.after(x.close);setVal(x.w,"authEmail","owner@example.com");click(x.w,"magicBtn");await new Promise(r=>setTimeout(r,10));const c=x.calls.find(c=>c.url.includes("/auth/v1/otp"));assert.ok(c);assert.ok(decodeURIComponent(c.url).includes("redirect_to=https://alessandro666777.github.io/ace-loop-os/"))});
test("48 implicit access-token link logs in and syncs",async t=>{const url="https://alessandro666777.github.io/ace-loop-os/#access_token=a&refresh_token=r&expires_in=3600&type=magiclink";const x=await boot({url});t.after(x.close);assert.equal(x.d.getElementById("cloudBadge").textContent,"SYNCED");assert.ok(x.w.localStorage.getItem(AUTH_KEY))});
test("49 direct verify?token link exchanges into session",async t=>{const x=await boot();t.after(x.close);await x.w.acceptMagicUrl("https://gbzoxohtdlujrfljdwfz.supabase.co/auth/v1/verify?token=abc&type=magiclink");assert.equal(x.d.getElementById("cloudBadge").textContent,"SYNCED");assert.ok(JSON.parse(x.w.localStorage.getItem(AUTH_KEY)).access_token)});
test("50 clipboard accepts direct Supabase verify link",async t=>{const x=await boot({clipboardText:"https://gbzoxohtdlujrfljdwfz.supabase.co/auth/v1/verify?token=abc&type=magiclink"});t.after(x.close);click(x.w,"pasteAndLogin");await new Promise(r=>setTimeout(r,35));assert.equal(x.d.getElementById("cloudBadge").textContent,"SYNCED")});
test("51 link from a different Supabase project is rejected",async t=>{const x=await boot();t.after(x.close);await assert.rejects(()=>x.w.acceptMagicUrl("https://otherproject.supabase.co/auth/v1/verify?token=abc&type=magiclink"))});
test("52 malformed URL is rejected",async t=>{const x=await boot();t.after(x.close);await assert.rejects(()=>x.w.acceptMagicUrl("not a url"),/ungültig/)});
test("53 Supabase URL without token is rejected",async t=>{const x=await boot();t.after(x.close);await assert.rejects(()=>x.w.acceptMagicUrl("https://gbzoxohtdlujrfljdwfz.supabase.co/auth/v1/verify?type=magiclink"),/kein Login-Token/)});
test("54 expired verification link surfaces auth error",async t=>{const x=await boot({fetchHandler:async(u)=>u.includes("/auth/v1/verify")?res({message:"Email link is invalid or has expired"},403):null});t.after(x.close);await assert.rejects(()=>x.w.acceptMagicUrl("https://gbzoxohtdlujrfljdwfz.supabase.co/auth/v1/verify?token=old&type=magiclink"),/expired/)});
test("55 clipboard garbage is rejected without network auth",async t=>{const x=await boot({clipboardText:"hello world"});t.after(x.close);click(x.w,"pasteAndLogin");await new Promise(r=>setTimeout(r,15));assert.ok(x.d.getElementById("authStatus").textContent.includes("Kein gültiger Supabase-Login-Link"))});
test("56 logout clears saved cloud session",async t=>{const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};const x=await boot({storage:{[AUTH_KEY]:auth}});t.after(x.close);click(x.w,"logoutBtn");assert.equal(x.w.localStorage.getItem(AUTH_KEY),null);assert.equal(x.d.getElementById("cloudBadge").textContent,"LOCAL")});
test("57 expired saved session refreshes successfully",async t=>{const auth={access_token:"old",refresh_token:"rr",expires_at:0,user:{id:"user-1"}};const x=await boot({storage:{[AUTH_KEY]:auth}});t.after(x.close);assert.equal(x.d.getElementById("cloudBadge").textContent,"SYNCED");assert.equal(JSON.parse(x.w.localStorage.getItem(AUTH_KEY)).access_token,"refreshed_access")});
test("58 failed refresh safely falls back to LOCAL",async t=>{const auth={access_token:"old",refresh_token:"rr",expires_at:0,user:{id:"user-1"}};const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u)=>u.includes("/auth/v1/token")?res({message:"invalid refresh"},401):null});t.after(x.close);assert.equal(x.d.getElementById("cloudBadge").textContent,"LOCAL");assert.equal(x.w.localStorage.getItem(AUTH_KEY),null)});
test("59 cloud sync can replace local goals with server truth",async t=>{const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};const remote=[{id:"g1",domain:"TEST",name:"Server Goal",status:"active",focus_tier:1,priority:5,target_value:10,current_value:2,unit:"x",deadline:null,source:"cloud"}];const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>u.includes("/rest/v1/goals?")&&(!init.method||init.method==="GET")?res(remote):null});t.after(x.close);assert.equal(state(x.w).goals.length,1);assert.equal(state(x.w).goals[0].name,"Server Goal")});
test("60 goal progress update changes current value locally",async t=>{const x=await boot({prompts:["123"]});t.after(x.close);const g=state(x.w).goals.find(g=>g.name==="PROINVEST S4");x.w.updateGoalProgress(g.id);assert.equal(state(x.w).goals.find(g=>g.name==="PROINVEST S4").current,123)});

test("61 cloud sync loads verified integration registry",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const ints=[{provider:"GitHub 777",status:"verified",last_sync_at:null,metadata:{mode:"reference_only"}},{provider:"n8n",status:"dry_run_ready",last_sync_at:null,metadata:{mode:"dry_run"}},{provider:"monday.com",status:"connection_required",last_sync_at:null,metadata:{mode:"disabled"}}];
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>u.includes("/rest/v1/integration_status?")&&(!init.method||init.method==="GET")?res(ints):null});
  t.after(x.close);
  assert.equal(x.d.getElementById("integrationVerified").textContent,"1");
  assert.equal(x.d.getElementById("integrationDry").textContent,"1");
  assert.equal(x.d.getElementById("integrationRequired").textContent,"1");
});
test("62 latest integration suite is rendered in COMMAND",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const run=[{suite:"PANTHERA Integration Lab",run_ref:"r1",cases_total:60,cases_passed:60,cases_failed:0,status:"pass",evidence_pointer:"github://run",created_at:new Date().toISOString()}];
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>u.includes("/rest/v1/integration_test_runs?")&&(!init.method||init.method==="GET")?res(run):null});
  t.after(x.close);
  assert.ok(x.d.getElementById("integrationSuite").textContent.includes("60/60 PASS"));
});
test("63 mapped ACE event is shadow-staged in integration bus",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const x=await boot({storage:{[AUTH_KEY]:auth}});
  t.after(x.close);
  await x.w.cloudEvent({id:"evt-skill-1",at:new Date().toISOString(),type:"skill.evidence",payload:{skill:"Sales",quality:4}});
  const c=x.calls.find(c=>c.url.includes("/rest/v1/integration_events_staging?")&&c.init.method==="POST");
  assert.ok(c);
  const row=JSON.parse(c.init.body)[0];
  assert.equal(row.source_event_type,"skill.evidence");
  assert.equal(row.canonical_event_type,"ace.skill.evidence");
  assert.equal(row.mode,"shadow");
  assert.equal(row.validation_status,"validated");
});
test("64 unmapped ACE event does not enter integration staging",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const x=await boot({storage:{[AUTH_KEY]:auth}});
  t.after(x.close);
  const before=x.calls.filter(c=>c.url.includes("/rest/v1/integration_events_staging?")).length;
  await x.w.cloudEvent({id:"evt-no-map",at:new Date().toISOString(),type:"execution.next_move",payload:{move:"x"}});
  const after=x.calls.filter(c=>c.url.includes("/rest/v1/integration_events_staging?")).length;
  assert.equal(after,before);
});

test("65 COMPANY navigation is present",async t=>{
  const x=await boot();t.after(x.close);
  assert.ok([...x.d.querySelectorAll(".nav button")].some(b=>b.dataset.screen==="company"));
});
test("66 company layer loads organization and shared goals",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const org=[{id:"org-1",name:"PANTHERA Core Team",slug:"panthera-core-team",status:"active",metadata:{}}];
  const members=[{user_id:"user-1",role:"owner",status:"active",share_capabilities:true,share_goals:true,share_daily_execution:false,metadata:{display_name:"Alessandro"}}];
  const goals=[{id:"cg1",name:"PROINVEST S4",domain:"PROINVEST",description:"x",status:"active",priority:5,target_value:4000000,current_value:null,unit:"BWS",deadline:"2026-12-31",owner_user_id:"user-1",evidence_required:"e",current_bottleneck:"Baseline fehlt",next_action:"Ist erfassen",next_action_due:null,human_gate_status:"not_required",metadata:{}}];
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>{
    if(u.includes("/rest/v1/organizations?"))return res(org);
    if(u.includes("/rest/v1/organization_members?"))return res(members);
    if(u.includes("/rest/v1/company_goals?"))return res(goals);
    if(u.includes("/rest/v1/company_kpis?"))return res([]);
    if(u.includes("/rest/v1/company_dependencies?"))return res([]);
    return null;
  }});
  t.after(x.close);
  assert.equal(x.d.getElementById("companyName").textContent,"PANTHERA Core Team");
  assert.equal(x.d.getElementById("companyRole").textContent,"ROLE · OWNER");
  assert.equal(x.d.getElementById("companyActiveGoals").textContent,"1");
  assert.ok(x.d.getElementById("companyGoals").textContent.includes("PROINVEST S4"));
});
test("67 company members default to private daily execution",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const org=[{id:"org-1",name:"PANTHERA Core Team",slug:"panthera-core-team",status:"active",metadata:{}}];
  const members=[{user_id:"user-1",role:"owner",status:"active",share_capabilities:true,share_goals:true,share_daily_execution:false,metadata:{display_name:"Alessandro"}}];
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u)=>{
    if(u.includes("/rest/v1/organizations?"))return res(org);
    if(u.includes("/rest/v1/organization_members?"))return res(members);
    if(u.includes("/rest/v1/company_goals?")||u.includes("/rest/v1/company_kpis?")||u.includes("/rest/v1/company_dependencies?"))return res([]);
    return null;
  }});
  t.after(x.close);
  assert.ok(x.d.getElementById("companyMembers").textContent.includes("daily private"));
  assert.equal(members[0].share_daily_execution,false);
});
test("68 local mode exposes no private company data",async t=>{
  const x=await boot();t.after(x.close);
  x.w.show("company");
  assert.equal(x.d.getElementById("companyMembersChip").textContent,"MEMBERS · 0");
  assert.ok(x.d.getElementById("companyGoals").textContent.includes("Cloud-Login"));
});

test("69 login request does not expose invite membership",async t=>{
  const x=await boot();
  t.after(x.close);
  setVal(x.w,"authEmail","unknown@example.com");
  click(x.w,"magicBtn");
  await new Promise(r=>setTimeout(r,15));
  const otp=x.calls.find(c=>c.url.includes("/auth/v1/otp"));
  assert.ok(otp);
  assert.equal(JSON.parse(otp.init.body).create_user,true);
  assert.equal(x.calls.some(c=>c.url.includes("can_access_panthera")),false);
});
test("70 authenticated uninvited user is rejected and session cleared",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-x",email:"unknown@example.com"}};
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>{
    if(u.includes("/rest/v1/rpc/bootstrap_personal_kernel"))return res({message:"panthera invite required"},403);
    return null;
  }});
  t.after(x.close);
  await new Promise(r=>setTimeout(r,20));
  assert.equal(x.w.localStorage.getItem(AUTH_KEY),null);
  assert.equal(x.d.getElementById("cloudBadge").textContent,"LOCAL");
});
test("71 authenticated login bootstraps kernel and claims invites",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-2",email:"tokyo@example.com"}};
  const x=await boot({storage:{[AUTH_KEY]:auth}});
  t.after(x.close);
  assert.ok(x.calls.some(c=>c.url.includes("/rest/v1/rpc/bootstrap_personal_kernel")));
  assert.ok(x.calls.some(c=>c.url.includes("/rest/v1/rpc/claim_organization_invites")));
});
test("72 non-primary user never inherits Alessandro goal portfolio",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-2",email:"tokyo@example.com"}};
  const neutralSkills=[
   {id:"s1",name:"Self-Leadership",domain:"meta",level:0,target_level:1,evidence_count:0,knowledge_level:0,capability_level:0,pressure_level:0,skill_class:"meta",confidence:.5,baseline_verified:false,next_drill:"x",next_field_test:"y",active_training:true},
   {id:"s2",name:"Communication",domain:"core",level:0,target_level:1,evidence_count:0,knowledge_level:0,capability_level:0,pressure_level:0,skill_class:"core",confidence:.5,baseline_verified:false,next_drill:"x",next_field_test:"y",active_training:true},
   {id:"s3",name:"Learning",domain:"meta",level:0,target_level:1,evidence_count:0,knowledge_level:0,capability_level:0,pressure_level:0,skill_class:"meta",confidence:.5,baseline_verified:false,next_drill:"x",next_field_test:"y",active_training:true}
  ];
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>{
    if(u.includes("/rest/v1/rpc/bootstrap_personal_kernel"))return res({onboarding_status:"needs_baseline",bootstrap_mode:"neutral_v1"});
    if(u.includes("/rest/v1/skills?")&&(!init.method||init.method==="GET"))return res(neutralSkills);
    return null;
  }});
  t.after(x.close);
  assert.equal(state(x.w).goals.length,0);
  assert.equal(state(x.w).skills.length,3);
  assert.equal(state(x.w).skills[0].knowledge,0);
});
test("73 owner can prepare privacy-safe company invite",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1",email:"aaamstadt@icloud.com"}};
  const org=[{id:"org-1",name:"PANTHERA Core Team",slug:"panthera-core-team",status:"active",metadata:{}}];
  const members=[{user_id:"user-1",role:"owner",status:"active",share_capabilities:true,share_goals:true,share_daily_execution:false,metadata:{display_name:"Alessandro"}}];
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>{
    if(u.includes("/rest/v1/organizations?"))return res(org);
    if(u.includes("/rest/v1/organization_members?"))return res(members);
    if(u.includes("/rest/v1/company_goals?")||u.includes("/rest/v1/company_kpis?")||u.includes("/rest/v1/company_dependencies?")||u.includes("/rest/v1/organization_invites?select="))return res([]);
    return null;
  }});
  t.after(x.close);
  setVal(x.w,"companyInviteEmail","tokyo@example.com");
  click(x.w,"prepareCompanyInvite");
  await new Promise(r=>setTimeout(r,30));
  const c=x.calls.find(c=>c.url.includes("/rest/v1/organization_invites")&&c.init.method==="POST");
  assert.ok(c);
  const row=JSON.parse(c.init.body)[0];
  assert.equal(row.share_capabilities,true);
  assert.equal(row.share_goals,true);
  assert.equal(row.share_daily_execution,false);
});


test("74 Knowledge Port UI is present and private-first",async t=>{
  const x=await boot();t.after(x.close);
  assert.ok(x.d.getElementById("knowledgePortStatus"));
  assert.ok(x.d.getElementById("captureKnowledge"));
  assert.ok(x.d.getElementById("knowledgeResults").textContent.includes("Cloud-Login"));
});
test("75 authenticated sync loads KnowledgeSourcePort adapters",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const sources=[
    {provider:"manual",status:"ready",adapter_version:"1.0",capabilities:{ingest:true}},
    {provider:"readwise",status:"connection_required",adapter_version:"1.0",capabilities:{sync:true}}
  ];
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>{
    if(u.includes("/rest/v1/knowledge_sources?"))return res(sources);
    if(u.includes("/rest/v1/knowledge_items?"))return res([]);
    return null;
  }});
  t.after(x.close);
  await new Promise(r=>setTimeout(r,20));
  assert.ok(x.d.getElementById("knowledgePortStatus").textContent.includes("MANUAL READY"));
  assert.ok(x.d.getElementById("knowledgePortStatus").textContent.includes("READWISE CONNECTION REQUIRED"));
});
test("76 manual Knowledge capture writes owner-private object",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const x=await boot({storage:{[AUTH_KEY]:auth}});
  t.after(x.close);
  setVal(x.w,"knowledgeTitle","Testwissen");
  setVal(x.w,"knowledgeNote","Nur privat speichern");
  click(x.w,"captureKnowledge");
  await new Promise(r=>setTimeout(r,30));
  const c=x.calls.find(c=>c.url.endsWith("/rest/v1/knowledge_items")&&c.init.method==="POST");
  assert.ok(c);
  const row=JSON.parse(c.init.body)[0];
  assert.equal(row.user_id,"user-1");
  assert.equal(row.provider,"manual");
  assert.equal(row.privacy_scope,"private");
  assert.equal(row.ingestion_status,"normalized");
});
// Knowledge Port regression gate: local render state verified.

test("77 join mode ignores legacy owner storage",async t=>{
  const legacy={version:4,kernelMode:"owner_seed",entries:[],skills:[],goals:[{id:"g",name:"OWNER ONLY",status:"active",focusTier:1,priority:5}],projects:[],events:[],predictions:[],decisions:[],assessments:[],independenceChecks:[],trainingCycles:[],evidenceItems:[]};
  const x=await boot({url:"https://alessandro666777.github.io/ace-loop-os/?join=1",storage:{[APP_KEY]:legacy}});
  t.after(x.close);
  assert.equal(state(x.w).goals.length,0);
  assert.equal(state(x.w).kernelMode,"neutral");
});
test("78 local kernels are namespaced per authenticated user",async t=>{
  const x=await boot();t.after(x.close);
  x.w.activateUserStorage({id:"owner-1"},{bootstrap_mode:"legacy"});
  const owner=JSON.parse(x.w.localStorage.getItem(APP_KEY+":owner-1"));
  assert.equal(owner.goals.length,37);
  x.w.activateUserStorage({id:"member-2"},{bootstrap_mode:"neutral_v1"});
  const member=JSON.parse(x.w.localStorage.getItem(APP_KEY+":member-2"));
  assert.equal(member.goals.length,0);
  assert.equal(member.kernelMode,"neutral");
  assert.equal(JSON.parse(x.w.localStorage.getItem(APP_KEY)).goals.length,0);
});
test("79 logout returns browser to neutral guest state",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1",email:"owner@example.com"}};
  const x=await boot({storage:{[AUTH_KEY]:auth}});
  t.after(x.close);
  await new Promise(r=>setTimeout(r,25));
  click(x.w,"logoutBtn");
  assert.equal(x.w.localStorage.getItem(AUTH_KEY),null);
  const guest=JSON.parse(x.w.localStorage.getItem(APP_KEY));
  assert.equal(guest.goals.length,0);
  assert.equal(guest.kernelMode,"neutral");
});
test("80 login form contains no hard-coded personal email",async t=>{
  const x=await boot();t.after(x.close);
  assert.equal(x.d.getElementById("authEmail").value,"");
});


test("77 Readwise controls are exposed in Knowledge Port",async t=>{
  const x=await boot();t.after(x.close);
  assert.ok(x.d.getElementById("readwiseToken"));
  assert.ok(x.d.getElementById("connectReadwise"));
  assert.ok(x.d.getElementById("syncReadwise"));
  assert.ok(x.d.getElementById("disconnectReadwise"));
});

test("78 Readwise connect uses JWT-protected edge adapter and clears token field",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>{
    if(u.includes("/functions/v1/knowledge-readwise"))return res({ok:true,connected:true});
    return null;
  }});
  t.after(x.close);
  const raw="rw-test-token-12345678901234567890";
  setVal(x.w,"readwiseToken",raw);
  click(x.w,"connectReadwise");
  await new Promise(r=>setTimeout(r,40));
  const c=x.calls.find(c=>c.url.includes("/functions/v1/knowledge-readwise")&&c.init.method==="POST");
  assert.ok(c);
  assert.equal(JSON.parse(c.init.body).action,"set_token");
  assert.equal(JSON.parse(c.init.body).token,raw);
  assert.ok(String(c.init.headers.Authorization||"").startsWith("Bearer "));
  assert.equal(x.d.getElementById("readwiseToken").value,"");
  assert.equal(x.w.localStorage.getItem("readwiseToken"),null);
});

test("79 Readwise sync never requests full HTML content from browser",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1"}};
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>{
    if(u.includes("/functions/v1/knowledge-readwise"))return res({ok:true,complete:true,items_seen:2,items_created:2,items_updated:0});
    return null;
  }});
  t.after(x.close);
  click(x.w,"syncReadwise");
  await new Promise(r=>setTimeout(r,40));
  const c=x.calls.find(c=>c.url.includes("/functions/v1/knowledge-readwise")&&c.init.method==="POST");
  assert.ok(c);
  assert.deepEqual(JSON.parse(c.init.body),{action:"sync"});
  assert.equal(x.calls.some(c=>c.url.includes("readwise.io/api/v3/list")),false);
});

test("81 join link opens Quick Start without email",async t=>{
  const x=await boot({url:"https://alessandro666777.github.io/ace-loop-os/?join=1"});
  t.after(x.close);
  assert.equal(x.d.getElementById("quickStartModal").classList.contains("hidden"),false);
  assert.equal(x.d.getElementById("authEmail").value,"");
});
test("82 Quick Start creates isolated local Tokyo kernel",async t=>{
  const x=await boot({url:"https://alessandro666777.github.io/ace-loop-os/?join=1"});
  t.after(x.close);
  setVal(x.w,"quickStartName","Tokyo");
  click(x.w,"quickStartBtn");
  const qp=JSON.parse(x.w.localStorage.getItem("panthera-ace.quick-profile.v1"));
  assert.equal(qp.name,"Tokyo");
  const q=JSON.parse(x.w.localStorage.getItem(APP_KEY+":quick:"+qp.id));
  assert.equal(q.kernelMode,"neutral");
  assert.equal(q.profileName,"Tokyo");
  assert.equal(q.goals.length,0);
  assert.equal(q.skills.filter(sk=>sk.active).length,3);
});
test("83 Quick Start survives reload on same device",async t=>{
  const first=await boot({url:"https://alessandro666777.github.io/ace-loop-os/?join=1"});
  setVal(first.w,"quickStartName","Tokyo");click(first.w,"quickStartBtn");
  setVal(first.w,"win","Tokyo Test Win");first.w.persist();
  const storage={};
  for(let i=0;i<first.w.localStorage.length;i++){const k=first.w.localStorage.key(i);storage[k]=first.w.localStorage.getItem(k)}
  first.close();
  const second=await boot({url:"https://alessandro666777.github.io/ace-loop-os/?join=1",storage});
  t.after(second.close);
  assert.equal(second.d.getElementById("quickStartModal").classList.contains("hidden"),true);
  assert.equal(second.d.querySelector(".brand p").textContent.includes("TOKYO"),true);
  assert.equal(second.d.getElementById("win").value,"Tokyo Test Win");
});
test("84 later cloud auth migrates Quick Start kernel instead of resetting",async t=>{
  const first=await boot({url:"https://alessandro666777.github.io/ace-loop-os/?join=1"});
  setVal(first.w,"quickStartName","Tokyo");click(first.w,"quickStartBtn");
  setVal(first.w,"win","Persist me");first.w.persist();
  const storage={};
  for(let i=0;i<first.w.localStorage.length;i++){const k=first.w.localStorage.key(i);storage[k]=first.w.localStorage.getItem(k)}
  first.close();
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"tokyo-user",email:"tokyo@example.com"}};
  storage[AUTH_KEY]=JSON.stringify(auth);
  const second=await boot({storage,fetchHandler:async(u,init)=>{
    if(u.includes("/rest/v1/rpc/bootstrap_personal_kernel"))return res({onboarding_status:"needs_baseline",bootstrap_mode:"neutral_v1"});
    return null;
  }});
  t.after(second.close);
  await new Promise(r=>setTimeout(r,25));
  const cloud=JSON.parse(second.w.localStorage.getItem(APP_KEY+":tokyo-user"));
  assert.equal(cloud.profileName,"Tokyo");
  assert.equal(cloud.entries.some(e=>e.win==="Persist me"),true);
});


test("85 System Integrity is private-cloud gated in local mode",async t=>{
  const x=await boot();t.after(x.close);
  assert.ok(x.d.getElementById("runSystemAudit"));
  assert.equal(x.d.getElementById("auditManifest").textContent,"CLOUD LOGIN REQUIRED");
  assert.ok(x.d.getElementById("auditFindings").textContent.includes("Login"));
});

test("86 cloud sync renders latest PANTHERA audit state",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1",email:"owner@example.com"}};
  const meta=[{manifest_version:"1.0",canonical_repo:"Alessandro666777/ace-loop-os",canonical_path:"config/panthera.system.manifest.json",canonical_blob_sha:"2e58adfd75ef8befc748e336d0a9abc92b47f8b9",architecture_freeze_until:"2026-10-31"}];
  const run=[{id:"run-1",score:84.7,status:"yellow",components_total:49,components_healthy:41,sources_total:12,sources_healthy:12,findings_total:9,freeze_blockers:3,critical_findings:0,high_findings:3,summary:{architecture_freeze_ready:false},started_at:"2026-10-03T20:33:23Z",finished_at:"2026-10-03T20:33:23Z"}];
  const findings=[{severity:"high",finding_type:"state_gap",component_key:"n8n_runtime",source_key:null,message:"n8n Runtime is present but not at its target verification state.",remediation:"Live runtime still unverified.",evidence_ref:"workflow_exports:4/4",created_at:"2026-10-03T20:33:23Z"}];
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u)=>{
    if(u.includes("/rest/v1/panthera_manifest_meta?"))return res(meta);
    if(u.includes("/rest/v1/panthera_audit_runs?"))return res(run);
    if(u.includes("/rest/v1/panthera_audit_findings?"))return res(findings);
    return null;
  }});
  t.after(x.close);
  await new Promise(r=>setTimeout(r,60));
  assert.equal(x.d.getElementById("auditScore").textContent,"84.7%");
  assert.equal(x.d.getElementById("auditBlockers").textContent,"3");
  assert.ok(x.d.getElementById("auditManifest").textContent.includes("MANIFEST 1.0"));
  assert.ok(x.d.getElementById("auditFindings").textContent.includes("n8n Runtime"));
});

test("87 PANTHERA AUDIT button invokes audit RPC",async t=>{
  const auth={access_token:"a",refresh_token:"r",expires_at:Date.now()+3600000,user:{id:"user-1",email:"owner@example.com"}};
  let ran=false;
  const x=await boot({storage:{[AUTH_KEY]:auth},fetchHandler:async(u,init)=>{
    if(u.includes("/rest/v1/rpc/run_panthera_full_audit")){ran=true;return res('"run-new"')}
    if(u.includes("/rest/v1/panthera_manifest_meta?"))return res([{manifest_version:"1.0",canonical_blob_sha:"abc12345"}]);
    if(u.includes("/rest/v1/panthera_audit_runs?"))return res(ran?[{id:"run-new",score:90,status:"green",components_total:49,components_healthy:47,sources_total:12,sources_healthy:12,findings_total:1,freeze_blockers:0,critical_findings:0,high_findings:0,summary:{architecture_freeze_ready:true},finished_at:"2026-10-03T20:40:00Z"}]:[]);
    if(u.includes("/rest/v1/panthera_audit_findings?"))return res([]);
    return null;
  }});
  t.after(x.close);
  await new Promise(r=>setTimeout(r,50));
  click(x.w,"runSystemAudit");
  await new Promise(r=>setTimeout(r,60));
  assert.equal(ran,true);
  assert.ok(x.calls.some(c=>c.url.includes("/rest/v1/rpc/run_panthera_full_audit")));
  assert.equal(x.d.getElementById("auditScore").textContent,"90.0%");
});
