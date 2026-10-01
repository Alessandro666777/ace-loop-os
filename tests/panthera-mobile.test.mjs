import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html=readFileSync(new URL("../site/panthera.html",import.meta.url),"utf8");
const manifest=JSON.parse(readFileSync(new URL("../site/panthera-manifest.webmanifest",import.meta.url),"utf8"));
const sw=readFileSync(new URL("../site/panthera-service-worker.js",import.meta.url),"utf8");

test("mobile 01 direct AI endpoint is wired",()=>assert.match(html,/\/functions\/v1\/panthera-ai/));
test("mobile 02 copy-paste ChatGPT handoff is removed",()=>assert.doesNotMatch(html,/KOPIEREN \+ CHATGPT|copyOpen|copyOnly/));
test("mobile 03 founder AI provider setup exists",()=>{assert.match(html,/FOUNDER ONLY/);assert.match(html,/panthera_set_openai_key/)});
test("mobile 04 private memory is persisted per user",()=>assert.match(html,/panthera_user_memory/));
test("mobile 05 shared learning requires explicit consent",()=>{assert.match(html,/Shared Learning/);assert.match(html,/noPrivateConfirm/);assert.match(html,/publish_panthera_learning/)});
test("mobile 06 shared learning can be withdrawn",()=>assert.match(html,/withdraw_panthera_learning/));
test("mobile 07 reality reviews feed learning records",()=>assert.match(html,/learning_records/));
test("mobile 08 conversations persist",()=>{assert.match(html,/panthera_conversations/);assert.match(html,/panthera_messages/)});
test("mobile 09 invite bootstrapping remains available",()=>{assert.match(html,/redeem_panthera_invite/);assert.match(html,/INVITE_KEY/)});
test("mobile 10 PWA starts on mobile app",()=>assert.equal(manifest.start_url,"./panthera.html"));
test("mobile 11 service worker cache is v2 or newer",()=>assert.match(sw,/panthera-mobile-v(?:[2-9]|[1-9][0-9]+)/));
test("mobile 12 model badge is GPT-5.6 Sol",()=>assert.match(html,/GPT-5\.6 SOL/));
