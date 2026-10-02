import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.102.0";
import { planSovereign, WORKER_MODULES, VERSION } from "../_shared/sovereign.mjs";

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
    if(!["plan","tick","status"].includes(action))return json(headers,{error:"invalid_action"},400);

    const mission=text(body.mission).slice(0,2000);
    if(!mission)return json(headers,{error:"mission_required"},400);
    const domain=text(body.domain).toUpperCase().slice(0,80);
    const explicitLoop=text(body.loop).toLowerCase()||null;
    const requestedMode=text(body.mode).toUpperCase()||"SHADOW";
    const mode=action==="plan"?"DRY_RUN":requestedMode;
    if(action==="tick"&&mode!=="SHADOW")return json(headers,{error:"tick_requires_shadow_mode"},400);

    let state=(body.state&&typeof body.state==="object"&&!Array.isArray(body.state))?body.state:{};
    let companyContext:any={organization_id:null,goal:null,kpis:0};
    const inferredCompany=!explicitLoop||explicitLoop==="company";
    if((explicitLoop==="company"||(!explicitLoop&&domain))&&body.infer!==false){
      const inferred=await inferCompanyState(admin,user.id,domain,text(body.organization_id));
      state={...inferred.state,...state};
      companyContext=inferred.context;
    }

    const plan=planSovereign({state,mission,explicitLoop,domain,mode});
    if(action==="plan")return json(headers,{ok:true,persisted:false,plan,context:companyContext});

    const activated=[...new Set(plan.workers.flatMap((w:any)=>WORKER_MODULES[w.worker_key]||[]))];
    const counters=plan.workers.some((w:any)=>w.worker_key==="red_team")?["red_team"]:[];
    const {data:run,error:runErr}=await admin.from("orchestration_runs").insert({
      user_id:user.id,
      problem_class:"sovereign:"+plan.loop,
      mode:"shadow",
      complexity_budget:Math.max(1,plan.workers.length),
      primary_module:"meta_conductor",
      counter_lenses:counters,
      activated_modules:activated,
      routing_reason:`${plan.loop} loop at ${plan.current_stage||"COMPLETE"}`,
      blind_spot_count:counters.length,
      decision_ready:plan.human_gate!=="required",
      metadata:{
        sovereign_version:VERSION,loop:plan.loop,stage:plan.current_stage,domain,mission,
        human_gate:plan.human_gate,evidence_required:plan.evidence_required,
        company_goal_id:companyContext.goal?.id||null,organization_id:companyContext.organization_id,
        worker_contracts:plan.workers
      }
    }).select("id,created_at").single();
    if(runErr)throw runErr;

    const taskIds:string[]=[];
    for(const worker of plan.workers){
      const {data:task,error:taskErr}=await admin.from("panthera_task_requests").insert({
        user_id:user.id,
        request_text:`${worker.role}\nOBJECTIVE: ${worker.objective}\nEXIT: ${worker.exit_condition}`,
        routed_modules:WORKER_MODULES[worker.worker_key]||["meta_conductor"],
        task_type:"sovereign_worker:"+worker.worker_key,
        status:"created"
      }).select("id").single();
      if(taskErr)throw taskErr;
      taskIds.push(task.id);
    }

    await admin.from("orchestration_runs").update({
      metadata:{
        sovereign_version:VERSION,loop:plan.loop,stage:plan.current_stage,domain,mission,
        human_gate:plan.human_gate,evidence_required:plan.evidence_required,
        company_goal_id:companyContext.goal?.id||null,organization_id:companyContext.organization_id,
        worker_contracts:plan.workers,worker_task_ids:taskIds
      }
    }).eq("id",run.id).eq("user_id",user.id);

    if(companyContext.organization_id&&companyContext.goal?.id){
      await admin.from("company_events").insert({
        organization_id:companyContext.organization_id,
        event_type:"panthera.sovereign.plan_created",
        entity_type:"goal",
        entity_id:companyContext.goal.id,
        owner_user_id:user.id,
        source_system:"panthera_sovereign",
        evidence_pointer:"supabase://orchestration_runs/"+run.id,
        human_gate_status:plan.human_gate,
        payload:{loop:plan.loop,stage:plan.current_stage,domain,worker_count:plan.workers.length},
        idempotency_key:"sovereign:"+run.id
      });
    }

    return json(headers,{
      ok:true,persisted:true,run_id:run.id,worker_task_ids:taskIds,plan,context:companyContext,
      boundary:"SHADOW_ONLY_NO_EXTERNAL_MUTATION"
    });
  }catch(e){
    const message=String((e as any)?.message||e);
    const status=/PII|mission scope|unknown loop|state must|only supports/.test(message)?400:500;
    return json(headers,{error:"panthera_sovereign_failed",detail:message},status);
  }
});
