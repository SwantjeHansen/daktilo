(() => {
  "use strict";

  const cfg = window.DAKTILO_CONFIG || {};
  const configured = Boolean(
    window.supabase?.createClient &&
    /^https:\/\/.+\.supabase\.co$/i.test(String(cfg.supabaseUrl || "").trim()) &&
    String(cfg.supabasePublishableKey || "").trim() &&
    !String(cfg.supabasePublishableKey).includes("PASTE_")
  );

  const client = configured
    ? window.supabase.createClient(cfg.supabaseUrl.trim(), cfg.supabasePublishableKey.trim(), {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  let activeUserId = null;
  let activeUsername = null;

  function canonicalUsername(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function usernameKey(value) {
    return canonicalUsername(value).toLocaleLowerCase("de-DE").normalize("NFKC");
  }

  function weekKey(date = new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const n = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${n}`;
  }

  function profilePayload(player) {
    const wk = weekKey();
    const storedWeek = player.weekKey === wk ? wk : wk;
    const weekPoints = player.weekKey === wk ? Number(player.weekPoints || 0) : 0;
    return {
      user_id: activeUserId,
      username: canonicalUsername(player.name || activeUsername),
      challenge_points: Number(player.challengePoints || 0),
      training_words: Number(player.trainingWords || 0),
      total_words: Number(player.totalWords || 0),
      total_correct: Number(player.totalCorrect || 0),
      total_replays: Number(player.totalReplays || 0),
      training_ms: Number(player.trainingMs || 0),
      best_challenge_word: Number(player.bestChallengeWord || 0),
      best_streak: Number(player.bestStreak || 0),
      best_threshold_ms: player.bestThresholdMs == null ? null : Number(player.bestThresholdMs),
      last_threshold_ms: player.lastThresholdMs == null ? null : Number(player.lastThresholdMs),
      adaptive_level: Math.max(1, Number(player.trainingAdaptiveLevel || 4)),
      week_key: storedWeek,
      week_points: weekPoints,
      updated_at: new Date().toISOString()
    };
  }

  async function ensureProfile(username) {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) throw userError || new Error("Keine aktive Anmeldung.");
    activeUserId = userData.user.id;

    const clean = canonicalUsername(username);
    const { data: existing, error: selectError } = await client
      .from("daktilo_profiles")
      .select("*")
      .eq("user_id", activeUserId)
      .maybeSingle();
    if (selectError) throw selectError;

    if (!existing) {
      const { error: insertError } = await client.from("daktilo_profiles").insert({
        user_id: activeUserId,
        username: clean,
        week_key: weekKey(),
        week_points: 0,
        adaptive_level: 4
      });
      if (insertError) throw insertError;
    }

    const { data: profile, error: profileError } = await client
      .from("daktilo_profiles")
      .select("*")
      .eq("user_id", activeUserId)
      .single();
    if (profileError) throw profileError;
    activeUsername = profile.username;
    return profile;
  }

  async function loginOrRegister(username, password) {
    if (!configured) return { ok: false, reason: "not_configured" };
    const clean = canonicalUsername(username);

    // A shared device may still contain another Supabase session.
    await client.auth.signOut({ scope: "local" }).catch(() => {});

    let response;
    try {
      response = await fetch(`${cfg.supabaseUrl.trim()}/functions/v1/username-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.supabasePublishableKey.trim()
        },
        body: JSON.stringify({ username: clean, password })
      });
    } catch (err) {
      return { ok: false, reason: "Der Anmeldedienst ist gerade nicht erreichbar." };
    }

    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok || !payload?.ok || !payload?.session?.access_token || !payload?.session?.refresh_token) {
      return { ok: false, reason: payload?.message || "Benutzername oder Passwort ist falsch." };
    }

    const { error: sessionError } = await client.auth.setSession({
      access_token: payload.session.access_token,
      refresh_token: payload.session.refresh_token
    });
    if (sessionError) return { ok: false, reason: "Die Anmeldung konnte nicht gespeichert werden." };

    const profile = await ensureProfile(payload.username || clean);

    if (payload.created) {
      await client.from("daktilo_private_state").upsert({
        user_id: activeUserId,
        state: { player: null },
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      return { ok: true, created: true, username: profile.username, state: { profile, player: null, events: [] } };
    }

    const state = await loadAccountState();
    return { ok: true, created: false, username: profile.username, state };
  }

  async function loadAccountState() {
    if (!configured || !activeUserId) return null;
    const [profileRes, stateRes, eventsRes] = await Promise.all([
      client.from("daktilo_profiles").select("*").eq("user_id", activeUserId).single(),
      client.from("daktilo_private_state").select("state").eq("user_id", activeUserId).maybeSingle(),
      client.from("daktilo_events").select("event").eq("user_id", activeUserId).order("created_at", { ascending: true }).limit(5000)
    ]);
    if (profileRes.error) throw profileRes.error;
    if (stateRes.error) throw stateRes.error;
    if (eventsRes.error) throw eventsRes.error;
    activeUsername = profileRes.data.username;
    return {
      profile: profileRes.data,
      player: stateRes.data?.state?.player || null,
      events: (eventsRes.data || []).map((row) => row.event).filter(Boolean)
    };
  }

  async function syncPlayer(player) {
    if (!configured || !activeUserId || !player) return;
    const publicProfile = profilePayload(player);
    const cleanPlayer = typeof structuredClone === "function" ? structuredClone(player) : JSON.parse(JSON.stringify(player));
    delete cleanPlayer.auth;
    const [p, s] = await Promise.all([
      client.from("daktilo_profiles").upsert(publicProfile, { onConflict: "user_id" }),
      client.from("daktilo_private_state").upsert({
        user_id: activeUserId,
        state: { player: cleanPlayer },
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" })
    ]);
    if (p.error) throw p.error;
    if (s.error) throw s.error;
  }

  async function syncOutcome(player, event) {
    if (!configured || !activeUserId) return;
    await syncPlayer(player);
    if (!event) return;
    const clientId = event.clientId || crypto.randomUUID();
    const payloadEvent = { ...event, clientId };
    const { error } = await client.from("daktilo_events").upsert({
      user_id: activeUserId,
      client_id: clientId,
      created_at: event.at || new Date().toISOString(),
      event: payloadEvent
    }, { onConflict: "client_id" });
    if (error) throw error;
  }

  async function syncEventBatch(events) {
    if (!configured || !activeUserId || !Array.isArray(events) || !events.length) return;
    const rows = events.slice(-5000).map((event) => {
      const clientId = event.clientId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
      event.clientId = clientId;
      return { user_id: activeUserId, client_id: clientId, created_at: event.at || new Date().toISOString(), event };
    });
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await client.from("daktilo_events").upsert(rows.slice(i, i + 200), { onConflict: "client_id" });
      if (error) throw error;
    }
  }

  async function fetchLeaderboard(board) {
    if (!configured) return null;
    const cols = "username,challenge_points,training_words,total_words,total_correct,total_replays,training_ms,best_challenge_word,best_streak,best_threshold_ms,week_key,week_points";
    let query = client.from("daktilo_profiles").select(cols);
    let valueKey = "challenge_points";
    let ascending = false;

    if (board === "training") valueKey = "training_words";
    if (board === "week") {
      valueKey = "week_points";
      query = query.eq("week_key", weekKey());
    }
    if (board === "best") valueKey = "best_challenge_word";
    if (board === "threshold") { valueKey = "best_threshold_ms"; ascending = true; query = query.not("best_threshold_ms", "is", null); }

    query = query.gt(valueKey, 0).order(valueKey, { ascending }).limit(20);
    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((p) => {
      const value = Number(p[valueKey] || 0);
      let meta = "";
      let suffix = "";
      if (board === "total") meta = `${p.total_words || 0} Wörter · ${p.total_words ? Math.round((p.total_correct || 0) / p.total_words * 100) : 0} % korrekt`;
      if (board === "training") { meta = `${Math.round((p.training_ms || 0) / 60000)} min · ${p.total_replays || 0} Replays`; suffix = " Wörter"; }
      if (board === "week") meta = "Aktuelle Kalenderwoche";
      if (board === "best") meta = `Längste Serie: ${p.best_streak || 0}`;
      if (board === "threshold") { meta = "Bestes adaptives 80%-Tempo"; suffix = " ms"; }
      return { name: p.username, value, meta, suffix, lowerIsBetter: board === "threshold" };
    });
  }

  async function logout() {
    if (client) await client.auth.signOut({ scope: "local" });
    activeUserId = null;
    activeUsername = null;
  }

  window.DaktiloCloud = {
    configured,
    client,
    loginOrRegister,
    loadAccountState,
    syncPlayer,
    syncOutcome,
    syncEventBatch,
    fetchLeaderboard,
    logout,
    weekKey
  };
})();
