/* state.js
 * Central app state plus a tiny pub/sub. This module owns state only:
 * no rendering, no data fetching, no routing side effects.
 */
(function () {
  "use strict";

  var listeners = [];

  var state = {
    booted: false,

    // routing
    route: { name: "home", params: {} },

    // auth / identity
    session: null,
    user: null,
    profile: null,
    profileLoading: false,
    needsProfile: false, // signed in but no app-local profile row yet

    // auth UI
    authModalOpen: false,
    authMode: "signin", // signin | signup
    authPending: false,
    authError: "",
    authNotice: "",

    // browse
    listings: [],
    listingsLoading: false,
    listingsError: "",
    filters: { q: "", treeType: "", period: "", maxPrice: "", sort: "newest" },
    userCoords: null, // { lat, lng } when the visitor shares location

    // detail
    selectedListing: null,
    selectedLoading: false,
    selectedError: "",

    // owner dashboard
    myListings: [],
    myListingsLoading: false,
    incomingBookings: [],
    incomingRequests: [],

    // renter's own booking requests (outgoing)
    outgoingBookings: [],

    // favorites
    favoriteIds: [], // array of listing ids the current user saved
    favoriteListings: [],
    favoritesLoading: false,

    // listing editor
    editingListing: null,
    editorLoading: false,

    // generic per-action status, keyed by action id
    requestStatus: {},

    // shell
    mobileNavOpen: false,
  };

  function getState() {
    return state;
  }

  function setState(patch) {
    if (typeof patch === "function") {
      patch = patch(state);
    }
    if (!patch) return state;
    Object.keys(patch).forEach(function (key) {
      state[key] = patch[key];
    });
    notify();
    return state;
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](state);
      } catch (e) {
        // a failing subscriber must not break the others
        if (window.console) console.error("subscriber error", e);
      }
    }
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      var idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  // Helper to set a per-action status without clobbering others.
  function setRequestStatus(id, status) {
    var next = Object.assign({}, state.requestStatus);
    next[id] = status;
    setState({ requestStatus: next });
  }

  window.AppState = {
    getState: getState,
    setState: setState,
    subscribe: subscribe,
    setRequestStatus: setRequestStatus,
  };
})();
