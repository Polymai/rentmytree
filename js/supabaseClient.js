/* supabaseClient.js
 * Initialize the Supabase client, scoped to the app schema, with an app-specific
 * auth storageKey so multiple Polymai apps can safely share one browser origin.
 */
(function () {
  "use strict";

  var cfg = window.AppConfig;
  var AppSupabase = { client: null, ready: false, error: null };

  function init() {
    if (!cfg || !cfg.isSupabaseReady()) {
      AppSupabase.error = "Supabase is not configured yet.";
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      AppSupabase.error = "Supabase client library failed to load.";
      return;
    }
    try {
      AppSupabase.client = window.supabase.createClient(
        cfg.supabase.url,
        cfg.supabase.anonKey,
        {
          db: { schema: cfg.supabase.schema },
          auth: {
            storageKey: cfg.supabase.authStorageKey,
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        }
      );
      AppSupabase.ready = true;
    } catch (e) {
      AppSupabase.error = (e && e.message) || "Could not initialize Supabase.";
    }
  }

  init();

  // Convenience accessor used by api/auth modules.
  AppSupabase.require = function () {
    if (!AppSupabase.ready || !AppSupabase.client) {
      throw new Error(AppSupabase.error || "Supabase is not ready.");
    }
    return AppSupabase.client;
  };

  window.AppSupabase = AppSupabase;
})();
