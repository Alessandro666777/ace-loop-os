import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.102.0";

const BASE="https://public.heypocketai.com/api/v1";
const ALLOWED_ORIGINS=new Set(["https://alessandro666777.github.io","http://localhost:3000","http://127.0.0.1:3000"]);

function cors(origin:string|null){
  const allowed=origin&&ALLOWED_ORIGINS.has(origin)?origin:"https://alessandro666777.github.io";
  return {
    "Access-Control-Allow-Origin":allowed,
    "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-heypocket-signature, x-heypocket-timestamp",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Content-Type":"application/json",
    "Vary":"Origin"
  };
}
function j(body:unknown,status=200,headers:Record<string,string>={"Content-Type":"application/json"}){
  return new Response(JSON.stringify(body),{status,headers});
}
function keys(){
  const raw=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(!raw)throw new Error("supabase_secret_missing");
  const k=JSON.parse(raw);if(!k.default)throw new Error("supabase_secret_missing");
  return k.default as string;
}
async function sha256(v:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function hmacHex(secret:string,data:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function safeEq(a:string,b:string){
  if(a.length!==b.length)return false;
  let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;
}
function transcriptText(value:any){
  if(!value)return "";
  if(typeof value==="string")return value;
  if(Array.isArray(value))return value.map(x=>typeof x==="string"?x:(x?.speaker?x.speaker+": ":"")+String(x?.text||x?.content||"")).filter(Boolean).join("\n");
  if(Array.isArray(value?.segments))return transcriptText(value.segments);
  if(Array.isArray(value?.items))return transcriptText(value.items);
  return String(value?.text||value?.content||"");
}
function detectType(title:string,tags:string[]){
  const t=(title+" "+tags.join(" ")).toLowerCase();
  if(/einstellung|recruit|bewerb|interview|partnergespräch/.test(t))return "recruiting_call";
  if(/verkauf|sales|kunde|kundengespräch|ttv|vg|abschluss|pitch/.test(t))return "sales_call";
  if(/präsenz|praesenz|vor ort|vor-ort/.test(t))return "presence_meeting";
  if(/meeting|termin|besprechung|sync|standup/.test(t))return "meeting";
  if(/memo|sprachmemo|voice memo/.test(t))return "voice_memo";
  return "other";
}
function summaryText(rec:any){
  const s=rec?.summarizations;
  if(typeof s==="string")return s;
  const candidates:any[]=[];
  if(Array.isArray(s))candidates.push(...s);
  else if(s&&typeof s==="object"){
    candidates.push(s);
    candidates.push(...Object.values(s));
  }
  for(const x of candidates.reverse()){
    const c=x?.v2?.summary?.markdown||x?.summary?.markdown||x?.summary||x?.markdown||x?.content||x?.text;
    if(typeof c==="string"&&c.trim())return c;
  }
  return "";
}
function getTags(rec:any){
  const tags=Array.isArray(rec?.tags)?rec.tags:[];
  return tags.map((x:any)=>typeof x==="string"?x:String(x?.name||"")).filter(Boolean);
}
async function pocket(token:string,path:string,init:RequestInit={}){
  const r=await fetch(BASE+path,{...init,headers:{
    "Authorization":"Bearer "+token,
    "Accept":"application/json",
    ...(init.body?{"Content-Type":"application/json"}:{}),
    ...((init.headers||{}) as Record<string,string>)
  }});
  const text=await r.text();
  let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text.slice(0,1000)}}
  if(!r.ok)throw new Error("pocket_"+r.status+":"+String(data?.error||"request_failed"));
  return data;
}
async function userFromRequest(admin:any,req:Request){
  const auth=req.headers.get("authorization")||"";
  const token=auth.replace(/^Bearer\s+/i,"").trim();
  if(!token)return null;
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data?.user)return null;
  return data.user;
}
async function pocketSecret(admin:any,userId:string){
  const {data,error}=await admin.rpc("capture_provider_secret_for_service",{p_user_id:userId,p_provider:"pocket"});
  if(error)throw error;
  return typeof data==="string"&&data?data:null;
}
async function webhookSecret(admin:any,userId:string){
  const {data,error}=await admin.rpc("capture_webhook_secret_for_service",{p_user_id:userId,p_provider:"pocket"});
  if(error)throw error;
  return typeof data==="string"&&data?data:null;
}
async function upsertPocket(admin:any,userId:string,rec:any,provenance:any){
  if(!rec?.id)throw new Error("pocket_recording_id_missing");
  const tags=getTags(rec);
  const normalizedTags=tags.map((x:string)=>x.toLowerCase().trim());
  const captureType=detectType(String(rec.title||""),tags);
  const tagConsent=normalizedTags.includes("panthera-self")?"self_only":
    normalizedTags.includes("panthera-consent")?"confirmed":
    normalizedTags.includes("panthera-block")?"blocked":"unknown";
  const source=await admin.from("capture_sources").select("id").eq("user_id",userId).eq("source_key","pocket").maybeSingle();
  const transcript=rec.transcript||provenance?.transcript||null;
  const tText=transcriptText(transcript);
  const hasSpeakerLabels=Array.isArray(transcript)&&transcript.some((x:any)=>x?.speaker&&String(x.speaker).trim());
  const row={
    user_id:userId,source_id:source.data?.id||null,source_key:"pocket",external_id:String(rec.id),
    capture_type:captureType,title:rec.title||null,occurred_at:rec.recording_at||rec.recordingAt||rec.created_at||null,
    duration_seconds:rec.duration??null,language:rec.language||null,raw_source_url:null,
    consent_status:tagConsent,consent_basis:tagConsent==="unknown"?null:"Pocket tag: "+normalizedTags.find((x:string)=>["panthera-self","panthera-consent","panthera-block"].includes(x)),privacy_scope:"private",
    pipeline_status:tText?"review_required":"captured",
    authenticity_status:hasSpeakerLabels?"speaker_verified":"source_verified",
    authenticity_score:hasSpeakerLabels?0.9:0.8,
    source_provenance:{
      provider:"pocket",signed_webhook:!!provenance?.signed_webhook,api_verified:!!provenance?.api_verified,
      event:provenance?.event||null,recording_id:String(rec.id),recorded_by:rec.recorded_by||rec.recordedBy||null
    },
    metadata:{
      pocket_state:rec.state||null,tags,folder_id:rec.folder_id||rec.folderId||null,
      pocket_summary:summaryText(rec),updated_at:rec.updated_at||rec.updatedAt||null
    },
    updated_at:new Date().toISOString()
  };
  const {data:item,error}=await admin.from("capture_items").upsert(row,{onConflict:"user_id,source_key,external_id"}).select("*").single();
  if(error)throw error;
  if(tText){
    const th=await sha256(tText);
    const {error:te}=await admin.from("capture_transcripts").upsert({
      user_id:userId,capture_item_id:item.id,transcript_version:"pocket-current",
      transcript_text:tText,segments:Array.isArray(transcript)?transcript:[],
      speakers:Array.isArray(transcript)?[...new Set(transcript.map((x:any)=>x?.speaker).filter(Boolean))]:[],
      provider:"pocket",provider_recording_id:String(rec.id),
      provider_processing_status:rec.state||"completed",transcript_hash:th,
      edited_by_user:provenance?.event==="transcript.edited",updated_at:new Date().toISOString()
    },{onConflict:"capture_item_id,transcript_version"});
    if(te)throw te;
  }
  return item;
}
async function openAIKey(admin:any){
  const {data,error}=await admin.rpc("panthera_get_openai_key");
  if(error)return null;
  return typeof data==="string"&&data.length>20?data:null;
}
function extractText(response:any){
  const out:string[]=[];
  for(const item of response?.output||[])for(const c of item?.content||[]){
    if(c?.type==="output_text"&&typeof c.text==="string")out.push(c.text);
  }
  return out.join("\n").trim();
}
async function reviewCapture(admin:any,userId:string,itemId:string){
  const [{data:item,error:ie},{data:tr,error:te},{data:runtime}]=await Promise.all([
    admin.from("capture_items").select("*").eq("id",itemId).eq("user_id",userId).single(),
    admin.from("capture_transcripts").select("*").eq("capture_item_id",itemId).eq("user_id",userId).order("updated_at",{ascending:false}).limit(1).maybeSingle(),
    admin.from("panthera_runtime_prompts").select("version,prompt_text").eq("active",true).order("created_at",{ascending:false}).limit(1).maybeSingle()
  ]);
  if(ie)throw ie;if(te)throw te;if(!tr?.transcript_text)throw new Error("transcript_required");
  const consentPass=["self_only","confirmed","not_required"].includes(item.consent_status);
  if(!consentPass){
    await admin.from("capture_items").update({pipeline_status:item.consent_status==="blocked"?"quarantined":"review_required",updated_at:new Date().toISOString()}).eq("id",itemId);
    return {reviewed:false,reason:"consent_required",consent_status:item.consent_status};
  }
  const apiKey=await openAIKey(admin);
  if(!apiKey){
    await admin.from("capture_items").update({pipeline_status:"review_required",updated_at:new Date().toISOString()}).eq("id",itemId);
    return {reviewed:false,reason:"ai_provider_not_configured"};
  }
  await admin.from("capture_items").update({pipeline_status:"processing",updated_at:new Date().toISOString()}).eq("id",itemId);
  const schema={
    type:"object",additionalProperties:false,
    properties:{
      domain:{type:"string"},
      summary:{type:"string"},
      claims:{type:"array",items:{type:"object",additionalProperties:false,properties:{
        text:{type:"string"},claim_type:{type:"string",enum:["observed","participant_statement","inference","unverifiable"]},
        confidence:{type:"number",minimum:0,maximum:1},rationale:{type:"string"}
      },required:["text","claim_type","confidence","rationale"]}},
      decisions:{type:"array",items:{type:"string"}},
      action_items:{type:"array",items:{type:"string"}},
      skills_observed:{type:"array",items:{type:"string"}},
      contradictions:{type:"array",items:{type:"string"}},
      authenticity_assessment:{type:"object",additionalProperties:false,properties:{
        source_provenance_score:{type:"number",minimum:0,maximum:1},
        speaker_attribution_confidence:{type:"number",minimum:0,maximum:1},
        limitations:{type:"array",items:{type:"string"}}
      },required:["source_provenance_score","speaker_attribution_confidence","limitations"]},
      evidence_assessment:{type:"object",additionalProperties:false,properties:{
        overall_confidence:{type:"number",minimum:0,maximum:1},
        evidence_strength:{type:"string",enum:["weak","medium","strong"]},
        missing_evidence:{type:"array",items:{type:"string"}}
      },required:["overall_confidence","evidence_strength","missing_evidence"]},
      knowledge_candidates:{type:"array",items:{type:"object",additionalProperties:false,properties:{
        title:{type:"string"},generalized_learning:{type:"string"},category:{type:"string"},
        evidence_level:{type:"string",enum:["hypothesis","field_observation","repeated","validated"]},
        confidence:{type:"number",minimum:0,maximum:1},safe_to_canonicalize:{type:"boolean"},rationale:{type:"string"}
      },required:["title","generalized_learning","category","evidence_level","confidence","safe_to_canonicalize","rationale"]}},
      recommended_status:{type:"string",enum:["approved_private","needs_more_evidence","rejected"]},
      canonicalization_allowed:{type:"boolean"},
      canonicalization_reason:{type:"string"}
    },
    required:["domain","summary","claims","decisions","action_items","skills_observed","contradictions","authenticity_assessment","evidence_assessment","knowledge_candidates","recommended_status","canonicalization_allowed","canonicalization_reason"]
  };
  const system=(runtime?.prompt_text||"PANTHERA: Reality > Narrative. Evidence > Authority.")+"\n\n"+
    "CAPTURE REVIEW RULES:\n"+
    "- Raw transcripts are source material, never truth by themselves.\n"+
    "- A participant statement is not verified fact. Label it participant_statement unless independently evidenced.\n"+
    "- Do not infer protected or highly sensitive traits. For recruiting/interview material, do not make hiring eligibility decisions; extract only observable process/skill evidence and transferable knowledge.\n"+
    "- Distinguish exact observation, participant statement, inference and unverifiable claim.\n"+
    "- Authenticity means provenance/integrity of the captured source, not factual truth of what speakers said.\n"+
    "- Prefer generalized, testable learnings. Never canonicalize gossip, personal secrets, personal attacks, or unsupported claims about third parties.\n"+
    "- Never include raw audio or the full transcript in canonical knowledge.\n"+
    "- canonicalization_allowed may be true only for at least one well-grounded generalized candidate. Consent is a separate hard gate enforced by code.";
  const input="CAPTURE METADATA\n"+JSON.stringify({
    capture_type:item.capture_type,title:item.title,occurred_at:item.occurred_at,source:item.source_key,
    authenticity_status:item.authenticity_status,source_provenance:item.source_provenance,
    pocket_summary:item.metadata?.pocket_summary||null
  })+"\n\nTRANSCRIPT\n"+String(tr.transcript_text).slice(0,80000);
  const resp=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"gpt-5.6-sol",instructions:system,input,
      reasoning:{effort:"high"},max_output_tokens:7000,store:false,
      safety_identifier:(await sha256(userId)).slice(0,64),
      text:{format:{type:"json_schema",name:"panthera_capture_review",strict:true,schema}}
    })
  });
  const raw=await resp.text();let parsed:any={};try{parsed=JSON.parse(raw)}catch{}
  if(!resp.ok)throw new Error("capture_review_provider_"+resp.status+":"+String(parsed?.error?.message||raw.slice(0,500)));
  const out=extractText(parsed);let review:any;try{review=JSON.parse(out)}catch{throw new Error("capture_review_json_invalid")}
  const modelAllowed=!!review.canonicalization_allowed&&Array.isArray(review.knowledge_candidates)&&review.knowledge_candidates.some((x:any)=>x?.safe_to_canonicalize===true);
  const finalStatus=review.recommended_status==="approved_private"?"approved_private":review.recommended_status==="rejected"?"rejected":"needs_more_evidence";
  const {data:stored,error:re}=await admin.from("capture_reviews").upsert({
    user_id:userId,capture_item_id:itemId,review_version:"panthera-v1",
    review_status:finalStatus,domain:review.domain||null,summary:review.summary||null,
    claims:review.claims||[],decisions:review.decisions||[],action_items:review.action_items||[],
    skills_observed:review.skills_observed||[],contradictions:review.contradictions||[],
    authenticity_assessment:review.authenticity_assessment||{},evidence_assessment:review.evidence_assessment||{},
    privacy_assessment:{consent_status:item.consent_status,privacy_scope:item.privacy_scope},
    knowledge_candidates:review.knowledge_candidates||[],
    canonicalization_allowed:modelAllowed,canonicalization_reason:review.canonicalization_reason||null,
    reviewer:"panthera-ai",reviewed_at:new Date().toISOString(),
    metadata:{model:parsed.model||"gpt-5.6-sol",runtime_version:runtime?.version||null,provider_response_id:parsed.id||null},
    updated_at:new Date().toISOString()
  },{onConflict:"capture_item_id,review_version"}).select("*").single();
  if(re)throw re;
  const canPublish=modelAllowed&&finalStatus==="approved_private"&&item.authenticity_status!=="conflicted";
  let publication=null;
  if(canPublish){
    const {data,error}=await admin.rpc("service_publish_capture",{p_user_id:userId,p_capture_item_id:itemId,p_review_id:stored.id});
    if(error)throw error;publication=data;
  }else{
    await admin.from("capture_items").update({pipeline_status:finalStatus==="rejected"?"rejected":"review_required",updated_at:new Date().toISOString()}).eq("id",itemId);
  }
  return {reviewed:true,review_id:stored.id,review_status:finalStatus,canonicalization_allowed:modelAllowed,consent_pass:consentPass,published:!!publication,publication};
}

Deno.serve(async(req:Request)=>{
  const headers=cors(req.headers.get("origin"));
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return j({error:"method_not_allowed"},405,headers);
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const admin=createClient(url,keys(),{auth:{persistSession:false,autoRefreshToken:false}});
    const rawBody=await req.text();

    const sig=req.headers.get("x-heypocket-signature");
    const ts=req.headers.get("x-heypocket-timestamp");
    if(sig&&ts){
      const userId=new URL(req.url).searchParams.get("user_id")||"";
      if(!/^[0-9a-f-]{36}$/i.test(userId))return j({error:"user_id_required"},400,headers);
      const secret=await webhookSecret(admin,userId);
      if(!secret)return j({error:"webhook_not_configured"},401,headers);
      const age=Math.abs(Date.now()-Number(ts));if(!Number.isFinite(age)||age>10*60*1000)return j({error:"webhook_timestamp_invalid"},401,headers);
      const expected=await hmacHex(secret,ts+"."+rawBody);
      if(!safeEq(expected,String(sig).toLowerCase()))return j({error:"webhook_signature_invalid"},401,headers);
      const payload=JSON.parse(rawBody||"{}");
      const event=String(payload.event||"");
      let rec=payload.recording||payload.data?.recording||payload.data||{};
      if(!rec?.id)return j({ok:true,ignored:true,event},200,headers);
      if(!rec.transcript&&payload.transcript)rec.transcript=payload.transcript;
      if(!rec.summarizations&&payload.summarizations)rec.summarizations=payload.summarizations;
      try{
        const token=await pocketSecret(admin,userId);
        if(token){
          const detail=await pocket(token,"/public/recordings/"+encodeURIComponent(rec.id)+"?include_transcript=true&include_summarizations=true");
          if(detail?.data)rec={...rec,...detail.data,transcript:detail.data.transcript||rec.transcript,summarizations:detail.data.summarizations||rec.summarizations};
        }
      }catch(e){console.warn("Pocket webhook enrichment degraded",String((e as any)?.message||e))}
      const item=await upsertPocket(admin,userId,rec,{signed_webhook:true,event,api_verified:!!(await pocketSecret(admin,userId).catch(()=>null)),transcript:rec.transcript||payload.transcript});
      let review=null;
      if(["summary.completed","summary.updated","summary.regenerated","transcription.completed","transcript.edited","speakers.labeled"].includes(event)){
        try{review=await reviewCapture(admin,userId,item.id)}catch(e){
          await admin.from("capture_items").update({pipeline_status:"review_required",metadata:{...(item.metadata||{}),review_error:String((e as any)?.message||e)},updated_at:new Date().toISOString()}).eq("id",item.id);
        }
      }
      return j({ok:true,event,capture_item_id:item.id,review},200,headers);
    }

    const user=await userFromRequest(admin,req);
    if(!user)return j({error:"authentication_required"},401,headers);
    const body=rawBody?JSON.parse(rawBody):{};
    const action=String(body.action||"status");

    if(action==="status"){
      const [{data:sources},{data:counts}]=await Promise.all([
        admin.from("capture_sources").select("source_key,source_name,provider,status,last_seen_at,last_error,capabilities").eq("user_id",user.id).order("source_key"),
        admin.from("capture_items").select("pipeline_status").eq("user_id",user.id)
      ]);
      const byStatus:Record<string,number>={};for(const x of counts||[])byStatus[x.pipeline_status]=(byStatus[x.pipeline_status]||0)+1;
      return j({ok:true,sources:sources||[],counts:byStatus},200,headers);
    }

    if(action==="register_manual_upload"){
      const storagePath=String(body.storage_path||"");
      const prefix=user.id+"/";
      if(!storagePath.startsWith(prefix)||storagePath.includes(".."))return j({error:"invalid_storage_path"},400,headers);
      const captureType=String(body.capture_type||"voice_memo");
      if(!["voice_memo","meeting","sales_call","recruiting_call","presence_meeting","other"].includes(captureType))return j({error:"invalid_capture_type"},400,headers);
      const consentStatus=String(body.consent_status||"unknown");
      if(!["unknown","self_only","confirmed","not_required","blocked"].includes(consentStatus))return j({error:"invalid_consent_status"},400,headers);
      const {data:source}=await admin.from("capture_sources").select("id").eq("user_id",user.id).eq("source_key","manual_upload").maybeSingle();
      const external="manual:"+await sha256(storagePath);
      const {data:item,error}=await admin.from("capture_items").upsert({
        user_id:user.id,source_id:source?.id||null,source_key:"manual_upload",external_id:external,
        capture_type:captureType,title:String(body.title||"Apple Voice Memo").slice(0,300),
        occurred_at:body.occurred_at||new Date().toISOString(),
        raw_storage_bucket:"panthera-capture-raw",raw_storage_path:storagePath,
        mime_type:String(body.mime_type||"application/octet-stream").slice(0,160),
        file_size_bytes:Number(body.file_size_bytes||0)||null,
        consent_status:consentStatus,consent_basis:String(body.consent_basis||"").slice(0,1000)||null,
        privacy_scope:"private",pipeline_status:consentStatus==="blocked"?"quarantined":"captured",
        authenticity_status:"user_confirmed",authenticity_score:0.95,
        source_provenance:{provider:"panthera_manual_upload",storage_path:storagePath,user_uploaded:true},
        metadata:{original_file_name:String(body.original_file_name||"").slice(0,500),upload_surface:"panthera_web"},
        updated_at:new Date().toISOString()
      },{onConflict:"user_id,source_key,external_id"}).select("*").single();
      if(error)throw error;
      return j({ok:true,capture_item:item},200,headers);
    }

    if(action==="transcribe_manual"){
      const id=String(body.capture_item_id||"");
      const {data:item,error:ie}=await admin.from("capture_items").select("*").eq("id",id).eq("user_id",user.id).eq("source_key","manual_upload").single();
      if(ie)throw ie;
      if(!["self_only","confirmed","not_required"].includes(item.consent_status))return j({error:"consent_required"},409,headers);
      if(!item.raw_storage_bucket||!item.raw_storage_path)return j({error:"raw_file_missing"},409,headers);
      const apiKey=await openAIKey(admin);if(!apiKey)return j({error:"ai_provider_not_configured"},409,headers);
      await admin.from("capture_items").update({pipeline_status:"transcribing",updated_at:new Date().toISOString()}).eq("id",id);
      const {data:file,error:de}=await admin.storage.from(item.raw_storage_bucket).download(item.raw_storage_path);
      if(de||!file)throw de||new Error("storage_download_failed");
      const form=new FormData();
      const ext=String(item.metadata?.original_file_name||"recording.m4a");
      form.append("file",file,ext);
      form.append("model","gpt-transcribe");
      form.append("response_format","json");
      const tr=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{"Authorization":"Bearer "+apiKey},body:form});
      const raw=await tr.text();let td:any={};try{td=JSON.parse(raw)}catch{}
      if(!tr.ok)throw new Error("transcription_provider_"+tr.status+":"+String(td?.error?.message||raw.slice(0,500)));
      const text=String(td?.text||"").trim();if(!text)throw new Error("empty_transcript");
      const hash=await sha256(text);
      const {error:te}=await admin.from("capture_transcripts").upsert({
        user_id:user.id,capture_item_id:id,transcript_version:"openai-current",
        transcript_text:text,segments:[],speakers:[],provider:"openai",
        provider_recording_id:null,provider_processing_status:"completed",transcript_hash:hash,
        edited_by_user:false,updated_at:new Date().toISOString()
      },{onConflict:"capture_item_id,transcript_version"});
      if(te)throw te;
      await admin.from("capture_items").update({pipeline_status:"review_required",updated_at:new Date().toISOString()}).eq("id",id);
      const review=await reviewCapture(admin,user.id,id);
      return j({ok:true,capture_item_id:id,transcribed:true,review},200,headers);
    }

    if(action==="set_openai_key"){
      const key=String(body.key||"").trim();
      if(key.length<20)return j({error:"invalid_openai_key"},400,headers);
      const vr=await fetch("https://api.openai.com/v1/models",{headers:{"Authorization":"Bearer "+key,"Accept":"application/json"}});
      if(!vr.ok)return j({error:"openai_key_invalid",status:vr.status},401,headers);
      const {data:membership}=await admin.from("panthera_memberships").select("role").eq("user_id",user.id).maybeSingle();
      if(membership?.role!=="founder")return j({error:"founder_role_required"},403,headers);
      const {error}=await admin.rpc("service_set_panthera_openai_key",{p_user_id:user.id,p_key:key});
      if(error)throw error;
      return j({ok:true,configured:true},200,headers);
    }

    if(action==="set_pocket_key"){
      const token=String(body.token||"").trim();
      if(token.length<12)return j({error:"invalid_pocket_key"},400,headers);
      await pocket(token,"/public/recordings?limit=1");
      const {error}=await admin.rpc("service_set_capture_provider_secret",{p_user_id:user.id,p_provider:"pocket",p_secret:token,p_scopes:["recordings:read","recordings:write"]});
      if(error)throw error;
      return j({ok:true,connected:true},200,headers);
    }

    if(action==="set_pocket_webhook_secret"){
      const secret=String(body.secret||"").trim();
      if(secret.length<12)return j({error:"invalid_webhook_secret"},400,headers);
      const {error}=await admin.rpc("service_set_capture_webhook_secret",{p_user_id:user.id,p_provider:"pocket",p_secret:secret});
      if(error)throw error;
      return j({ok:true,webhook_configured:true,webhook_url:url+"/functions/v1/capture-runtime?user_id="+user.id},200,headers);
    }

    if(action==="sync_pocket"){
      const token=await pocketSecret(admin,user.id);if(!token)return j({error:"pocket_connection_required"},409,headers);
      const limit=Math.max(1,Math.min(50,Number(body.limit||20)));
      const page=Math.max(1,Number(body.page||1));
      const list=await pocket(token,"/public/recordings?page="+page+"&limit="+limit);
      const recs=Array.isArray(list?.data)?list.data:[];
      const out:any[]=[];
      for(const summary of recs){
        try{
          const detail=await pocket(token,"/public/recordings/"+encodeURIComponent(summary.id)+"?include_transcript=true&include_summarizations=true");
          const rec=detail?.data||summary;
          const item=await upsertPocket(admin,user.id,rec,{api_verified:true});
          out.push({recording_id:summary.id,capture_item_id:item.id,status:item.pipeline_status});
        }catch(e){out.push({recording_id:summary.id,error:String((e as any)?.message||e)})}
      }
      await admin.from("capture_sources").update({status:"verified",last_seen_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("user_id",user.id).eq("source_key","pocket");
      return j({ok:true,items:out,pagination:list?.pagination||null},200,headers);
    }

    if(action==="pocket_upload_url"){
      const token=await pocketSecret(admin,user.id);if(!token)return j({error:"pocket_connection_required"},409,headers);
      const reqBody={
        file_name:String(body.file_name||"recording.m4a").slice(0,255),
        content_type:String(body.content_type||"audio/mp4").slice(0,120),
        title:String(body.title||"PANTHERA Capture").slice(0,300),
        recording_at:body.recording_at||new Date().toISOString(),
        ...(Number(body.duration)>0?{duration:Number(body.duration)}:{})
      };
      const result=await pocket(token,"/public/recordings/upload-url",{method:"POST",body:JSON.stringify(reqBody)});
      return j({ok:true,pocket:result},200,headers);
    }

    if(action==="set_consent"){
      const id=String(body.capture_item_id||"");
      const status=String(body.consent_status||"");
      if(!["self_only","confirmed","not_required","blocked"].includes(status))return j({error:"invalid_consent_status"},400,headers);
      const {data:item,error}=await admin.from("capture_items").update({
        consent_status:status,consent_basis:String(body.consent_basis||"").slice(0,1000)||null,updated_at:new Date().toISOString()
      }).eq("id",id).eq("user_id",user.id).select("*").single();
      if(error)throw error;
      let publish=null;
      if(status!=="blocked"){
        const {data:review}=await admin.from("capture_reviews").select("*").eq("capture_item_id",id).eq("user_id",user.id).eq("review_version","panthera-v1").maybeSingle();
        if(review?.canonicalization_allowed&&review.review_status==="approved_private"){
          const p=await admin.rpc("service_publish_capture",{p_user_id:user.id,p_capture_item_id:id,p_review_id:review.id});
          if(!p.error)publish=p.data;
        }
      }else{
        await admin.from("capture_items").update({pipeline_status:"quarantined"}).eq("id",id).eq("user_id",user.id);
      }
      return j({ok:true,capture_item_id:id,consent_status:item.consent_status,publish},200,headers);
    }

    if(action==="review"){
      const id=String(body.capture_item_id||"");
      const result=await reviewCapture(admin,user.id,id);
      return j({ok:true,...result},200,headers);
    }

    if(action==="list"){
      const {data,error}=await admin.from("capture_items").select("id,source_key,external_id,capture_type,title,occurred_at,duration_seconds,consent_status,pipeline_status,authenticity_status,authenticity_score,metadata,created_at,updated_at").eq("user_id",user.id).order("occurred_at",{ascending:false}).limit(Math.min(100,Number(body.limit||40)));
      if(error)throw error;
      return j({ok:true,items:data||[]},200,headers);
    }

    return j({error:"unknown_action"},400,headers);
  }catch(e){
    console.error(e);
    return j({error:"capture_runtime_failed",detail:String((e as any)?.message||e)},500,cors(req.headers.get("origin")));
  }
});