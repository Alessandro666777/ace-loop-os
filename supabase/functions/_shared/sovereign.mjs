export const VERSION="sovereign.runtime.v1";
export const SAFE_MODES=new Set(["DRY_RUN","SHADOW"]);

export const LOOPS={
  partner:[
    ["JOIN","joined"],["ONBOARD","onboarding_completed"],["LEARN","training_completed"],
    ["ACT","action_logged"],["REPORT","result_reported"],["IMPROVE","feedback_applied"],
    ["PRODUCE","productive_outcome"],["AUTONOMOUS","autonomy_verified"],["LEAD","leadership_started"]
  ],
  company:[
    ["GOAL","goal_defined"],["KPI","kpis_present"],["BOTTLENECK","bottleneck_identified"],
    ["INTERVENTION","intervention_defined"],["EXECUTION","execution_started"],
    ["RESULT","result_measured"],["LEARNING","learning_recorded"]
  ],
  panthera:[
    ["OBSERVE","observed"],["GAP","gap_defined"],["PROPOSE","proposal_ready"],["BUILD","built"],
    ["TEST","tests_passed"],["VERIFY","verified"],["DEPLOY","deployed"],
    ["MEASURE","measured"],["KEEP_ROLLBACK","decision_recorded"]
  ]
};

export const WORKERS={
  reality_scout:["Read current state and surface missing evidence.",["read_state","retrieve_knowledge","read_evidence"]],
  onboarding_coach:["Guide the next onboarding step without replacing human confirmation.",["read_state","retrieve_knowledge","propose_mission"]],
  mastery_coach:["Translate a capability gap into drill, field test and evidence.",["read_state","retrieve_knowledge","propose_training"]],
  mission_designer:["Produce the smallest next real-world action and definition of done.",["read_state","retrieve_knowledge","propose_mission"]],
  evidence_collector:["Request outcome evidence and normalize aggregate/non-PII signals.",["read_state","read_evidence","propose_evidence_request"]],
  learning_analyst:["Compare expected vs observed and propose the smallest model update.",["read_state","read_evidence","retrieve_knowledge","propose_learning"]],
  bottleneck_analyst:["Find the earliest broken edge in the active loop.",["read_state","read_evidence","retrieve_knowledge","propose_bottleneck"]],
  metric_designer:["Define the minimum KPI set required to falsify the current hypothesis.",["read_state","retrieve_knowledge","propose_metrics"]],
  intervention_designer:["Design a reversible intervention tied to a bottleneck and metric.",["read_state","retrieve_knowledge","propose_intervention"]],
  executor:["Translate an approved intervention into bounded execution tasks.",["read_state","retrieve_knowledge","propose_execution_tasks"]],
  system_auditor:["Inspect PANTHERA runtime health, drift and unclosed loops.",["read_state","retrieve_knowledge","read_evidence","propose_gap"]],
  architect:["Produce the smallest complete patch proposal; never create a parallel system.",["read_state","retrieve_knowledge","propose_patch"]],
  builder:["Prepare a bounded build task for the existing execution engine.",["read_state","retrieve_knowledge","propose_build_task"]],
  verifier:["Test claims against acceptance criteria and regression evidence.",["read_state","read_evidence","retrieve_knowledge","propose_test"]],
  red_team:["Attack assumptions, hidden downside, regressions and fragile elegance.",["read_state","read_evidence","retrieve_knowledge","propose_countercheck"]],
  governor:["Prepare keep/rollback evidence; final promotion remains human-gated.",["read_state","read_evidence","propose_governance_decision"]],
  leadership_coach:["Move a proven contributor toward repeatable leadership transfer.",["read_state","retrieve_knowledge","propose_training"]]
};

const STAGE_WORKERS={
  partner:{
    JOIN:["reality_scout"],ONBOARD:["onboarding_coach"],LEARN:["mastery_coach","verifier"],
    ACT:["mission_designer"],REPORT:["evidence_collector"],IMPROVE:["learning_analyst"],
    PRODUCE:["bottleneck_analyst","mission_designer"],AUTONOMOUS:["verifier","red_team"],LEAD:["leadership_coach"]
  },
  company:{
    GOAL:["reality_scout"],KPI:["metric_designer","verifier"],BOTTLENECK:["bottleneck_analyst","red_team"],
    INTERVENTION:["intervention_designer","red_team"],EXECUTION:["executor"],
    RESULT:["evidence_collector","verifier"],LEARNING:["learning_analyst"]
  },
  panthera:{
    OBSERVE:["system_auditor"],GAP:["bottleneck_analyst","red_team"],PROPOSE:["architect","red_team"],
    BUILD:["builder"],TEST:["verifier"],VERIFY:["red_team","verifier"],DEPLOY:["governor"],
    MEASURE:["system_auditor","evidence_collector"],KEEP_ROLLBACK:["governor","red_team"]
  }
};

export const HUMAN_GATES=new Set(["partner:AUTONOMOUS","panthera:DEPLOY","panthera:KEEP_ROLLBACK"]);

export function requiresHumanGate(loop,stage){
  return HUMAN_GATES.has(`${loop}:${stage}`);
}

export function canApproveHumanGate(role,loop,stage){
  if(!requiresHumanGate(loop,stage))return true;
  if(loop==="partner"&&stage==="AUTONOMOUS")return role==="founder"||role==="operator";
  if(loop==="panthera"&&(stage==="DEPLOY"||stage==="KEEP_ROLLBACK"))return role==="founder";
  return false;
}
const FORBIDDEN_KEYS=new Set([
  "lead_name","customer_name","client_name","prospect_name","first_name","last_name",
  "email","email_address","contact_email","phone","phone_number","mobile","telephone",
  "street_address","postal_address","date_of_birth","dob"
]);

export const WORKER_MODULES={
  reality_scout:["reality"],onboarding_coach:["mastery"],mastery_coach:["mastery"],
  mission_designer:["ace"],evidence_collector:["reality"],learning_analyst:["learning"],
  bottleneck_analyst:["reality","meta_conductor"],metric_designer:["reality"],
  intervention_designer:["meta_conductor"],executor:["ace"],system_auditor:["reality"],
  architect:["meta_conductor"],builder:["meta_conductor"],verifier:["reality"],
  red_team:["seven_heads"],governor:["constitution","reality"],leadership_coach:["mastery"]
};

function walkPII(value,path="payload",hits=[]){
  if(Array.isArray(value)){
    value.forEach((v,i)=>walkPII(v,`${path}[${i}]`,hits));
  }else if(value&&typeof value==="object"){
    for(const [k,v] of Object.entries(value)){
      const child=`${path}.${k}`;
      if(FORBIDDEN_KEYS.has(String(k).trim().toLowerCase()))hits.push(child);
      walkPII(v,child,hits);
    }
  }
  return hits;
}

export function rejectLeadPII(value){
  const hits=walkPII(value);
  if(hits.length)throw new Error("lead/client PII is outside Sovereign V1 planning scope: "+hits.sort().join(", "));
}

export function rejectLikelyContactPII(text){
  const s=String(text||"");
  if(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s))throw new Error("email-like PII is outside Sovereign V1 mission scope");
  if(/(?:\+?\d[\d ()/.\-]{7,}\d)/.test(s))throw new Error("phone-like PII is outside Sovereign V1 mission scope");
}

export function classifyLoop({explicitLoop=null,domain="",mission=""}={}){
  if(explicitLoop){
    const key=String(explicitLoop).trim().toLowerCase();
    if(!LOOPS[key])throw new Error("unknown loop");
    return key;
  }
  const text=`${domain} ${mission}`.toLowerCase();
  const domainKey=String(domain||"").trim().toLowerCase();
  if(/partner|onboard|training|geschäftspartner|learner/.test(text))return "partner";
  if(domainKey==="panthera"||/panthera|sovereign|control plane|runtime|orchestration|agentic/.test(String(mission||"").toLowerCase()))return "panthera";
  return "company";
}

export function currentStage(loop,state={}){
  if(!LOOPS[loop])throw new Error("unknown loop");
  for(const [stage,flag] of LOOPS[loop])if(state?.[flag]!==true)return stage;
  return null;
}

function stableHash(input){
  let h=2166136261;
  for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619)}
  return (h>>>0).toString(16).padStart(8,"0");
}

function workerContract(loop,stage,key,mission){
  const [role,capabilities]=WORKERS[key];
  const objective=`${loop}:${stage} — ${String(mission||"").trim()||"advance the loop with evidence"}`;
  return {
    contract_id:"wrk-"+stableHash(`${VERSION}|${loop}|${stage}|${key}|${objective}`),
    worker_key:key,role,objective,capabilities:[...capabilities],
    parent:"sovereign",ephemeral:true,may_spawn_workers:false,external_mutation:false,
    exit_condition:"Return evidence-backed result to Sovereign and terminate."
  };
}

export function planSovereign({state={},mission="",explicitLoop=null,domain="",mode="SHADOW"}={}){
  if(!SAFE_MODES.has(mode))throw new Error("Sovereign V1 only supports DRY_RUN or SHADOW");
  if(!state||typeof state!=="object"||Array.isArray(state))throw new Error("state must be an object");
  rejectLeadPII(state);rejectLikelyContactPII(mission);
  const loop=classifyLoop({explicitLoop,domain,mission});
  const stage=currentStage(loop,state);
  if(!stage)return {
    version:VERSION,mode,loop,status:"LOOP_COMPLETE",current_stage:null,workers:[],
    human_gate:"not_required",
    next_action:"Record final evidence and start a new hypothesis only if reality requires it.",
    evidence_required:["final_loop_evidence"]
  };
  const keys=STAGE_WORKERS[loop][stage];
  if(keys.length>3)throw new Error("worker fan-out exceeds governance limit");
  return {
    version:VERSION,mode,loop,status:"PLAN_READY",current_stage:stage,
    completion_flag:Object.fromEntries(LOOPS[loop])[stage],
    workers:keys.map(k=>workerContract(loop,stage,k,mission)),
    human_gate:requiresHumanGate(loop,stage)?"required":"not_required",
    next_action:`Run ${stage} with bounded workers; write observed evidence before advancing.`,
    evidence_required:[`${loop}.${stage.toLowerCase()}.observed`,`${loop}.${stage.toLowerCase()}.source_pointer`],
    invariants:{
      external_mutation:false,lead_pii_in_ai_plane:false,recursive_worker_spawn:false,
      max_parallel_workers:3,reality_gate_required:true
    }
  };
}
