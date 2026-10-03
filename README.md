# PANTHERA · ACE OS V4

Mobile-first execution, capability, evidence and learning system.

Live app: https://alessandro666777.github.io/ace-loop-os/

Open in Safari on iPhone, then Share → Add to Home Screen.

## Runtime

The application in `site/` is deployed to GitHub Pages.

PANTHERA is local-first, with optional authenticated Supabase cloud synchronization for user-scoped execution data, goals, skills, company context and private knowledge.

## KnowledgeSourcePort v1

PANTHERA now includes a provider-neutral knowledge layer.

- Manual private capture: active
- Readwise Reader adapter: implemented
- Readwise credentials: stored server-side in Supabase Vault
- Readwise sync: incremental via `updatedAfter` + `pageCursor`
- Imported items: private by default
- Full document HTML: not imported by default
- Learning flow: private knowledge → candidate → evidence gate → shared knowledge

Readwise is an adapter, not a dependency of the PANTHERA core. It can be replaced without changing the learning pipeline.

See `docs/KNOWLEDGE_PORT_V1.md`.

## Security model

- Supabase Auth for cloud sessions
- Row Level Security on user-scoped tables
- provider credentials never stored in browser LocalStorage
- provider tokens are never returned to the frontend after storage
- shared learning requires a separate promotion/consent gate

## Tests

The GitHub regression suite covers core PANTHERA behavior, cloud isolation, company context and KnowledgeSourcePort / Readwise bridge behavior.

## System Manifest & Self Audit

PANTHERA now carries a machine-readable inventory of itself at `config/panthera.system.manifest.json`.

The manifest separates:
- internal core modules
- runtime systems
- domain systems
- knowledge sources
- replaceable provider adapters
- historical / planned components
- source-of-truth precedence

Runtime health is mirrored in Supabase and evaluated by `run_panthera_system_audit()`.

The UI exposes the same mechanism under **COMMAND → SYSTEM INTEGRITY → PANTHERA AUDIT**.

Audit states:
- GREEN: no critical/high findings, no freeze blockers, integrity >= 85
- YELLOW: unresolved high findings, freeze blockers, or integrity < 85
- RED: at least one critical finding

Architecture Freeze cannot be considered complete while required freeze blockers remain.
