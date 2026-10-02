import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.102.0";
import {
  LOOPS, classifyLoop, currentStage, planSovereign, rejectLeadPII, requiresHumanGate, canApproveHumanGate, WORKER_MODULES, VERSION
} from "../_shared/sovereign.mjs";
import {
  buildWorkerRequest, normalizeWorkerResult, containsDirectContactPII
} from "../_shared/worker-runtime.mjs";

const ALLOWED_ORIGINS=new Set([
  "https://alessandro666777.github.io","http://localhost:3000","http://127.0.0.1:3000"
]);

function cors(origin:string|null){
  const allowed=origin&&ALLOWED_ORIGINS.has(origin)?origin:"https://alessandro666777.github.io";
  return {
    "Access-Control-Allow-Origin":allowed,
    "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Content-Type":"application/json",
    "Vary":"Origin"
  };
}

function json(headers:Record<string,string>,body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers});
}

function text(v:unknown){return typeof v==="string"?v.trim():""}

async function inferCompanyState(admin:any,userId:string,domain:string,organizationId:string){
  const {data:members,error:memberErr}=await admin.from("organization_members")
    .select("organization_id,role,status").eq("user_id",userId).eq("status","active");
  if(memberErr)throw memberErr;
  const allowed=new Set((members||[]).map((m:any)=>m.organization_id));
  let orgId=organizationId&&allowed.has(organizationId)?organizationId:"";
  if(!orgId)orgId=(members||[])[0]?.organization_id||"";
  if(!orgId)return {state:{},context:{organization_id:null,goal:null,kpis:0}};

  let goalQuery=admin.from("company_goals")
    .select("id,organization_id,name,domain,status,priority,current_bottleneck,next_action,human_gate_status,metadata")
    .eq("organization_id",orgId)
    .in("status",["active","incubating"])
    .order("priority",{ascending:false}).limit(20);
  const {data:goals,error:goalErr}=await goalQuery;
  if(goalErr)throw goalErr;
  const normalized=text(domain).toUpperCase();
  const goal=(goals||[]).find((g:any)=>text(g.domain).toUpperCase()===normalized)||null;
  if(!goal)return {state:{goal_defined:false},context:{organization_id:orgId,goal:null,kpis:0}};

  const [{data:kpis,error:kpiErr},{data:events,error:eventErr}]=await Promise.all([
    admin.from("company_kpis").select("id").eq("organization_id",orgId).eq("goal_id",goal.id).limit(100),
    admin.from("company_events").select("event_type,occurred_at").eq("organization_id",orgId)
      .eq("entity_type","goal").eq("entity_id",goal.id).order("occurred_at",{ascending:false}).limit(100)
  ]);
  if(kpiErr)throw kpiErr;if(eventErr)throw eventErr;
  const eventTypes=new Set((events||[]).map((e:any)=>e.event_type));
  return {
    state:{
      goal_defined:true,
      kpis_present:(kpis||[]).length>0,
      bottleneck_identified:!!text(goal.current_bottleneck),
      intervention_defined:!!text(goal.next_action),
      execution_started:eventTypes.has("company.execution.started")||eventTypes.has("company.intervention.started"),
      result_measured:eventTypes.has("company.result.measured"),
      learning_recorded:eventTypes.has("company.learning.recorded")
    },
    context:{organization_id:orgId,goal,kpis:(kpis||[]).length}
  };
}

async function sha256(s:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

async function inferInternalLoopState(admin:any,userId:string,loop:"partner"|"panthera"){
  const prefix="panthera.sovereign."+loop+".";
  const {data,error}=await admin.from("events")
    .select("event_type,occurred_at,payload")
    .eq("user_id",userId)
    .like("event_type",prefix+"%")
    .order("occurred_at",{ascending:false})
    .limit(250);
  if(error)throw error;
  const seen=new Set((data||[]).map((e:any)=>String(e.event_type||"").slice(prefix.length)));
  const state:Record<string,boolean>={};
  for(const [,flag] of (LOOPS as any)[loop])state[flag]=seen.has(flag);
  if(loop==="partner")state.joined=true;
  return {state,context:{evidence_events:(data||[]).length}};
}

async function inferState(admin:any,userId:string,loop:string,domain:string,organizationId:string){
  if(loop==="company")return inferCompanyState(admin,userId,domain,organizationId);
  if(loop==="partner"||loop==="panthera")return inferInternalLoopState(admin,userId,loop);
  throw new Error("unknown loop");
}

async function retrieveWorkerKnowledge(
  admin:any,worker:any,mission:string,domain:string,allowedScopes:string[]
){
  const modules=WORKER_MODULES[worker.worker_key]||["meta_conductor"];
  const query=[worker.role,worker.objective,mission,domain].filter(Boolean).join("\n").slice(0,5000);
  let rows:any[]=[];
  try{
    const {data,error}=await admin.rpc("panthera_hybrid_knowledge",{
      query_text:query,query_embedding:null,allowed_scopes:allowedScopes,
      routed_modules:modules,match_count:10
    });
    if(error)throw error;
    rows=data||[];
  }catch(e){
    console.warn("sovereign worker knowledge degraded",String((e as any)?.message||e));
    const {data}=await admin.from("panthera_knowledge_chunks")
      .select("title,source_uri,scope,module,priority,version,content,metadata")
      .eq("active",true).in("scope",allowedScopes).in("module",modules)
      .order("priority",{ascending:false}).limit(8);
    rows=data||[];
  }
  let chars=0;
  const parts:string[]=[];
  for(const k of rows){
    const block="["+String(k.scope||"")+" | "+String(k.module||"")+" | "+
      String(k?.metadata?.path||k.source_uri||k.title||"")+" | v="+String(k.version||"")+"]\n"+
      String(k.content||"");
    if(chars+block.length>16000)continue;
    parts.push(block);chars+=block.length;
  }
  return {text:parts.join("\n\n--- SOURCE ---\n\n"),count:rows.length,modules};
}

async function executeWorker(args:{
  admin:any,apiKey:string,userId:string,worker:any,plan:any,state:any,
  mission:string,domain:string,allowedScopes:string[]
}){
  const {admin,apiKey,userId,worker,plan,state,mission,domain,allowedScopes}=args;
  const knowledge=await retrieveWorkerKnowledge(admin,worker,mission,domain,allowedScopes);
  const model=text(Deno.env.get("PANTHERA_AGENT_MODEL"))||"gpt-5.6-sol";
  const safetyIdentifier=(await sha256(userId)).slice(0,64);
  const requestBody=buildWorkerRequest({
    model,worker,loop:plan.loop,stage:plan.current_stage,mission,state,
    knowledge:knowledge.text,completionFlag:plan.completion_flag,safetyIdentifier
  });
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
    body:JSON.stringify(requestBody)
  });
  const raw=await response.text();
  let parsed:any={};try{parsed=JSON.parse(raw)}catch{}
  if(!response.ok)throw new Error(
    "worker_provider_"+response.status+":"+String(parsed?.error?.message||raw).slice(0,500)
  );
  const result=normalizeWorkerResult(parsed,{completionFlag:plan.completion_flag});
  if(containsDirectContactPII(result))throw new Error("worker_output_contact_pii_blocked");
  return {
    result,model:parsed.model||model,usage:parsed.usage||{},
    knowledge_count:knowledge.count,modules:knowledge.modules
  };
}

async function recordEvidence(args:{
  admin:any,userId:string,actorRole:string,humanApproved:boolean,
  loop:string,stage:string,domain:string,organizationId:string,
  evidencePointer:string,evidence:any
}){
  const {
    admin,userId,actorRole,humanApproved,loop,stage,domain,organizationId,evidencePointer,evidence
  }=args;
  rejectLeadPII(evidence||{});
  if(containsDirectContactPII(evidence||{}))throw new Error("lead/client PII is outside Sovereign evidence scope");
  if(!evidencePointer)throw new Error("evidence_pointer_required");
  const spec=(LOOPS as any)[loop] as Array<[string,string]>|undefined;
  if(!spec)throw new Error("unknown loop");
  const match=spec.find(([name])=>name===stage);
  if(!match)throw new Error("unknown stage");
  const completionFlag=match[1];
  if(requiresHumanGate(loop,stage)){
    if(!humanApproved)throw new Error("human_gate_approval_required");
    if(!canApproveHumanGate(actorRole,loop,stage))throw new Error("human_gate_role_forbidden");
  }

  if(loop==="partner"||loop==="panthera"){
    const eventType="panthera.sovereign."+loop+"."+completionFlag;
    const {data,error}=await admin.from("events").insert({
      user_id:userId,event_type:eventType,source:"panthera_sovereign",
      payload:{
        stage,completion_flag:completionFlag,evidence_pointer:evidencePointer,evidence:evidence||{},
        human_gate_approved:requiresHumanGate(loop,stage),approver_role:requiresHumanGate(loop,stage)?actorRole:null
      }
    }).select("id,occurred_at,event_type").single();
    if(error)throw error;
    return {recorded:true,event:data,completion_flag:completionFlag};
  }

  const inferred=await inferCompanyState(admin,userId,domain,organizationId);
  if(!inferred.context.goal?.id)throw new Error("company_goal_required");
  const authoritative:Record<string,string>={
    goal_defined:"company_goals",
    kpis_present:"company_kpis",
    bottleneck_identified:"company_goals.current_bottleneck",
    intervention_defined:"company_goals.next_action"
  };
  if(authoritative[completionFlag]){
    return {recorded:false,completion_flag:completionFlag,authoritative_source:authoritative[completionFlag]};
  }
  const eventByFlag:Record<string,string>={
    execution_started:"company.execution.started",
    result_measured:"company.result.measured",
    learning_recorded:"company.learning.recorded"
  };
  const eventType=eventByFlag[completionFlag];
  if(!eventType)throw new Error("company_stage_not_recordable");
  const {data,error}=await admin.from("company_events").insert({
    organization_id:inferred.context.organization_id,event_type:eventType,
    entity_type:"goal",entity_id:inferred.context.goal.id,owner_user_id:userId,
    source_system:"panthera_sovereign",evidence_pointer:evidencePointer,
    human_gate_status:"not_required",
    payload:{stage,completion_flag:completionFlag,evidence:evidence||{}},
    idempotency_key:"sovereign:evidence:"+completionFlag+":"+(await sha256(evidencePointer))
  }).select("id,occurred_at,event_type").single();
  if(error)throw error;
  return {recorded:true,event:data,completion_flag:completionFlag};
}

Deno.serve(async(req:Request)=>{
  const headers=cors(req.headers.get("origin"));
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return json(headers,{error:"method_not_allowed"},405);

  try{
    const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    if(!token)return json(headers,{error:"authentication_required"},401);

    const url=Deno.env.get("SUPABASE_URL")!;
    const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    const secret=secretKeys["default"];
    if(!secret)throw new Error("supabase_secret_missing");
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

    const {data:userData,error:userErr}=await admin.auth.getUser(token);
    if(userErr||!userData?.user)return json(headers,{error:"invalid_session"},401);
    const user=userData.user;

    const {data:membership,error:membershipErr}=await admin.from("panthera_memberships")
      .select("member_code,role,cohort").eq("user_id",user.id).maybeSingle();
    if(membershipErr)throw membershipErr;
    if(!membership)return json(headers,{error:"membership_required"},403);

    const body=await req.json().catch(()=>({}));
    const action=text(body.action)||"plan";
    if(!["plan","tick","status","record"].includes(action))return json(headers,{error:"invalid_action"},400);

    const mission=text(body.mission).slice(0,2000);
    const domain=text(body.domain).toUpperCase().slice(0,80);
    const explicitLoop=text(body.loop).toLowerCase()||null;
    const organizationId=text(body.organization_id);
    const loop=classifyLoop({explicitLoop,domain,mission});
    if((action==="plan"||action==="tick")&&!mission)return json(headers,{error:"mission_required"},400);

    if(action==="record"){
      if(!explicitLoop)return json(headers,{error:"loop_required"},400);
      const stage=text(body.stage).toUpperCase();
      if(!stage)return json(headers,{error:"stage_required"},400);
      const evidencePointer=text(body.evidence_pointer).slice(0,1000);
      const evidence=(body.evidence&&typeof body.evidence==="object"&&!Array.isArray(body.evidence))?body.evidence:{};
      const recorded=await recordEvidence({
        admin,userId:user.id,actorRole:membership.role,humanApproved:body.human_approved===true,
        loop:explicitLoop,stage,domain,organizationId,evidencePointer,evidence
      });
      const inferred=await inferState(admin,user.id,explicitLoop,domain,organizationId);
      return json(headers,{
        ok:true,...recorded,state:inferred.state,
        current_stage:currentStage(explicitLoop,inferred.state),context:inferred.context
      });
    }

    let state=(body.state&&typeof body.state==="object"&&!Array.isArray(body.state))?body.state:{};
    let inferredContext:any={};
    if(body.infer!==false){
      const inferred=await inferState(admin,user.id,loop,domain,organizationId);
      state={...inferred.state,...state};
      inferredContext=inferred.context;
    }

    if(action==="status"){
      const {data:runs,error:runsErr}=await admin.from("orchestration_runs")
        .select("id,problem_class,mode,routing_reason,decision_ready,created_at,metadata")
        .eq("user_id",user.id).eq("problem_class","sovereign:"+loop)
        .order("created_at",{ascending:false}).limit(10);
      if(runsErr)throw runsErr;
      return json(headers,{
        ok:true,loop,state,current_stage:currentStage(loop,state),
        context:inferredContext,runs:runs||[],
        boundary:"SHADOW_ONLY_NO_EXTERNAL_MUTATION"
      });
    }

    const requestedMode=text(body.mode).toUpperCase()||"SHADOW";
    const mode=action==="plan"?"DRY_RUN":requestedMode;
    if(action==="tick"&&mode!=="SHADOW")return json(headers,{error:"tick_requires_shadow_mode"},400);

    const plan=planSovereign({state,mission,explicitLoop:loop,domain,mode});
    if(action==="plan")return json(headers,{ok:true,persisted:false,plan,context:inferredContext,state});

    const activated=[...new Set(plan.workers.flatMap((w:any)=>WORKER_MODULES[w.worker_key]||[]))];
    const counters=plan.workers.some((w:any)=>w.worker_key==="red_team")?["red_team"]:[];
    const baseMetadata={
      sovereign_version:VERSION,loop:plan.loop,stage:plan.current_stage,domain,mission,
      human_gate:plan.human_gate,evidence_required:plan.evidence_required,
      company_goal_id:inferredContext.goal?.id||null,
      organization_id:inferredContext.organization_id||null,
      worker_contracts:plan.workers,state_snapshot:state
    };
    const {data:run,error:runErr}=await admin.from("orchestration_runs").insert({
      user_id:user.id,problem_class:"sovereign:"+plan.loop,mode:"shadow",
      complexity_budget:Math.max(1,plan.workers.length),primary_module:"meta_conductor",
      counter_lenses:counters,activated_modules:activated,
      routing_reason:plan.loop+" loop at "+(plan.current_stage||"COMPLETE"),
      blind_spot_count:counters.length,decision_ready:false,metadata:baseMetadata
    }).select("id,created_at").single();
    if(runErr)throw runErr;

    const tasks:any[]=[];
    for(const worker of plan.workers){
      const {data:task,error:taskErr}=await admin.from("panthera_task_requests").insert({
        user_id:user.id,
        request_text:worker.role+"\nOBJECTIVE: "+worker.objective+"\nEXIT: "+worker.exit_condition,
        routed_modules:WORKER_MODULES[worker.worker_key]||["meta_conductor"],
        task_type:"sovereign_worker:"+worker.worker_key,status:"created"
      }).select("id").single();
      if(taskErr)throw taskErr;
      tasks.push({task_id:task.id,worker});
    }

    if(plan.status==="LOOP_COMPLETE"||tasks.length===0){
      await admin.from("orchestration_runs").update({
        decision_ready:plan.human_gate!=="required",
        metadata:{...baseMetadata,worker_task_ids:[],worker_execution_status:"loop_complete"}
      }).eq("id",run.id).eq("user_id",user.id);
      return json(headers,{
        ok:true,persisted:true,run_id:run.id,worker_task_ids:[],plan,worker_results:[],
        decision_ready:plan.human_gate!=="required",context:inferredContext,state,
        boundary:"SHADOW_ONLY_NO_EXTERNAL_MUTATION"
      });
    }

    const {data:keyData,error:keyErr}=await admin.rpc("panthera_get_openai_key");
    if(keyErr)throw keyErr;
    const apiKey=typeof keyData==="string"?keyData:"";
    if(!apiKey){
      for(const task of tasks){
        await admin.from("panthera_task_requests").update({
          status:"created",
          outcome:JSON.stringify({worker_key:task.worker.worker_key,status:"blocked",error:"ai_provider_not_configured"})
        }).eq("id",task.task_id).eq("user_id",user.id);
      }
      await admin.from("orchestration_runs").update({
        decision_ready:false,
        metadata:{...baseMetadata,worker_task_ids:tasks.map(t=>t.task_id),worker_execution_status:"blocked_ai_not_configured"}
      }).eq("id",run.id).eq("user_id",user.id);
      return json(headers,{
        ok:true,persisted:true,run_id:run.id,worker_task_ids:tasks.map(t=>t.task_id),plan,
        worker_execution:"blocked_ai_not_configured",context:inferredContext,state,
        boundary:"SHADOW_ONLY_NO_EXTERNAL_MUTATION"
      });
    }

    const allowedScopes=membership.role==="founder"
      ?["global_core","team_shared","founder_private"]:["global_core","team_shared"];

    const workerResults=await Promise.all(tasks.map(async(task:any)=>{
      try{
        const execution=await executeWorker({
          admin,apiKey,userId:user.id,worker:task.worker,plan,state,mission,domain,allowedScopes
        });
        await admin.from("panthera_task_requests").update({
          status:"executed",
          outcome:JSON.stringify({worker_key:task.worker.worker_key,...execution})
        }).eq("id",task.task_id).eq("user_id",user.id);
        return {task_id:task.task_id,worker_key:task.worker.worker_key,...execution};
      }catch(e){
        const detail=String((e as any)?.message||e).slice(0,700);
        await admin.from("panthera_task_requests").update({
          status:"executed",
          outcome:JSON.stringify({worker_key:task.worker.worker_key,status:"blocked",error:detail})
        }).eq("id",task.task_id).eq("user_id",user.id);
        return {
          task_id:task.task_id,worker_key:task.worker.worker_key,error:detail,
          result:{status:"blocked",summary:"Worker execution blocked.",finding:detail,next_action:"Return to Sovereign and repair the blocker.",evidence_needed:[],risks:["worker_execution_error"],proposed_completion:{flag:plan.completion_flag,value:false,rationale:"Blocked worker cannot complete a stage."}}
        };
      }
    }));

    const allExecuted=workerResults.every((r:any)=>r?.result?.status&&r.result.status!=="blocked");
    const decisionReady=allExecuted&&plan.human_gate!=="required";
    await admin.from("orchestration_runs").update({
      decision_ready:decisionReady,
      metadata:{
        ...baseMetadata,worker_task_ids:tasks.map(t=>t.task_id),
        worker_execution_status:allExecuted?"completed":"partially_blocked",
        worker_results:workerResults
      }
    }).eq("id",run.id).eq("user_id",user.id);

    if(inferredContext.organization_id&&inferredContext.goal?.id){
      await admin.from("company_events").insert({
        organization_id:inferredContext.organization_id,
        event_type:"panthera.sovereign.shadow_completed",
        entity_type:"goal",entity_id:inferredContext.goal.id,owner_user_id:user.id,
        source_system:"panthera_sovereign",
        evidence_pointer:"supabase://orchestration_runs/"+run.id,
        human_gate_status:plan.human_gate,
        payload:{loop:plan.loop,stage:plan.current_stage,domain,worker_count:workerResults.length,all_executed:allExecuted},
        idempotency_key:"sovereign:shadow:"+run.id
      });
    }

    return json(headers,{
      ok:true,persisted:true,run_id:run.id,worker_task_ids:tasks.map(t=>t.task_id),
      plan,worker_results:workerResults,decision_ready:decisionReady,
      context:inferredContext,state,boundary:"SHADOW_ONLY_NO_EXTERNAL_MUTATION"
    });
  }catch(e){
    const message=String((e as any)?.message||e);
    const status=/human_gate_approval_required|human_gate_role_forbidden/.test(message)?403:
      /PII|mission scope|unknown loop|unknown stage|state must|only supports|evidence_pointer_required|company_goal_required/.test(message)?400:500;
    return json(headers,{error:"panthera_sovereign_failed",detail:message},status);
  }
});
