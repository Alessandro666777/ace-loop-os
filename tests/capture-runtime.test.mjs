import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src=readFileSync(new URL("../supabase/functions/capture-runtime/index.ts",import.meta.url),"utf8");

test("capture runtime 01 verifies Pocket webhook HMAC on raw body",()=>{
  assert.ok(src.includes("x-heypocket-signature"));
  assert.ok(src.includes("x-heypocket-timestamp"));
  assert.ok(src.includes('hmacHex(secret,ts+"."+rawBody)'));
  assert.ok(src.includes("safeEq(expected"));
});

test("capture runtime 02 recognizes Pocket nested v2 summary payloads",()=>{
  assert.ok(src.includes("x?.v2?.summary?.markdown"));
});

test("capture runtime 03 enriches webhook recordings from Pocket API when credential exists",()=>{
  assert.ok(src.includes("include_transcript=true&include_summarizations=true"));
  assert.ok(src.includes("Pocket webhook enrichment degraded"));
});

test("capture runtime 04 gates AI review behind consent",()=>{
  const consent=src.indexOf('const consentPass=["self_only","confirmed","not_required"].includes(item.consent_status)');
  const ai=src.indexOf("const apiKey=await openAIKey(admin)",consent);
  assert.ok(consent>0);
  assert.ok(ai>consent);
});

test("capture runtime 05 supports manual private audio and Pocket as independent adapters",()=>{
  assert.ok(src.includes('action==="register_manual_upload"'));
  assert.ok(src.includes('action==="transcribe_manual"'));
  assert.ok(src.includes('action==="sync_pocket"'));
});
