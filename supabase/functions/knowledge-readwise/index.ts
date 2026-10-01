import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

type Action = "status" | "set_token" | "sync" | "disconnect";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function getKeys() {
  const pubRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!pubRaw || !secRaw) throw new Error("Supabase keys unavailable");
  const pub = JSON.parse(pubRaw);
  const sec = JSON.parse(secRaw);
  return { publishable: pub.default, secret: sec.default };
}

function tagNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x: any) => typeof x === "string" ? x : (x?.name || x?.key || "")).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, any>)
      .map(([k, v]) => (v && typeof v === "object" && (v.name || v.key)) ? (v.name || v.key) : k)
      .filter(Boolean);
  }
  return [];
}

async function readwiseFetch(url: string, token: string) {
  const r = await fetch(url, {
    headers: {
      "Authorization": `Token ${token}`,
      "Accept": "application/json",
    },
  });
  return r;
}

async function ensureRegistry(admin: any, userId: string) {
  await admin.from("knowledge_sources").upsert({
    user_id: userId,
    provider: "readwise",
    adapter_version: "1.0",
    status: "connection_required",
    capabilities: { search: true, ingest: true, sync: true, promote_candidate: true },
    config: { content_mode: "metadata_summary_notes_only", credential_mode: "vault_per_user" },
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider", ignoreDuplicates: true });

  await admin.from("integration_status").upsert({
    user_id: userId,
    provider: "Readwise Reader",
    status: "connection_required",
    metadata: {
      adapter: "readwise-reader-v1",
      contract: "KnowledgeSourcePort v1",
      content_mode: "metadata_summary_notes_only",
      credential_storage: "supabase_vault",
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider", ignoreDuplicates: true });
}

async function getStoredToken(admin: any, userId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("readwise_token_for_service", { p_user_id: userId });
  if (error) throw error;
  return typeof data === "string" && data.length ? data : null;
}

async function statusPayload(userClient: any, userId: string) {
  const [{ data: source }, { data: integration }] = await Promise.all([
    userClient.from("knowledge_sources")
      .select("provider,status,adapter_version,last_sync_at,last_error,sync_cursor,capabilities,config")
      .eq("user_id", userId).eq("provider", "readwise").maybeSingle(),
    userClient.from("integration_status")
      .select("provider,status,last_sync_at,metadata")
      .eq("user_id", userId).eq("provider", "Readwise Reader").maybeSingle(),
  ]);
  return { source: source || null, integration: integration || null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "not_authenticated" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const { publishable, secret } = getKeys();

    const userClient = createClient(url, publishable, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(url, secret, { auth: { persistSession: false } });

    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "not_authenticated" }, 401);

    await ensureRegistry(admin, user.id);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status") as Action;

    if (action === "status") {
      const st = await statusPayload(userClient, user.id);
      return json({ ok: true, ...st });
    }

    if (action === "set_token") {
      const rwToken = String(body?.token || "").trim();
      if (rwToken.length < 20 || rwToken.length > 1024) {
        return json({ error: "invalid_token_format" }, 400);
      }
      const vr = await readwiseFetch("https://readwise.io/api/v2/auth/", rwToken);
      if (vr.status !== 204) {
        await admin.from("knowledge_sources").update({
          status: "error",
          last_error: "Readwise token validation failed",
          updated_at: new Date().toISOString(),
        }).eq("user_id", user.id).eq("provider", "readwise");
        return json({ error: "readwise_token_invalid" }, 401);
      }

      const { error: setError } = await admin.rpc("service_set_readwise_token", {
        p_user_id: user.id,
        p_token: rwToken,
      });
      if (setError) throw setError;

      return json({ ok: true, connected: true, ...(await statusPayload(userClient, user.id)) });
    }

    if (action === "disconnect") {
      const { error: clearError } = await admin.rpc("service_clear_readwise_token", {
        p_user_id: user.id,
      });
      if (clearError) throw clearError;
      return json({ ok: true, connected: false, ...(await statusPayload(userClient, user.id)) });
    }

    if (action !== "sync") return json({ error: "unknown_action" }, 400);

    const rwToken = await getStoredToken(admin, user.id);
    if (!rwToken) return json({ error: "readwise_connection_required" }, 409);

    const vr = await readwiseFetch("https://readwise.io/api/v2/auth/", rwToken);
    if (vr.status !== 204) {
      await admin.from("knowledge_sources").update({
        status: "error",
        last_error: "Readwise token invalid or revoked",
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("provider", "readwise");
      await admin.from("integration_status").update({
        status: "connection_required",
        metadata: { auth_verified: false, reason: "token_invalid_or_revoked" },
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("provider", "Readwise Reader");
      return json({ error: "readwise_token_invalid_or_revoked" }, 401);
    }

    const { data: src, error: srcError } = await admin.from("knowledge_sources")
      .select("id,last_sync_at,sync_cursor,config")
      .eq("user_id", user.id).eq("provider", "readwise").single();
    if (srcError || !src) throw srcError || new Error("knowledge_source_missing");

    const runStart = new Date().toISOString();
    const baseUpdatedAfter = src.config?.sync_base_updated_after ?? src.last_sync_at ?? null;
    let cursor: string | null = src.sync_cursor ?? null;
    let page = 0;
    let seen = 0;
    let created = 0;
    let updated = 0;
    let nextCursor: string | null = cursor;

    const { data: run, error: runErr } = await admin.from("knowledge_sync_runs").insert({
      user_id: user.id,
      source_id: src.id,
      provider: "readwise",
      status: "running",
      cursor_before: cursor,
      metadata: { updated_after: baseUpdatedAfter, run_started_at: runStart, max_pages: 10 },
    }).select("id").single();
    if (runErr) throw runErr;

    await admin.from("knowledge_sources").update({
      status: "syncing", last_error: null, updated_at: runStart,
    }).eq("id", src.id);

    while (page < 10) {
      const qp = new URLSearchParams();
      qp.set("limit", "100");
      if (baseUpdatedAfter) qp.set("updatedAfter", String(baseUpdatedAfter));
      if (nextCursor) qp.set("pageCursor", nextCursor);

      const rr = await readwiseFetch("https://readwise.io/api/v3/list/?" + qp.toString(), rwToken);
      if (!rr.ok) throw new Error(`readwise_list_failed_${rr.status}`);
      const payload = await rr.json();
      const docs = Array.isArray(payload?.results) ? payload.results : [];
      seen += docs.length;

      const ids = docs.map((d: any) => String(d.id || "")).filter(Boolean);
      let existing = new Set<string>();
      if (ids.length) {
        const { data: ex } = await admin.from("knowledge_items")
          .select("external_id")
          .eq("user_id", user.id)
          .eq("provider", "readwise")
          .in("external_id", ids);
        existing = new Set((ex || []).map((x: any) => x.external_id));
      }

      const rows = docs.filter((d: any) => d?.id).map((d: any) => {
        const externalId = String(d.id);
        if (existing.has(externalId)) updated += 1; else created += 1;
        return {
          user_id: user.id,
          source_id: src.id,
          provider: "readwise",
          external_id: externalId,
          source_url: d.source_url || d.url || null,
          canonical_url: d.source_url || null,
          title: d.title || null,
          author: d.author || null,
          summary: d.summary || null,
          content_excerpt: null,
          notes: d.notes || d.document_note || null,
          tags: tagNames(d.tags),
          category: d.category || null,
          source_location: d.location || null,
          privacy_scope: "private",
          ingestion_status: "normalized",
          published_at: d.published_date || null,
          source_created_at: d.created_at || null,
          source_updated_at: d.updated_at || null,
          metadata: {
            reader_url: d.url || null,
            source: d.source || null,
            site_name: d.site_name || null,
            word_count: d.word_count ?? null,
            reading_time: d.reading_time ?? null,
            listening_time: d.listening_time ?? null,
            content_mode: "metadata_summary_notes_only",
          },
          updated_at: new Date().toISOString(),
        };
      });

      if (rows.length) {
        const { error: upErr } = await admin.from("knowledge_items").upsert(rows, {
          onConflict: "user_id,provider,external_id",
        });
        if (upErr) throw upErr;
      }

      nextCursor = payload?.nextPageCursor || null;
      page += 1;
      if (!nextCursor) break;
    }

    const complete = !nextCursor;
    const nextConfig = {
      ...(src.config || {}),
      credential_mode: "vault_per_user",
      content_mode: "metadata_summary_notes_only",
      ...(complete ? { sync_base_updated_after: null, sync_started_at: null } : {
        sync_base_updated_after: baseUpdatedAfter,
        sync_started_at: src.config?.sync_started_at || runStart,
      }),
    };

    const sourcePatch: any = {
      status: complete ? "verified" : "ready",
      sync_cursor: nextCursor,
      last_error: null,
      config: nextConfig,
      updated_at: new Date().toISOString(),
    };
    if (complete) sourcePatch.last_sync_at = runStart;

    await admin.from("knowledge_sources").update(sourcePatch).eq("id", src.id);

    await admin.from("knowledge_sync_runs").update({
      status: complete ? "success" : "partial",
      items_seen: seen,
      items_created: created,
      items_updated: updated,
      cursor_after: nextCursor,
      finished_at: new Date().toISOString(),
      metadata: {
        updated_after: baseUpdatedAfter,
        pages_processed: page,
        complete,
      },
    }).eq("id", run.id);

    await admin.from("integration_status").update({
      status: "verified",
      last_sync_at: complete ? runStart : null,
      metadata: {
        adapter: "readwise-reader-v1",
        contract: "KnowledgeSourcePort v1",
        credential_storage: "supabase_vault",
        auth_verified: true,
        content_mode: "metadata_summary_notes_only",
        last_sync_complete: complete,
        pages_processed: page,
      },
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("provider", "Readwise Reader");

    return json({
      ok: true,
      complete,
      items_seen: seen,
      items_created: created,
      items_updated: updated,
      pages_processed: page,
      next_cursor: nextCursor,
      ...(await statusPayload(userClient, user.id)),
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
