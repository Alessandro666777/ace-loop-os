# PANTHERA CaptureSourcePort v1

## Purpose

CaptureSourcePort is the provider-neutral ingestion boundary for recorded field intelligence.

Pocket AI is one adapter. Apple Voice Memos / file upload is another. Meeting platforms may be added later without changing the PANTHERA knowledge pipeline.

## Canonical flow

CAPTURE
→ PRIVATE RAW / QUARANTINE
→ CONSENT GATE
→ TRANSCRIPT
→ PANTHERA REVIEW
→ PROVENANCE / AUTHENTICITY / EVIDENCE
→ KNOWLEDGE CANDIDATES
→ CANONICALIZATION GATE
→ KNOWLEDGE PORT
→ OBSIDIAN 777

## Hard invariants

1. Raw media is private source material and is not canonical knowledge.
2. Full transcripts are private source material and are not written into the canonical 777 notes automatically.
3. For captured conversations, consent must pass before transcription or AI review.
4. Source authenticity means provenance/integrity confidence. It does not mean that statements made by participants are factually true.
5. Claims are classified as observation, participant statement, inference, or unverifiable.
6. Unsupported claims about third parties, gossip, personal secrets, or sensitive-trait inference are not eligible for canon.
7. Recruitment captures may produce observable process/skill evidence and generalized learnings, but the capture pipeline does not make hiring eligibility decisions.
8. Canonicalization requires a PANTHERA review with canonicalization_allowed=true and at least one safe generalized knowledge candidate.
9. Obsidian receives distilled approved knowledge only.
10. Provider adapters are replaceable. Removing Pocket must not break CaptureSourcePort.

## Adapters

### Manual / Apple Voice Memo

Private upload:
- bucket: panthera-capture-raw
- bucket is private
- object path begins with the authenticated user id
- row-level storage policies limit access to the owner path

After consent:
- direct transcription uses the configured PANTHERA AI provider
- review uses the same PANTHERA governance rules
- results follow the same publication gate as every other capture source

### Pocket AI

Runtime:
- Pocket API key is validated server-side and stored in Supabase Vault
- webhook signing secret is stored in Supabase Vault
- Pocket webhooks are verified by timestamp + HMAC signature
- recordings, transcripts and summaries are normalized into CaptureSourcePort objects

Supported control tags:
- panthera-self → self_only
- panthera-consent → confirmed
- panthera-block → blocked

Pocket remains optional and replaceable.

## Consent states

- unknown — captured/quarantined; no AI review
- self_only — owner confirms only their own voice/content
- confirmed — owner confirms required participant consent
- not_required — owner explicitly marks that consent is not required for the specific source
- blocked — no processing; quarantine

PANTHERA is a technical gate, not a substitute for applicable recording/privacy law.

## Review states

- pending
- approved_private
- approved_shared
- rejected
- needs_more_evidence

Publication is impossible unless the review is approved and canonicalization_allowed=true.

## Obsidian bridge

Cloud-to-Mac command execution is prohibited.

The real 777 vault uses a pull-only bridge:
- local secret is stored only on the Mac
- Supabase stores only its SHA-256 hash
- the cloud endpoint exposes only already-approved publication packages
- raw media and full transcripts are excluded by schema
- files are write-once
- existing divergent files are never overwritten
- ACK happens only after successful local write and existing 777 Brain refresh

Canonical sink:
PANTHERA_CANONICAL/10_FIELD_INTELLIGENCE/

Runtime watcher:
- a pull-only watcher polls every 60 seconds while the logged-in Mac session is active
- every authenticated pull writes a separate runtime heartbeat in Supabase
- panthera audit treats a heartbeat older than 5 minutes as a HIGH freeze blocker
- a dedicated Login Item command exists for restart after login; macOS still requires the user to approve that Login Item / Automation permission
- no launchd/TCC bypass is used

## Runtime components

Supabase:
- capture_sources
- capture_items
- capture_transcripts
- capture_reviews
- capture_publications
- capture_provider_credentials
- private storage bucket panthera-capture-raw
- Edge Function capture-runtime
- Edge Function capture-obsidian-pull

Local 777:
- 90_EXECUTION_OS/N8N/capture_inbound_bridge.py
- 90_EXECUTION_OS/N8N/777 Capture Sync.command

## Replaceability test

A provider is valid only if removing it does not require changes to:
- capture governance
- consent gate
- review schema
- KnowledgeSourcePort
- canonicalization rules
- Obsidian publication contract

## Activation gates

The architecture is complete without any single capture provider, but two account-owned credentials are required for the fully automatic Pocket path:

1. PANTHERA Direct AI Provider
   - required for direct audio transcription and PANTHERA review
   - configured through the PANTHERA Capture Port field
   - server validates the key and stores it in Supabase Vault
   - the browser clears the field and never persists it in LocalStorage

2. Pocket AI
   - Pocket API key for recording sync/upload
   - Pocket webhook signing secret for event-driven ingestion
   - both are entered directly into PANTHERA and stored server-side in Vault

The Pocket ChatGPT plugin is optional and is not required by the autonomous runtime.

## Pocket webhook setup order

1. Sign in to PANTHERA and open COMMAND → CAPTURE PORT.
2. Copy the Pocket Webhook URL shown immediately in the Capture Port.
3. Create the personal webhook in Pocket using that URL.
4. Pocket reveals the signing secret once; paste that secret into PANTHERA → Pocket Webhook Secret → SAVE WEBHOOK SECRET.
5. The signing secret is stored server-side in Supabase Vault and is not persisted in browser storage.
