/* actions.js
 * Behavior: event delegation for clicks and form submits, per-route data
 * loaders, and the reusable app-level loader/toast helpers. Owns side effects;
 * reads/writes state through AppState and data through AppApi/AppAuth.
 */
(function () {
  "use strict";

  var cfg = window.AppConfig;
  var State = window.AppState;
  var Api = window.AppApi;
  var Auth = window.AppAuth;
  var Router = window.AppRouter;

  var geocodeCache = {};

  // Listing editor photo state (kept out of app state so the form/map aren't
  // re-rendered while the seller is editing). Reset on each editor load.
  var MAX_PHOTOS = 5;
  var pendingPhotos = []; // [{ file, url(objectURL) }]
  var removedPhotoIds = [];

  function resetPhotoState() {
    pendingPhotos.forEach(function (p) {
      try { URL.revokeObjectURL(p.url); } catch (e) {}
    });
    pendingPhotos = [];
    removedPhotoIds = [];
  }

  /* --------------------------- UI helpers ----------------------------- */
  function showLoader(text) {
    var el = document.getElementById("app-loader");
    var t = document.getElementById("app-loader-text");
    if (t) t.textContent = text || "Working…";
    if (el) {
      el.hidden = false;
      el.setAttribute("aria-busy", "true");
    }
  }

  function hideLoader() {
    var el = document.getElementById("app-loader");
    if (el) {
      el.hidden = true;
      el.setAttribute("aria-busy", "false");
    }
  }

  function toast(message, kind) {
    var region = document.getElementById("toast-region");
    if (!region) return;
    var node = document.createElement("div");
    node.className = "toast toast--" + (kind || "info");
    node.textContent = message;
    region.appendChild(node);
    setTimeout(function () {
      node.classList.add("is-leaving");
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 300);
    }, 3200);
  }

  function requireAuth() {
    var s = State.getState();
    if (!s.user) {
      State.setState({ authModalOpen: true, authMode: "signin", authError: "", authNotice: "" });
      return false;
    }
    return true;
  }

  // Guarantee the signed-in user has an app-local profile row before any insert
  // that references it (contacts, bookings, favorites, listings). Self-heals a
  // missing profile by running the bootstrap RPC.
  function ensureProfileReady() {
    var s = State.getState();
    if (!s.user) return Promise.resolve(null);
    if (s.profile) return Promise.resolve(s.profile);
    return Auth.ensureProfile();
  }

  function profileError(err) {
    var msg = (err && err.message) || "";
    if (/foreign key|fkey|sender_user_id|renter_user_id|user_id|profiles/i.test(msg)) {
      // Surface the complete-profile gate so the bootstrap RPC can run.
      Auth.ensureProfile();
      return "We couldn't find your profile yet. Please complete your profile, then try again.";
    }
    return friendly(err);
  }

  function findContactRequest(id) {
    var rows = State.getState().incomingRequests || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return rows[i];
    }
    return null;
  }

  function threadRequestsFor(request) {
    if (!request) return [];
    var rows = State.getState().incomingRequests || [];
    return rows.filter(function (row) {
      return row.listing_id === request.listing_id && row.sender_user_id === request.sender_user_id;
    });
  }

  function formData(form) {
    var data = {};
    var fd = new FormData(form);
    fd.forEach(function (v, k) {
      data[k] = typeof v === "string" ? v.trim() : v;
    });
    return data;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatDateInput(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function parseDateInput(value) {
    var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
      return null;
    }
    return date;
  }

  function addDays(date, days) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  function addMonths(date, months) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setMonth(next.getMonth() + months);
    return next;
  }

  function normalizeBookingWindow(data, listing) {
    var period = data.bookingPeriod || (listing && listing.rental_period) || "season";
    if (period === "season") {
      var year = Number(data.seasonYear);
      if (!Number.isInteger(year) || year < 2020 || year > 2100) {
        return { error: "Choose a harvest season." };
      }
      return {
        startDate: year + "-01-01",
        endDate: year + "-12-31",
        messagePrefix: "Harvest season: " + year,
      };
    }

    var start = parseDateInput(data.startDate);
    if (!start) return { error: period === "day" ? "Choose a harvest visit date." : "Choose a start date." };

    if (period === "day") {
      return { startDate: formatDateInput(start), endDate: formatDateInput(start), messagePrefix: "Harvest visit: " + formatDateInput(start) };
    }
    if (period === "week") {
      return { startDate: formatDateInput(start), endDate: formatDateInput(addDays(start, 6)), messagePrefix: "Requested week of: " + formatDateInput(start) };
    }
    if (period === "month") {
      return { startDate: formatDateInput(start), endDate: formatDateInput(addDays(addMonths(start, 1), -1)), messagePrefix: "Requested month from: " + formatDateInput(start) };
    }

    var end = parseDateInput(data.endDate);
    if (!end) return { error: "Choose an end date." };
    if (end < start) return { error: "End date must be after the start date." };
    return { startDate: formatDateInput(start), endDate: formatDateInput(end), messagePrefix: "" };
  }

  function bookingMessage(data, windowInfo) {
    var note = data.message || "";
    var prefix = windowInfo && windowInfo.messagePrefix;
    if (!prefix) return note || null;
    return note ? prefix + "\n\n" + note : prefix;
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          reject(new Error("This is taking too long. Please try again."));
        }
      }, ms || 15000);
      promise.then(
        function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } }
      );
    });
  }

  /* --------------------------- data loaders --------------------------- */
  var Loaders = {
    browse: function () {
      var s = State.getState();
      State.setState({ listingsLoading: true, listingsError: "" });
      return withTimeout(Api.listPublishedListings(s.filters))
        .then(function (rows) {
          State.setState({ listings: sortListings(rows || [], s.filters, s.userCoords), listingsLoading: false });
        })
        .catch(function (err) {
          State.setState({ listingsLoading: false, listingsError: friendly(err) });
        });
    },

    home: function () {
      var s = State.getState();
      if (s.listings.length || s.listingsLoading) return Promise.resolve();
      return Api.listPublishedListings({})
        .then(function (rows) { State.setState({ listings: rows || [] }); })
        .catch(function () { /* home preview is non-critical */ });
    },

    explore: function () {
      State.setState({ listingsLoading: true, listingsError: "" });
      return withTimeout(Api.listPublishedListings({}))
        .then(function (rows) { State.setState({ listings: rows || [], listingsLoading: false }); })
        .catch(function (err) { State.setState({ listingsLoading: false, listingsError: friendly(err) }); });
    },

    listing: function (id) {
      State.setState({ selectedLoading: true, selectedError: "", selectedListing: null });
      return withTimeout(Api.getListing(id))
        .then(function (row) { State.setState({ selectedListing: row, selectedLoading: false }); })
        .catch(function (err) { State.setState({ selectedLoading: false, selectedError: friendly(err) }); });
    },

    dashboard: function () {
      if (!requireAuth()) return Promise.resolve();
      var uid = State.getState().user.id;
      State.setState({ myListingsLoading: true });
      return Promise.all([
        Api.listMyListings(uid).catch(function () { return []; }),
        Api.listIncomingBookings(uid).catch(function () { return []; }),
        Api.listIncomingRequests(uid).catch(function () { return []; }),
        Api.listMyBookings(uid).catch(function () { return []; }),
      ]).then(function (res) {
        State.setState({
          myListings: res[0] || [],
          incomingBookings: res[1] || [],
          incomingRequests: res[2] || [],
          outgoingBookings: res[3] || [],
          myListingsLoading: false,
        });
      });
    },

    favorites: function () {
      if (!requireAuth()) return Promise.resolve();
      var uid = State.getState().user.id;
      State.setState({ favoritesLoading: true });
      return Api.listFavorites(uid)
        .then(function (rows) {
          var listings = (rows || []).map(function (r) { return r.listings; }).filter(Boolean);
          State.setState({
            favoriteListings: listings,
            favoriteIds: listings.map(function (l) { return l.id; }),
            favoritesLoading: false,
          });
        })
        .catch(function (err) {
          State.setState({ favoritesLoading: false });
          toast(friendly(err), "error");
        });
    },

    editor: function (id) {
      if (!requireAuth()) return Promise.resolve();
      resetPhotoState();
      if (!id) {
        State.setState({ editingListing: null, editorLoading: false });
        return Promise.resolve();
      }
      State.setState({ editorLoading: true });
      return Api.getListing(id)
        .then(function (row) {
          State.setState({ editingListing: row, editorLoading: false });
        })
        .catch(function (err) {
          State.setState({ editorLoading: false });
          toast(friendly(err), "error");
        });
    },
  };

  // Keep current-user favorites loaded so cards reflect saved state everywhere.
  function syncFavoriteIds() {
    var s = State.getState();
    if (!s.user) return;
    Api.listFavorites(s.user.id)
      .then(function (rows) {
        State.setState({ favoriteIds: (rows || []).map(function (r) { return r.listing_id; }) });
      })
      .catch(function () {});
  }

  function loadRoute(route) {
    switch (route.name) {
      case "home": Loaders.home(); break;
      case "browse": Loaders.browse(); break;
      case "explore": Loaders.explore(); break;
      case "listing": Loaders.listing(route.params.id); break;
      case "dashboard": Loaders.dashboard(); break;
      case "payments": Loaders.dashboard(); break;
      case "favorites": Loaders.favorites(); break;
      case "listing-new": Loaders.editor(null); break;
      case "listing-edit": Loaders.editor(route.params.id); break;
      default: break;
    }
  }

  function friendly(err) {
    return (err && err.message) || "Something went wrong. Please try again.";
  }

  /* --------------------------- click actions -------------------------- */
  var clickHandlers = {
    "toggle-mobile-nav": function () {
      State.setState({ mobileNavOpen: !State.getState().mobileNavOpen });
    },
    "close-mobile-nav": function () {
      State.setState({ mobileNavOpen: false });
    },
    "open-auth": function (el) {
      State.setState({
        authModalOpen: true,
        authMode: el.getAttribute("data-mode") === "signup" ? "signup" : "signin",
        authError: "",
        authNotice: "",
      });
    },
    "close-auth": function () {
      State.setState({ authModalOpen: false, authError: "", authNotice: "" });
    },
    "switch-auth": function (el) {
      State.setState({ authMode: el.getAttribute("data-mode"), authError: "", authNotice: "" });
    },
    "sign-out": function () {
      showLoader("Signing out…");
      Auth.signOut().then(function () {
        hideLoader();
        toast("Signed out.", "info");
        Router.navigate("/");
      });
    },
    "quick-type": function (el) {
      var type = el.getAttribute("data-type");
      var f = Object.assign({}, State.getState().filters, { treeType: type });
      State.setState({ filters: f });
      Router.navigate("/browse");
    },
    "use-my-location-home": function () {
      locateAndBrowse();
    },
    "locate-me": function () {
      if (!navigator.geolocation) {
        toast("Location isn't available on this device.", "info");
        return;
      }
      if (!window.AppGlobe || !AppGlobe.goTo) return;
      showLoader("Finding your location…");
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          hideLoader();
          var lat = pos.coords.latitude;
          var lng = pos.coords.longitude;
          // Fly in to frame the region first, then dive in to city level.
          if (!AppGlobe.goTo(lat, lng, 1.0, 1400)) {
            toast("Spin up the globe first, then try again.", "info");
            return;
          }
          setTimeout(function () { AppGlobe.goTo(lat, lng, 0.15, 1300); }, 1500);
        },
        function () {
          hideLoader();
          toast("Couldn't get your location.", "info");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    },
    "clear-filters": function () {
      State.setState({ filters: { q: "", treeType: "", period: "", maxPrice: "", sort: "newest" } });
      persistFilters();
      Loaders.browse();
    },
    "retry-listings": function () { Loaders.browse(); },
    "retry-detail": function () {
      var r = State.getState().route;
      if (r.params && r.params.id) Loaders.listing(r.params.id);
    },
    "toggle-favorite": function (el) {
      toggleFavorite(el.getAttribute("data-id"));
    },
    "pay-listing-fee": function (el) {
      openListingFeeCheckout(el.getAttribute("data-id"));
    },
    "refresh-listing-receipt": function (el) {
      refreshListingReceipt(el.getAttribute("data-id"));
    },
    "refresh-acceptance-receipt": function (el) {
      refreshAcceptanceReceipt(el.getAttribute("data-id"));
    },
    "delete-listing": function (el) {
      var id = el.getAttribute("data-id");
      if (!window.confirm("Delete this listing? This can't be undone.")) return;
      showLoader("Deleting…");
      Api.deleteListing(id)
        .then(function () {
          hideLoader();
          toast("Listing deleted.", "info");
          Loaders.dashboard();
        })
        .catch(function (err) { hideLoader(); toast(friendly(err), "error"); });
    },
    "set-status": function (el) {
      var id = el.getAttribute("data-id");
      var status = el.getAttribute("data-status");
      // Listing is free — publishing/unpublishing just flips the status.
      Api.updateListing(id, { status: status })
        .then(function () {
          toast(status === "published" ? "Listing published." : "Listing unpublished.", "info");
          Loaders.dashboard();
        })
        .catch(function (err) { toast(friendly(err), "error"); });
    },
    "booking-status": function (el) {
      var id = el.getAttribute("data-id");
      var status = el.getAttribute("data-status");
      // Accepting a booking costs the owner a fixed fee → route through checkout.
      // The webhook flips the booking to 'accepted' once the fee is paid.
      if (status === "accepted") {
        showLoader("Opening secure checkout…");
        Api.createAcceptanceFeeCheckoutSession(id)
          .then(function (checkout) {
            if (checkout && checkout.alreadyPaid) {
              hideLoader();
              return Api.updateBookingStatus(id, "accepted").then(function () {
                toast("Booking accepted.", "success");
                Loaders.dashboard();
              });
            }
            if (!checkout || !checkout.url) throw new Error("Checkout could not be opened.");
            window.location.href = checkout.url;
          })
          .catch(function (err) { hideLoader(); toast(friendly(err), "error"); });
        return;
      }
      Api.updateBookingStatus(id, status)
        .then(function () { toast("Booking updated.", "info"); Loaders.dashboard(); })
        .catch(function (err) { toast(friendly(err), "error"); });
    },
    "request-status": function (el) {
      var ids = (el.getAttribute("data-ids") || el.getAttribute("data-id") || "")
        .split(",")
        .map(function (id) { return id.trim(); })
        .filter(Boolean);
      var status = el.getAttribute("data-status");
      Promise.all(ids.map(function (id) {
        return Api.updateRequestStatus(id, status).catch(function () { return null; });
      }))
        .then(function () { Loaders.dashboard(); })
        .catch(function (err) { toast(friendly(err), "error"); });
    },
    "geocode-search": function (el) {
      geocodeSearchLocation(el);
    },
    "use-my-location": function () {
      useMyLocation();
    },
    "remove-photo": function (el) {
      var pid = el.getAttribute("data-photo-id");
      if (pid && removedPhotoIds.indexOf(pid) < 0) removedPhotoIds.push(pid);
      var tile = el.closest(".photo-tile");
      if (tile && tile.parentNode) tile.parentNode.removeChild(tile);
      refreshPhotoCount();
    },
  };

  function openListingFeeCheckout(id) {
    if (!requireAuth()) return;
    if (!id) {
      toast("Choose a listing before starting checkout.", "error");
      return;
    }
    showLoader("Opening secure checkout...");
    Api.createListingFeeCheckoutSession(id)
      .then(function (checkout) {
        if (checkout && checkout.alreadyPaid) {
          hideLoader();
          toast("Listing fee is already paid.", "success");
          Loaders.dashboard();
          return;
        }
        if (!checkout || !checkout.url) throw new Error("Listing checkout could not be opened.");
        window.location.href = checkout.url;
      })
      .catch(function (err) {
        hideLoader();
        toast(friendly(err), "error");
      });
  }

  function refreshListingReceipt(id) {
    if (!requireAuth()) return;
    if (!id) {
      toast("Choose a listing before finding a receipt.", "error");
      return;
    }
    showLoader("Looking up the Stripe receipt...");
    Api.refreshListingFeeReceipt(id)
      .then(function (result) {
        hideLoader();
        Loaders.dashboard();
        if (result && result.receiptUrl) {
          toast("Receipt found.", "success");
          window.open(result.receiptUrl, "_blank", "noopener");
          return;
        }
        if (result && result.stripeUrl) {
          toast("Opening the Stripe payment record.", "info");
          window.open(result.stripeUrl, "_blank", "noopener");
          return;
        }
        toast("Open Stripe from the payment row to view payment details.", "info");
      })
      .catch(function (err) {
        hideLoader();
        toast(friendly(err), "error");
      });
  }

  function refreshAcceptanceReceipt(id) {
    if (!requireAuth()) return;
    if (!id) {
      toast("Choose a booking before finding a receipt.", "error");
      return;
    }
    showLoader("Looking up the Stripe receipt...");
    Api.refreshAcceptanceFeeReceipt(id)
      .then(function (result) {
        hideLoader();
        Loaders.dashboard();
        if (result && result.receiptUrl) {
          toast("Receipt found.", "success");
          window.open(result.receiptUrl, "_blank", "noopener");
          return;
        }
        if (result && result.stripeUrl) {
          toast("Opening the Stripe payment record.", "info");
          window.open(result.stripeUrl, "_blank", "noopener");
          return;
        }
        toast("Payment details will appear once Stripe confirms the charge.", "info");
      })
      .catch(function (err) {
        hideLoader();
        toast(friendly(err), "error");
      });
  }

  function toggleFavorite(id) {
    if (!requireAuth()) return;
    var s = State.getState();
    var uid = s.user.id;
    var isFav = s.favoriteIds.indexOf(id) >= 0;
    // optimistic update
    var nextIds = isFav
      ? s.favoriteIds.filter(function (x) { return x !== id; })
      : s.favoriteIds.concat([id]);
    State.setState({ favoriteIds: nextIds });

    ensureProfileReady().then(function (profile) {
      if (!profile) throw new Error("profiles");
      return isFav ? Api.removeFavorite(uid, id) : Api.addFavorite(uid, id);
    }).then(function () {
      if (State.getState().route.name === "favorites") Loaders.favorites();
    }).catch(function (err) {
      State.setState({ favoriteIds: s.favoriteIds }); // revert
      toast(profileError(err), "error");
    });
  }

  /* ---------------------------- form submits -------------------------- */
  var formHandlers = {
    auth: function (form) {
      var d = formData(form);
      var s = State.getState();
      if (s.authMode === "signup") {
        Auth.signUp(d.email, d.password, { fullName: d.fullName, location: "" }).then(function (ok) {
          if (ok && State.getState().user) {
            toast("Welcome to FruitLease!", "success");
          }
        });
      } else {
        Auth.signIn(d.email, d.password).then(function (ok) {
          if (ok) toast("Signed in.", "success");
        });
      }
    },

    "complete-profile": function (form) {
      var d = formData(form);
      showLoader("Finishing setup…");
      Api.bootstrapProfile({ fullName: d.fullName, location: d.location })
        .then(function () { return Auth.ensureProfile(); })
        .then(function () {
          hideLoader();
          toast("Profile ready!", "success");
        })
        .catch(function (err) { hideLoader(); toast(friendly(err), "error"); });
    },

    filters: function (form) {
      var d = formData(form);
      var prev = State.getState().filters;
      State.setState({
        filters: {
          q: d.q || "",
          treeType: d.treeType || "",
          period: prev.period || "",
          maxPrice: prev.maxPrice || "",
          sort: d.sort || "newest",
        },
      });
      persistFilters();
      Loaders.browse();
    },

    "hero-search": function (form) {
      var d = formData(form);
      var prev = State.getState().filters;
      State.setState({ filters: Object.assign({}, prev, { q: d.q || "" }) });
      Router.navigate("/browse");
    },

    booking: function (form) {
      if (!requireAuth()) return;
      var id = form.getAttribute("data-id");
      var d = formData(form);
      var key = "booking-" + id;
      var listing = State.getState().selectedListing;
      var windowInfo = normalizeBookingWindow(d, listing);
      if (windowInfo.error) {
        State.setRequestStatus(key, { error: windowInfo.error });
        return;
      }
      State.setRequestStatus(key, { loading: true });
      ensureProfileReady().then(function (profile) {
        if (!profile) {
          State.setRequestStatus(key, { error: "Please complete your profile to continue, then try again." });
          return;
        }
        return Api.createBooking({
          listing_id: id,
          renter_user_id: profile.id,
          start_date: windowInfo.startDate,
          end_date: windowInfo.endDate,
          message: bookingMessage(d, windowInfo),
          total_cents: listing ? listing.price_cents : null,
          status: "pending",
        })
          .then(function () {
            State.setRequestStatus(key, { success: "Request sent! The grower will be in touch." });
            toast("Booking request sent.", "success");
            form.reset();
          });
      })
        .catch(function (err) {
          hideLoader();
          State.setRequestStatus(key, { error: profileError(err) });
        });
    },

    contact: function (form) {
      if (!requireAuth()) return;
      var id = form.getAttribute("data-id");
      var d = formData(form);
      if (!d.message) return;
      var key = "contact-" + id;
      State.setRequestStatus(key, { loading: true });
      ensureProfileReady().then(function (profile) {
        if (!profile) {
          State.setRequestStatus(key, { error: "Please complete your profile to continue, then try again." });
          return;
        }
        return Api.createContactRequest({
          listing_id: id,
          sender_user_id: profile.id,
          message: d.message,
          email: (State.getState().user && State.getState().user.email) || null,
          status: "new",
        })
          .then(function () {
            State.setRequestStatus(key, { success: "Message sent to the grower." });
            form.reset();
          });
      })
        .catch(function (err) {
          State.setRequestStatus(key, { error: profileError(err) });
        });
    },

    "message-reply": function (form) {
      if (!requireAuth()) return;
      var requestId = form.getAttribute("data-request-id");
      var d = formData(form);
      if (!requestId || !d.message) return;
      var key = "reply-" + requestId;
      State.setRequestStatus(key, { loading: true });
      ensureProfileReady().then(function (profile) {
        if (!profile) {
          State.setRequestStatus(key, { error: "Please complete your profile to continue, then try again." });
          return;
        }
        var request = findContactRequest(requestId) || {};
        var listing = request.listings || {};
        var ownerReply = listing.seller_user_id === profile.id;
        return Api.createContactReply({
          request_id: requestId,
          author_user_id: profile.id,
          message: d.message,
        }).then(function () {
          if (ownerReply) {
            return Promise.all(threadRequestsFor(request).map(function (row) {
              return row.status === "read" ? null : Api.updateRequestStatus(row.id, "read").catch(function () { return null; });
            }));
          }
          return null;
        }).then(function () {
          State.setRequestStatus(key, { success: "Reply sent." });
          toast("Reply sent.", "success");
          form.reset();
          Loaders.dashboard();
        });
      })
        .catch(function (err) {
          State.setRequestStatus(key, { error: friendly(err) });
        });
    },

    listing: function (form) {
      if (!requireAuth()) return;
      var d = formData(form);
      var id = form.getAttribute("data-id");
      var uid = State.getState().user.id;
      var editing = State.getState().editingListing || {};
      var requestedStatus = d.status || "published";
      var payload = {
        seller_user_id: uid,
        title: d.title,
        description: d.description || null,
        tree_type: d.treeType,
        rental_period: d.period,
        price_cents: Math.round(Number(d.price || 0) * 100),
        status: requestedStatus, // listing is free — publish straight away
        city: d.city || null,
        address: d.address || null,
        latitude: d.latitude ? Number(d.latitude) : null,
        longitude: d.longitude ? Number(d.longitude) : null,
        // No listing fee. Keep the chosen currency (drives harvest price + the
        // acceptance-fee currency). listing_fee_status is server-owned — leave it
        // to the DB default ('waived') so RLS/column grants aren't violated.
        listing_fee_currency: (d.currency || cfg.detectCurrency()).toLowerCase(),
      };
      State.setRequestStatus("editor", { loading: true });
      var keptExisting = (editing.listing_photos || []).filter(function (p) {
        return removedPhotoIds.indexOf(p.id) < 0;
      }).length;
      var save = id ? Api.updateListing(id, payload) : Api.createListing(payload);
      withTimeout(save)
        .then(function (saved) {
          return syncListingPhotos(uid, saved.id, keptExisting).then(function () {
            resetPhotoState();
            return saved;
          });
        })
        .then(function (saved) {
          hideLoader(); // photo sync may have shown "Saving photos…"
          State.setRequestStatus("editor", { success: "Saved!" });
          toast(id ? "Listing updated." : "Listing published.", "success");
          Router.navigate("/listings/" + saved.id);
          return true;
        })
        .catch(function (err) {
          hideLoader();
          State.setRequestStatus("editor", { error: friendly(err) });
        });
    },

    profile: function (form) {
      if (!requireAuth()) return;
      var d = formData(form);
      var profile = State.getState().profile;
      if (!profile) return;
      State.setRequestStatus("profile", { loading: true });
      Api.updateProfile(profile.id, {
        full_name: d.fullName || null,
        location: d.location || null,
        bio: d.bio || null,
        avatar_url: d.avatarUrl || null,
      })
        .then(function (updated) {
          State.setState({ profile: updated });
          State.setRequestStatus("profile", { success: "Profile saved." });
          toast("Profile saved.", "success");
        })
        .catch(function (err) {
          State.setRequestStatus("profile", { error: friendly(err) });
        });
    },
  };

  /* ----------------------- listing photos ----------------------------- */
  function currentPhotoCount() {
    var existing = (State.getState().editingListing || {}).listing_photos || [];
    var keptExisting = existing.filter(function (p) { return removedPhotoIds.indexOf(p.id) < 0; }).length;
    return keptExisting + pendingPhotos.length;
  }

  function refreshPhotoCount() {
    var el = document.getElementById("photo-count");
    if (el) el.textContent = currentPhotoCount() + " of " + MAX_PHOTOS + " added";
  }

  function onPhotoInput(input) {
    var grid = document.getElementById("photo-grid");
    if (!grid) return;
    var files = Array.prototype.slice.call(input.files || []);
    input.value = ""; // allow re-selecting the same file later
    files.forEach(function (file) {
      if (!/^image\//.test(file.type)) {
        toast("Only image files can be added.", "info");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        toast("“" + file.name + "” is over 8 MB. Choose a smaller image.", "info");
        return;
      }
      if (currentPhotoCount() >= MAX_PHOTOS) {
        toast("You can add up to " + MAX_PHOTOS + " photos.", "info");
        return;
      }
      var url = URL.createObjectURL(file);
      var entry = { file: file, url: url };
      pendingPhotos.push(entry);
      var tile = document.createElement("div");
      tile.className = "photo-tile photo-tile--pending";
      tile.style.backgroundImage = "url('" + url + "')";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "photo-tile__remove";
      btn.setAttribute("aria-label", "Remove photo");
      btn.innerHTML = "&times;";
      btn.addEventListener("click", function () {
        var idx = pendingPhotos.indexOf(entry);
        if (idx >= 0) pendingPhotos.splice(idx, 1);
        try { URL.revokeObjectURL(url); } catch (e) {}
        if (tile.parentNode) tile.parentNode.removeChild(tile);
        refreshPhotoCount();
      });
      tile.appendChild(btn);
      grid.appendChild(tile);
    });
    refreshPhotoCount();
  }

  // Upload pending images to Supabase Storage and reconcile removed photos.
  function syncListingPhotos(uid, listingId, startPosition) {
    var work = removedPhotoIds.map(function (pid) {
      return Api.deletePhoto(pid).catch(function () {});
    });
    var removalsDone = Promise.all(work);

    return removalsDone.then(function () {
      if (!pendingPhotos.length) return;
      showLoader("Saving photos…");
      var pos = startPosition;
      // Upload sequentially to keep order stable and stay gentle on the network.
      return pendingPhotos.reduce(function (chain, entry) {
        return chain.then(function () {
          return Api.uploadListingImage(uid, listingId, entry.file)
            .then(function (publicUrl) {
              if (!publicUrl) return;
              return Api.addPhoto({ listing_id: listingId, url: publicUrl, position: pos++ });
            })
            .catch(function (err) {
              toast("A photo couldn't be saved: " + friendly(err), "error");
            });
        });
      }, Promise.resolve());
    });
  }

  /* ----------------------- browse sorting ----------------------------- */
  function haversine(a, b) {
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var lat1 = toRad(a.lat);
    var lat2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function sortListings(rows, filters, coords) {
    var list = rows.slice();
    var sort = (filters && filters.sort) || "newest";
    if (sort === "price-low") {
      list.sort(function (a, b) { return (a.price_cents || 0) - (b.price_cents || 0); });
    } else if (sort === "nearest" && coords) {
      list.sort(function (a, b) {
        var da = a.latitude != null ? haversine(coords, { lat: a.latitude, lng: a.longitude }) : Infinity;
        var db = b.latitude != null ? haversine(coords, { lat: b.latitude, lng: b.longitude }) : Infinity;
        return da - db;
      });
    }
    return list;
  }

  // Hero "use my location": grab coords, sort by distance, go to browse.
  function locateAndBrowse() {
    if (!navigator.geolocation) {
      toast("Location isn't available on this device.", "info");
      Router.navigate("/browse");
      return;
    }
    showLoader("Finding trees near you…");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        hideLoader();
        var coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        var prev = State.getState().filters;
        State.setState({ userCoords: coords, filters: Object.assign({}, prev, { sort: "nearest" }) });
        Router.navigate("/browse");
      },
      function () {
        hideLoader();
        toast("Couldn't get your location. Showing all trees.", "info");
        Router.navigate("/browse");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  /* --------------------- location picker (editor) --------------------- */
  // Address search -> move the map pin. User-triggered, cached, non-autocomplete.
  function geocodeSearchLocation(button) {
    var form = button.closest("form");
    if (!form) return;
    var searchInput = form.querySelector('[name="locationSearch"]');
    var query = searchInput ? searchInput.value.trim() : "";
    if (!query) {
      toast("Type an address or place to search.", "info");
      return;
    }
    if (geocodeCache[query]) {
      applyHit(geocodeCache[query]);
      return;
    }
    showLoader("Searching for that place…");
    var url = cfg.map.geocoderUrl + "?format=json&addressdetails=1&limit=1&q=" + encodeURIComponent(query);
    withTimeout(
      fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
        if (!r.ok) throw new Error("Lookup failed (" + r.status + ").");
        return r.json();
      }),
      12000
    )
      .then(function (results) {
        hideLoader();
        if (!results || !results.length) {
          toast("No match found. Try a different address or tap the map.", "info");
          return;
        }
        var top = results[0];
        var hit = { lat: Number(top.lat), lon: Number(top.lon), place: placeFromResult(top) };
        geocodeCache[query] = hit;
        applyHit(hit);
        toast("Location found — drag the pin to fine-tune.", "success");
      })
      .catch(function (err) {
        hideLoader();
        toast(friendly(err), "error");
      });
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast("Location isn't available on this device. Search or tap the map.", "info");
      return;
    }
    showLoader("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        hideLoader();
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        if (window.AppRender.setEditorLocation) window.AppRender.setEditorLocation(lat, lng, true);
        toast("Pin dropped at your location — drag to adjust.", "success");
        reverseGeocode(lat, lng);
      },
      function () {
        hideLoader();
        toast("Couldn't get your location. Search an address or tap the map.", "info");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function applyHit(hit) {
    if (window.AppRender.setEditorLocation) window.AppRender.setEditorLocation(hit.lat, hit.lon, true);
    if (hit.place && window.AppRender.fillEditorPlace) window.AppRender.fillEditorPlace(hit.place);
  }

  // Single, user-triggered reverse lookup to suggest a city/address label.
  function reverseGeocode(lat, lng) {
    var url = "https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=" +
      encodeURIComponent(lat) + "&lon=" + encodeURIComponent(lng);
    withTimeout(
      fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
        return r.ok ? r.json() : null;
      }),
      10000
    )
      .then(function (data) {
        if (data && window.AppRender.fillEditorPlace) window.AppRender.fillEditorPlace(placeFromResult(data));
      })
      .catch(function () {});
  }

  function placeFromResult(result) {
    var a = (result && result.address) || {};
    var city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || "";
    var region = a.state_code || a.state || "";
    var cityLabel = city && region ? city + ", " + region : city || region;
    var address = "";
    if (a.house_number && a.road) address = a.house_number + " " + a.road;
    else if (a.road) address = a.road;
    return { city: cityLabel, address: address };
  }

  /* ------------------------- filter persistence ----------------------- */
  function persistFilters() {
    // Filters stay in app state for this lightweight SPA session.
  }

  function restoreFilters() {
    return;
  }

  /* --------------------------- event binding -------------------------- */
  function onClick(evt) {
    var actionEl = evt.target.closest("[data-action]");
    if (actionEl) {
      var name = actionEl.getAttribute("data-action");
      // Backdrop closers (e.g. data-action="close-auth" on the modal backdrop)
      // wrap a protected [data-stop] card. If the real click landed inside that
      // card (on an input, the submit button, etc.), ignore the backdrop action
      // so the popup doesn't dismiss itself or swallow the form submit.
      var stop = evt.target.closest("[data-stop]");
      if (stop && actionEl.contains(stop)) {
        return;
      }
      if (clickHandlers[name]) {
        // For nav links inside drawer, allow default navigation but still close.
        if (actionEl.tagName === "A" && actionEl.hasAttribute("href")) {
          clickHandlers[name](actionEl, evt);
          return;
        }
        evt.preventDefault();
        clickHandlers[name](actionEl, evt);
        return;
      }
    }
  }

  function onSubmit(evt) {
    var form = evt.target.closest("[data-form]");
    if (!form) return;
    var name = form.getAttribute("data-form");
    if (formHandlers[name]) {
      evt.preventDefault();
      formHandlers[name](form);
    }
  }

  function onKeydown(evt) {
    if (evt.key === "Escape") {
      var s = State.getState();
      if (s.authModalOpen) State.setState({ authModalOpen: false });
      else if (s.mobileNavOpen) State.setState({ mobileNavOpen: false });
      return;
    }
    // Enter in the location search box searches instead of submitting the listing.
    if (evt.key === "Enter" && evt.target && evt.target.name === "locationSearch") {
      evt.preventDefault();
      var btn = evt.target.parentNode && evt.target.parentNode.querySelector('[data-action="geocode-search"]');
      if (btn) geocodeSearchLocation(btn);
    }
  }

  function onChange(evt) {
    if (evt.target && evt.target.id === "photo-input") onPhotoInput(evt.target);
  }

  function bindEvents() {
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    document.addEventListener("change", onChange);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", function () {
      if (window.innerWidth > 860 && State.getState().mobileNavOpen) {
        State.setState({ mobileNavOpen: false });
      }
    });
  }

  window.AppActions = {
    bindEvents: bindEvents,
    loadRoute: loadRoute,
    restoreFilters: restoreFilters,
    syncFavoriteIds: syncFavoriteIds,
    showLoader: showLoader,
    hideLoader: hideLoader,
    toast: toast,
  };
})();
