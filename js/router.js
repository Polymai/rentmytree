/* router.js
 * Hash routing for home, browse, listing detail, dashboard, listing editor,
 * favorites, settings, and auth prompts. Owns URL <-> route mapping only.
 * Data loading is triggered by the navigation callback in main.js.
 */
(function () {
  "use strict";

  var State = window.AppState;

  var routes = [
    { name: "home", re: /^\/?$/, params: function () { return {}; } },
    { name: "browse", re: /^\/browse\/?$/, params: function () { return {}; } },
    { name: "explore", re: /^\/explore\/?$/, params: function () { return {}; } },
    { name: "favorites", re: /^\/favorites\/?$/, params: function () { return {}; } },
    { name: "dashboard", re: /^\/dashboard\/?$/, params: function () { return {}; } },
    { name: "payments", re: /^\/payments\/?$/, params: function () { return {}; } },
    { name: "settings", re: /^\/settings\/?$/, params: function () { return {}; } },
    { name: "listing-new", re: /^\/listings\/new\/?$/, params: function () { return {}; } },
    { name: "listing-edit", re: /^\/listings\/([^/]+)\/edit\/?$/, params: function (m) { return { id: m[1] }; } },
    { name: "listing", re: /^\/listings\/([^/]+)\/?$/, params: function (m) { return { id: m[1] }; } },
    { name: "auth", re: /^\/(signin|signup)\/?$/, params: function (m) { return { mode: m[1] }; } },
  ];

  function parse(hash) {
    var raw = String(hash || "").replace(/^#/, "");
    var split = raw.split("?");
    var path = split[0];
    var query = parseQuery(split.slice(1).join("?"));
    if (!path) path = "/";
    for (var i = 0; i < routes.length; i++) {
      var m = path.match(routes[i].re);
      if (m) {
        var params = routes[i].params(m);
        params.query = query;
        return { name: routes[i].name, params: params };
      }
    }
    return { name: "not-found", params: { path: path, query: query } };
  }

  function parseQuery(queryString) {
    var query = {};
    if (!queryString) return query;
    queryString.split("&").forEach(function (part) {
      if (!part) return;
      var pair = part.split("=");
      var key = decodeURIComponent(pair[0] || "").trim();
      if (!key) return;
      query[key] = decodeURIComponent(pair.slice(1).join("=") || "");
    });
    return query;
  }

  var onNavigate = function () {};

  function handleHashChange() {
    var route = parse(window.location.hash);

    // Auth routes are surfaced as a modal over the current shell, not a page.
    if (route.name === "auth") {
      State.setState({
        authModalOpen: true,
        authMode: route.params.mode === "signup" ? "signup" : "signin",
        authError: "",
        authNotice: "",
      });
      // Redirect the hash back home so the modal can be dismissed cleanly.
      if (window.location.hash !== "#/") {
        window.history.replaceState(null, "", "#/");
      }
      route = { name: "home", params: {} };
    }

    State.setState({ route: route, mobileNavOpen: false });
    onNavigate(route);
  }

  var AppRouter = {
    start: function (navigateHandler) {
      if (typeof navigateHandler === "function") onNavigate = navigateHandler;
      window.addEventListener("hashchange", handleHashChange);
      handleHashChange();
    },

    navigate: function (path) {
      var target = path.charAt(0) === "#" ? path : "#" + path;
      if (window.location.hash === target) {
        handleHashChange(); // re-run loaders for the same route
      } else {
        window.location.hash = target;
      }
    },

    current: function () {
      return parse(window.location.hash);
    },
  };

  window.AppRouter = AppRouter;
})();
