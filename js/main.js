/* main.js
 * Orchestration only: initialize config/auth, restore filters, subscribe the
 * renderer to state, wire global events, start the router, and load data.
 */
(function () {
  "use strict";

  var State = window.AppState;
  var Render = window.AppRender;
  var Router = window.AppRouter;
  var Actions = window.AppActions;
  var Auth = window.AppAuth;
  var Supa = window.AppSupabase;

  function renderNow() {
    var state = State.getState();
    Render.render(state);
    Render.afterRender(state);
  }

  function boot() {
    // Render on every state change.
    State.subscribe(renderNow);

    // Global event delegation + restore persisted UI prefs.
    Actions.bindEvents();
    Actions.restoreFilters();

    // First paint immediately so the shell appears before network work.
    State.setState({ booted: true });

    if (!Supa || !Supa.ready) {
      // Supabase isn't ready: still render the shell, surface a soft notice.
      // Auth can't be restored, so mark it "ready" (we know nobody's signed in).
      State.setState({ authReady: true });
      Actions.toast(Supa && Supa.error ? Supa.error : "Connecting to the orchard…", "info");
      Router.start(Actions.loadRoute);
      return;
    }

    // Restore session, then react to future auth changes.
    Auth.restore()
      .then(function () {
        Actions.syncFavoriteIds();
      })
      .catch(function (e) {
        if (window.console) console.error("session restore", e);
      })
      .then(function () {
        // Session determination is done — safe to prompt sign-in from here on.
        if (!State.getState().authReady) State.setState({ authReady: true });
        // Re-load the current route once auth state is known (e.g. dashboard).
        Actions.loadRoute(State.getState().route);
        Actions.syncFavoriteIds();
      });

    Auth.onChange(function () {
      Actions.syncFavoriteIds();
      Actions.loadRoute(State.getState().route);
    });

    // Start routing (renders current route + triggers its loader).
    Router.start(Actions.loadRoute);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
