# PANTHERA KnowledgeSourcePort v1

PANTHERA depends on a provider-neutral knowledge contract, not on Readwise itself.

Flow: RAW SOURCE → PRIVATE KNOWLEDGE → ANALYSIS → PRIVATE LEARNING CANDIDATE → REALITY/EVIDENCE GATE → SHARED PANTHERA KNOWLEDGE.

Current adapters: manual and readwise. Readwise credentials are stored server-side in Supabase Vault. Imported items default to private. Provider disconnect removes credentials but does not delete imported private knowledge.

The Readwise adapter validates tokens server-side, syncs Reader documents incrementally with updatedAfter and pageCursor, and excludes full HTML content by default. Stored fields are limited to metadata, source pointers, title, author, summary, notes, tags, category/location, and timestamps.

Replaceability rule: removing Readwise must not require changes to PANTHERA orchestration, private knowledge schema, the learning candidate gate, shared knowledge canon, or the user model.
