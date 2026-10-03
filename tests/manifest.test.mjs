import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest=JSON.parse(readFileSync(new URL("../config/panthera.system.manifest.json",import.meta.url),"utf8"));

test("manifest 01 has one technical authority chain",()=>{
  assert.equal(manifest.manifest_version,"1.0");
  const tech=manifest.truth_precedence.find(x=>x.domain==="technical_canon");
  assert.deepEqual(tech,{domain:"technical_canon",primary:"github_ace_loop_os",fallback:"github_777"});
});

test("manifest 02 registers all nine internal modules",()=>{
  const required=["constitution","meta_conductor","reality","learning","mastery","ace","athenaeum","moon","seven_heads"];
  assert.deepEqual(Object.keys(manifest.internal_modules).sort(),required.sort());
});

test("manifest 03 registers every current integration provider contract",()=>{
  const required=[
    "ACE/Supabase","AUREA Sales OS","Backup Recovery","Company OS","CRM","Direct AI Provider",
    "GitHub 777","Gmail","Google Calendar","Google Drive","Knowledge Port","monday.com",
    "Multi-User Auth","n8n","Obsidian 777","Operator App","OXIDIA","P-GATE","PANTHERA",
    "PANTHERA Sovereign Runtime","PANTHERA-MACHINE","Quintera","Readwise ChatGPT Connector",
    "Readwise Reader","Revenue Engine","Security Hardening","Self Audit","System Manifest",
    "Universal Capture Port","Manual Capture Adapter","Pocket Capture Adapter","Obsidian Capture Bridge"
  ];
  for(const key of required)assert.ok(manifest.integrations[key],key+" missing from manifest");
});

test("manifest 04 critical freeze dependencies cannot silently accept partial state",()=>{
  for(const key of ["Backup Recovery","monday.com","n8n"]){
    const x=manifest.integrations[key];
    assert.equal(x.freeze_required,true);
    assert.deepEqual(x.expected,["verified"]);
  }
});

test("manifest 05 old Drive master is historical only",()=>{
  assert.equal(manifest.sources.drive_master_2026_09_14.state,"stale_snapshot");
  assert.equal(manifest.sources.drive_master_2026_09_14.superseded_by,"github_ace_loop_os");
  assert.notEqual(manifest.truth_precedence.find(x=>x.domain==="technical_canon").primary,"drive_master_2026_09_14");
});

test("manifest 06 provider adapters are not internal core modules",()=>{
  for(const provider of ["Readwise Reader","monday.com","n8n","Gmail","Google Drive"]){
    assert.equal(Object.prototype.hasOwnProperty.call(manifest.internal_modules,provider),false);
  }
});

test("manifest 07 remembered legacy candidates stay visible without becoming active core",()=>{
  const keys=["mr_seven","actor","blueprint_foundry","failure_registry_220","executive_hospitality_os","superagent_forge","panthera_world","panthera_os_2","growth_os","cohort_zero","mj_mentor"];
  for(const key of keys)assert.ok(manifest.remembered_non_active_components[key],key+" forgotten");
});

test("manifest 08 self-audit has explicit drift detection",()=>{
  assert.equal(manifest.audit.command,"panthera audit");
  for(const check of ["unregistered_integration","unregistered_module","authority_source_missing","review_due"]){
    assert.ok(manifest.audit.drift_checks.includes(check));
  }
});
