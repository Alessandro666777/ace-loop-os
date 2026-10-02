import test from "node:test";
import assert from "node:assert/strict";
import {
  LOOPS,WORKERS,classifyLoop,currentStage,planSovereign,rejectLeadPII,rejectLikelyContactPII
} from "../supabase/functions/_shared/sovereign.mjs";

test("sovereign 01 exposes exactly three governed loops",()=>assert.deepEqual(Object.keys(LOOPS).sort(),["company","panthera","partner"]));
test("sovereign 02 explicit partner routing wins",()=>assert.equal(classifyLoop({explicitLoop:"partner",domain:"SALON_QUEEN"}),"partner"));
test("sovereign 03 SalonQ defaults to company loop",()=>assert.equal(classifyLoop({domain:"SALON_QUEEN",mission:"prove sales system"}),"company"));
test("sovereign 04 PANTHERA request routes system loop",()=>assert.equal(classifyLoop({domain:"PANTHERA",mission:"close runtime"}),"panthera"));
test("sovereign 05 first company stage is GOAL",()=>assert.equal(currentStage("company",{}),"GOAL"));
test("sovereign 06 company advances to KPI",()=>assert.equal(planSovereign({explicitLoop:"company",state:{goal_defined:true},mission:"m"}).current_stage,"KPI"));
test("sovereign 07 deploy is human gated",()=>{
  const state={observed:true,gap_defined:true,proposal_ready:true,built:true,tests_passed:true,verified:true};
  const p=planSovereign({explicitLoop:"panthera",state,mission:"ship"});
  assert.equal(p.current_stage,"DEPLOY");assert.equal(p.human_gate,"required");
});
test("sovereign 08 workers are ephemeral bounded children",()=>{
  const p=planSovereign({explicitLoop:"panthera",state:{observed:true},mission:"gap"});
  assert.ok(p.workers.length<=3);
  for(const w of p.workers){assert.equal(w.ephemeral,true);assert.equal(w.may_spawn_workers,false);assert.equal(w.external_mutation,false)}
});
test("sovereign 09 LIVE mode is rejected",()=>assert.throws(()=>planSovereign({explicitLoop:"company",state:{},mission:"m",mode:"LIVE"})));
test("sovereign 10 lead PII keys are rejected",()=>assert.throws(()=>rejectLeadPII({metrics:{contact_email:"x@example.com"}})));
test("sovereign 11 email/phone mission text is rejected",()=>{
  assert.throws(()=>rejectLikelyContactPII("contact x@example.com"));
  assert.throws(()=>rejectLikelyContactPII("call +49 170 1234567"));
});
test("sovereign 12 aggregate metrics are allowed",()=>{
  const p=planSovereign({explicitLoop:"company",state:{goal_defined:true,metrics:{contacts:40,appointments:7}},mission:"improve"});
  assert.equal(p.current_stage,"KPI");
});
test("sovereign 13 contract ids are deterministic",()=>{
  const a=planSovereign({explicitLoop:"partner",state:{},mission:"same"});
  const b=planSovereign({explicitLoop:"partner",state:{},mission:"same"});
  assert.equal(a.workers[0].contract_id,b.workers[0].contract_id);
});
test("sovereign 14 worker catalog contains no direct external action capability",()=>{
  const forbidden=new Set(["send_message","deploy_production","read_secrets","financial_transaction"]);
  for(const [,caps] of Object.values(WORKERS))for(const cap of caps)assert.equal(forbidden.has(cap),false);
});
test("sovereign 15 complete partner loop closes without workers",()=>{
  const s=Object.fromEntries(LOOPS.partner.map(([,flag])=>[flag,true]));
  const p=planSovereign({explicitLoop:"partner",state:s,mission:"done"});
  assert.equal(p.status,"LOOP_COMPLETE");assert.deepEqual(p.workers,[]);
});
