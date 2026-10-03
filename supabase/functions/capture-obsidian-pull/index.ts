import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.102.0";

function j(x:unknown,status=200){return new Response(JSON.stringify(x),{status,headers:{"Content-Type":"application/json"}})}
function secret(){
  const raw=Deno.env.get("SUPABASE_SECRET_KEYS");if(!raw)throw new Error("supabase_secret_missing");
  const k=JSON.parse(raw);if(!k.default)throw new Error("supabase_secret_missing");return k.default as string;
}
async function sha256(v:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return j({error:"method_not_allowed"},405);
  try{
    const token=req.headers.get("x-panthera-capture-key")||"";
    if(token.length<32)return j({error:"bridge_auth_required"},401);
    const url=Deno.env.get("SUPABASE_URL")!;
    const admin=createClient(url,secret(),{auth:{persistSession:false,autoRefreshToken:false}});
    const hash=await sha256(token);
    const {data:key,error:keyErr}=await admin.from("integration_keys")
      .select("id,user_id,label,active")
      .eq("key_hash",hash).eq("label","obsidian_capture_pull_v1").eq("active",true).maybeSingle();
    if(keyErr)throw keyErr;if(!key)return j({error:"bridge_auth_invalid"},401);
    await admin.from("integration_keys").update({last_used_at:new Date().toISOString()}).eq("id",key.id);

    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"pull");

    if(action==="pull"){
      const limit=Math.max(1,Math.min(20,Number(body.limit||10)));
      const {data:pubs,error:pe}=await admin.from("capture_publications")
        .select("id,capture_item_id,review_id,metadata,created_at")
        .eq("user_id",key.user_id).eq("destination","obsidian_777").eq("publication_status","pending")
        .order("created_at",{ascending:true}).limit(limit);
      if(pe)throw pe;
      const packages:any[]=[];
      for(const p of pubs||[]){
        const [{data:item},{data:review},{data:kitems}]=await Promise.all([
          admin.from("capture_items").select("id,source_key,external_id,capture_type,title,occurred_at,consent_status,authenticity_status,authenticity_score,source_provenance,metadata").eq("id",p.capture_item_id).eq("user_id",key.user_id).maybeSingle(),
          admin.from("capture_reviews").select("id,review_status,domain,summary,claims,decisions,action_items,skills_observed,contradictions,authenticity_assessment,evidence_assessment,knowledge_candidates,canonicalization_allowed,canonicalization_reason,reviewer,reviewed_at,metadata").eq("id",p.review_id).eq("user_id",key.user_id).maybeSingle(),
          admin.from("knowledge_items").select("id,title,summary,notes,tags,category,privacy_scope,metadata,updated_at").eq("user_id",key.user_id).eq("provider","capture").eq("external_id",String(p.capture_item_id)).limit(1)
        ]);
        if(!item||!review||!review.canonicalization_allowed||!["approved_private","approved_shared"].includes(review.review_status))continue;
        if(!["self_only","confirmed","not_required"].includes(item.consent_status))continue;
        const knowledge=Array.isArray(kitems)&&kitems.length?kitems[0]:null;
        packages.push({
          schema_version:1,
          publication_id:p.id,
          capture_item_id:item.id,
          review_id:review.id,
          knowledge_item_id:knowledge?.id||p.metadata?.knowledge_item_id||null,
          title:knowledge?.title||item.title||"Captured Field Intelligence",
          domain:review.domain||knowledge?.category||"capture",
          summary:review.summary||knowledge?.summary||"",
          knowledge_candidates:review.knowledge_candidates||[],
          decisions:review.decisions||[],
          action_items:review.action_items||[],
          skills_observed:review.skills_observed||[],
          contradictions:review.contradictions||[],
          evidence_assessment:review.evidence_assessment||{},
          authenticity_assessment:review.authenticity_assessment||{},
          provenance:{
            source:item.source_key,
            external_id:item.external_id,
            capture_type:item.capture_type,
            occurred_at:item.occurred_at,
            consent_status:item.consent_status,
            authenticity_status:item.authenticity_status,
            authenticity_score:item.authenticity_score,
            source_provenance:item.source_provenance,
            reviewed_at:review.reviewed_at,
            reviewer:review.reviewer
          },
          privacy_scope:"founder_private",
          raw_audio_included:false,
          raw_transcript_included:false
        });
      }
      return j({ok:true,packages});
    }

    if(action==="ack"){
      const ids=Array.isArray(body.publication_ids)?body.publication_ids.map(String).filter(Boolean).slice(0,20):[];
      const refs=body.destination_refs&&typeof body.destination_refs==="object"?body.destination_refs:{};
      const done:any[]=[];
      for(const id of ids){
        const ref=String(refs[id]||"").slice(0,2000)||null;
        const {data,error}=await admin.from("capture_publications").update({
          publication_status:"published",destination_ref:ref,published_at:new Date().toISOString(),
          metadata:{bridge:"obsidian_capture_pull_v1",acknowledged_at:new Date().toISOString()}
        }).eq("id",id).eq("user_id",key.user_id).eq("destination","obsidian_777").eq("publication_status","pending").select("id").maybeSingle();
        if(error)throw error;if(data)done.push(data.id);
      }
      return j({ok:true,acknowledged:done});
    }
    return j({error:"unknown_action"},400);
  }catch(e){
    console.error(e);return j({error:"capture_obsidian_pull_failed",detail:String((e as any)?.message||e)},500);
  }
});