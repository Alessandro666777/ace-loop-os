import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKER_RESULT_SCHEMA,workerEffort,buildWorkerRequest,normalizeWorkerResult,containsDirectContactPII
} from "../supabase/functions/_shared/worker-runtime.mjs";

const worker={worker_key:"red_team",role:"Attack assumptions",objective:"company:BOTTLENECK — diagnose",capabilities:[]};

test("worker runtime 01 schema is strict",()=>{
  assert.equal(WORKER_RESULT_SCHEMA.additionalProperties,false);
  assert.equal(WORKER_RESULT_SCHEMA.properties.proposed_completion.additionalProperties,false);
});

test("worker runtime 02 high-risk reasoning workers get high effort",()=>{
  assert.equal(workerEffort("red_team"),"high");
  assert.equal(workerEffort("mission_designer"),"medium");
});

test("worker runtime 03 request remains tool-less shadow analysis",()=>{
  const req=buildWorkerRequest({model:"gpt-test",worker,loop:"company",stage:"BOTTLENECK",mission:"m",state:{contacts:10},knowledge:"k",completionFlag:"bottleneck_identified",safetyIdentifier:"abc"});
  assert.equal(req.model,"gpt-test");
  assert.equal(req.tools,undefined);
  assert.equal(req.store,false);
  assert.equal(req.text.format.type,"json_schema");
  assert.match(req.instructions,/Never send messages/);
});

test("worker runtime 04 normalizes valid structured result",()=>{
  const payload={status:"needs_evidence",summary:"s",finding:"f",next_action:"n",evidence_needed:["x"],risks:[],proposed_completion:{flag:"bottleneck_identified",value:false,rationale:"missing"}};
  const response={output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(payload)}]}]};
  assert.deepEqual(normalizeWorkerResult(response,{completionFlag:"bottleneck_identified"}),payload);
});

test("worker runtime 05 rejects wrong completion flag",()=>{
  const payload={status:"complete",summary:"s",finding:"f",next_action:"n",evidence_needed:[],risks:[],proposed_completion:{flag:"deployed",value:true,rationale:"no"}};
  const response={output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(payload)}]}]};
  assert.throws(()=>normalizeWorkerResult(response,{completionFlag:"bottleneck_identified"}));
});

test("worker runtime 06 incomplete output cannot promote stage",()=>{
  const r=normalizeWorkerResult({status:"incomplete",incomplete_details:{reason:"max_output_tokens"}},{completionFlag:"tested"});
  assert.equal(r.status,"blocked");
  assert.equal(r.proposed_completion.value,false);
});

test("worker runtime 07 direct contact PII detector catches contact data",()=>{
  assert.equal(containsDirectContactPII("x@example.com"),true);
  assert.equal(containsDirectContactPII("+49 170 1234567"),true);
  assert.equal(containsDirectContactPII({appointments:12,revenue:4000000}),false);
});
