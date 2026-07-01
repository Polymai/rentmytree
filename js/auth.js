/* auth.js
 * Auth lifecycle: session restore, email + password sign in / sign up,
 * app-local profile bootstrap, auth-change handling, and sign out.
 * Owns auth flow + profile gating; delegates rendering to subscribers.
 */
(function () {
  "use strict";

  var cfg = window.AppConfig;
  var State = window.AppState;
  var Api = window.AppApi;

  function client() {
    return window.AppSupabase.require();
  }

  function storePendingSignup(meta) {
    try {
      var payload = Object.assign({}, meta, { ts: Date.now() });
      window.localStorage.setItem(cfg.storage.pendingSignup, JSON.stringify(payload));
    } catch (e) {}
  }

  function readPendingSignup() {
    try {
      var raw = window.localStorage.getItem(cfg.storage.pendingSignup);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // short TTL: 1 hour
      if (!parsed || !parsed.ts || Date.now() - parsed.ts > 3600000) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearPendingSignup() {
    try {
      window.localStorage.removeItem(cfg.storage.pendingSignup);
    } catch (e) {}
  }

  // Map raw Supabase errors to plain, non-disclosing English copy.
  function friendlyAuthError(err) {
    var msg = (err && err.message) || String(err || "Something went wrong.");
    if (/already registered|already exists|user.*exists/i.test(msg)) {
      return "This email may already work for sign-in. Sign in instead, or reset your password.";
    }
    if (/invalid login credentials/i.test(msg)) {
      return "That email and password don't match. Try again or reset your password.";
    }
    if (/email not confirmed/i.test(msg)) {
      return "Please confirm your email from the link we sent, then sign in.";
    }
    return msg;
  }

  var AppAuth = {
    // Restore an existing session on boot.
    restore: function () {
      return client()
        .auth.getSession()
        .then(function (res) {
          var session = res && res.data ? res.data.session : null;
          return AppAuth.applySession(session);
        });
    },

    // Reflect a session into state and ensure the app-local profile row.
    applySession: function (session) {
      var user = session ? session.user : null;
      var prevUser = State.getState().user;
      // Token refresh for the same signed-in user: keep the fresh session token
      // but do NOT setState — a re-render would wipe unsaved form input (e.g. a
      // half-filled listing editor when the token refreshes mid-edit).
      if (user && prevUser && prevUser.id === user.id) {
        State.getState().session = session;
        return Promise.resolve(State.getState().profile);
      }
      State.setState({ session: session || null, user: user || null });
      if (!user) {
        State.setState({ profile: null, needsProfile: false, favoriteIds: [] });
        return Promise.resolve(null);
      }
      return AppAuth.ensureProfile();
    },

    // Load or create the app-local profile. Idempotent and safe to retry.
    ensureProfile: function () {
      var currentUser = State.getState().user;
      var userId = currentUser && currentUser.id;
      if (!userId) {
        State.setState({ profile: null, needsProfile: false, profileLoading: false });
        return Promise.resolve(null);
      }
      State.setState({ profileLoading: true });
      return Api.getMyProfile(userId)
        .then(function (profile) {
          if (profile) {
            clearPendingSignup();
            State.setState({ profile: profile, needsProfile: false, profileLoading: false });
            return profile;
          }
          // No profile row yet — bootstrap it from pending signup metadata.
          var pending = readPendingSignup() || {};
          return Api.bootstrapProfile({
            fullName: pending.fullName || "",
            location: pending.location || "",
          }).then(function () {
            return Api.getMyProfile(userId).then(function (created) {
              clearPendingSignup();
              State.setState({
                profile: created || null,
                needsProfile: !created,
                profileLoading: false,
              });
              return created;
            });
          });
        })
        .catch(function (err) {
          State.setState({ profileLoading: false, needsProfile: true });
          if (window.console) console.error("ensureProfile", err);
          return null;
        });
    },

    signIn: function (email, password) {
      State.setState({ authPending: true, authError: "", authNotice: "" });
      return client()
        .auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) throw res.error;
          return AppAuth.applySession(res.data.session).then(function () {
            State.setState({ authPending: false, authModalOpen: false });
            return true;
          });
        })
        .catch(function (err) {
          State.setState({ authPending: false, authError: friendlyAuthError(err) });
          return false;
        });
    },

    signUp: function (email, password, meta) {
      State.setState({ authPending: true, authError: "", authNotice: "" });
      storePendingSignup(meta || {});
      return client()
        .auth.signUp({
          email: email,
          password: password,
          options: { emailRedirectTo: cfg.authRedirectUrl() },
        })
        .then(function (res) {
          if (res.error) throw res.error;
          // If email confirmation is required, there is no session yet.
          if (res.data && res.data.session) {
            return AppAuth.applySession(res.data.session).then(function () {
              State.setState({ authPending: false, authModalOpen: false });
              return true;
            });
          }
          State.setState({
            authPending: false,
            authNotice:
              "Check your email to confirm your account, then sign in to finish setting up your grower profile.",
          });
          return true;
        })
        .catch(function (err) {
          State.setState({ authPending: false, authError: friendlyAuthError(err) });
          return false;
        });
    },

    signOut: function () {
      return client()
        .auth.signOut()
        .then(function () {
          clearPendingSignup();
          State.setState({
            session: null,
            user: null,
            profile: null,
            needsProfile: false,
            favoriteIds: [],
            favoriteListings: [],
            myListings: [],
            incomingBookings: [],
            incomingRequests: [],
          });
        });
    },

    // Subscribe to Supabase auth changes (token refresh, sign out from another tab, etc.)
    onChange: function (handler) {
      var sub = client().auth.onAuthStateChange(function (_event, session) {
        Promise.resolve(AppAuth.applySession(session)).then(function () {
          if (typeof handler === "function") handler(session);
        });
      });
      return sub;
    },
  };

  window.AppAuth = AppAuth;
})();
