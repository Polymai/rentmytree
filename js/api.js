/* api.js
 * Marketplace data access: profiles, listings, photos, favorites, bookings,
 * and contact requests. This module owns Supabase CRUD only — no rendering,
 * no global state mutation. The client is scoped to the app schema, so table
 * names here are local (e.g. "listings" -> app702_rentmytree.listings).
 */
(function () {
  "use strict";

  function db() {
    return window.AppSupabase.require();
  }

  function currentUserId() {
    return db().auth.getSession().then(function (res) {
      var session = res && res.data ? res.data.session : null;
      return session && session.user ? session.user.id : "";
    });
  }

  function unwrap(res) {
    if (res.error) throw res.error;
    return res.data;
  }

  function functionUrl(name) {
    var base = (window.AppConfig.supabase.functionsBaseUrl || "").replace(/\/+$/, "");
    return base + "/" + name;
  }

  function authHeader() {
    return db().auth.getSession().then(function (res) {
      var token = res && res.data && res.data.session ? res.data.session.access_token : "";
      if (!token) throw new Error("Sign in before starting checkout.");
      return "Bearer " + token;
    });
  }

  function parseFunctionResponse(response) {
    return response.text().then(function (text) {
      var data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        data = { error: text || "Unexpected server response." };
      }
      if (!response.ok) {
        throw new Error(data.error || "Checkout could not be started.");
      }
      return data;
    });
  }

  function mergeRows(lists) {
    var byId = {};
    lists.forEach(function (list) {
      (list || []).forEach(function (row) {
        if (row && row.id) byId[row.id] = row;
      });
    });
    return Object.keys(byId)
      .map(function (id) { return byId[id]; })
      .sort(function (a, b) {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
  }

  function contactSelect(withReplies) {
    var base = "*, listings!inner(id, title, seller_user_id)";
    if (!withReplies) return base;
    return base + ", contact_replies(id, request_id, author_user_id, message, created_at)";
  }

  function contactRowsForUser(userId, withReplies) {
    var select = contactSelect(withReplies);
    return Promise.all([
      db()
        .from("contact_requests")
        .select(select)
        .eq("listings.seller_user_id", userId)
        .order("created_at", { ascending: false }),
      db()
        .from("contact_requests")
        .select(select)
        .eq("sender_user_id", userId)
        .order("created_at", { ascending: false }),
    ]).then(function (results) {
      results.forEach(function (res) {
        if (res.error) throw res.error;
      });
      return mergeRows(results.map(function (res) { return res.data || []; }));
    });
  }

  var AppApi = {
    // ---- profiles -------------------------------------------------------
    bootstrapProfile: function (payload) {
      // Idempotent server-side creation of the app-local profile row.
      return db()
        .rpc("bootstrap_profile", {
          p_full_name: (payload && payload.fullName) || null,
          p_location: (payload && payload.location) || null,
        })
        .then(unwrap);
    },

    getMyProfile: function (userId) {
      function query(uid) {
        if (!uid) return Promise.resolve(null);
        return db()
          .from("profiles")
          .select("*")
          .eq("id", uid)
          .maybeSingle()
          .then(unwrap);
      }

      return userId ? query(userId) : currentUserId().then(query);
    },

    updateProfile: function (id, patch) {
      return db().from("profiles").update(patch).eq("id", id).select("*").single().then(unwrap);
    },

    // ---- listings -------------------------------------------------------
    listPublishedListings: function (filters) {
      filters = filters || {};
      var q = db()
        .from("listings")
        .select("*, listing_photos(id, url, position)")
        .eq("status", "published")
        .order("created_at", { ascending: false });

      if (filters.treeType) q = q.eq("tree_type", filters.treeType);
      if (filters.period) q = q.eq("rental_period", filters.period);
      if (filters.maxPrice) q = q.lte("price_cents", Math.round(Number(filters.maxPrice) * 100));
      if (filters.q) {
        var term = "%" + String(filters.q).replace(/[%_]/g, "") + "%";
        q = q.or("title.ilike." + term + ",description.ilike." + term + ",city.ilike." + term);
      }
      return q.then(unwrap);
    },

    getListing: function (id) {
      return db()
        .from("listings")
        .select("*, listing_photos(id, url, position), profiles:seller_user_id(full_name, location, avatar_url)")
        .eq("id", id)
        .single()
        .then(unwrap);
    },

    listMyListings: function (userId) {
      return db()
        .from("listings")
        .select("*, listing_photos(id, url, position)")
        .eq("seller_user_id", userId)
        .order("created_at", { ascending: false })
        .then(unwrap);
    },

    createListing: function (payload) {
      return db().from("listings").insert(payload).select("*").single().then(unwrap);
    },

    updateListing: function (id, patch) {
      return db().from("listings").update(patch).eq("id", id).select("*").single().then(unwrap);
    },

    deleteListing: function (id) {
      return db().from("listings").delete().eq("id", id).then(unwrap);
    },

    // ---- photos ---------------------------------------------------------
    addPhoto: function (payload) {
      return db().from("listing_photos").insert(payload).select("*").single().then(unwrap);
    },

    deletePhoto: function (id) {
      return db().from("listing_photos").delete().eq("id", id).then(unwrap);
    },

    // Upload an image file to the public media bucket and return its public URL.
    // Path is scoped to the signed-in user's folder to satisfy storage policies:
    //   <user-id>/<listing-id>/<timestamp>-<safe-name>
    uploadListingImage: function (userId, listingId, file) {
      var bucket = window.AppConfig.supabase.storageBucket;
      var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      var safe = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 40) || "photo";
      var path = userId + "/" + listingId + "/" + Date.now() + "-" + safe + "." + ext;
      return db()
        .storage.from(bucket)
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg" })
        .then(function (res) {
          if (res.error) throw res.error;
          var pub = db().storage.from(bucket).getPublicUrl(path);
          return pub && pub.data ? pub.data.publicUrl : "";
        });
    },

    // ---- favorites ------------------------------------------------------
    listFavorites: function (userId) {
      return db()
        .from("favorites")
        .select("listing_id, listings(*, listing_photos(id, url, position))")
        .eq("user_id", userId)
        .then(unwrap);
    },

    addFavorite: function (userId, listingId) {
      return db()
        .from("favorites")
        .insert({ user_id: userId, listing_id: listingId })
        .select("*")
        .single()
        .then(unwrap);
    },

    removeFavorite: function (userId, listingId) {
      return db()
        .from("favorites")
        .delete()
        .eq("user_id", userId)
        .eq("listing_id", listingId)
        .then(unwrap);
    },

    // ---- bookings -------------------------------------------------------
    createBooking: function (payload) {
      return db().from("bookings").insert(payload).select("*").single().then(unwrap);
    },

    createAcceptanceFeeCheckoutSession: function (bookingId) {
      return authHeader().then(function (authorization) {
        var href = window.location.origin + window.location.pathname;
        return fetch(functionUrl("app702-rentmytree-api"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authorization,
          },
          body: JSON.stringify({
            action: "create_acceptance_fee_checkout_session",
            bookingId: bookingId,
            successUrl: href + "#/dashboard?acceptance_fee=success&booking=" + encodeURIComponent(bookingId),
            cancelUrl: href + "#/dashboard?acceptance_fee=cancelled&booking=" + encodeURIComponent(bookingId),
          }),
        }).then(parseFunctionResponse);
      });
    },

    createListingFeeCheckoutSession: function (listingId) {
      return authHeader().then(function (authorization) {
        var href = window.location.origin + window.location.pathname;
        return fetch(functionUrl("app702-rentmytree-api"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authorization,
          },
          body: JSON.stringify({
            action: "create_listing_fee_checkout_session",
            listingId: listingId,
            successUrl: href + "#/dashboard?listing_fee=success&listing=" + encodeURIComponent(listingId),
            cancelUrl: href + "#/listings/" + encodeURIComponent(listingId) + "/edit?listing_fee=cancelled",
          }),
        }).then(parseFunctionResponse);
      });
    },

    refreshAcceptanceFeeReceipt: function (bookingId) {
      return authHeader().then(function (authorization) {
        return fetch(functionUrl("app702-rentmytree-api"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authorization,
          },
          body: JSON.stringify({
            action: "refresh_acceptance_fee_receipt",
            bookingId: bookingId,
          }),
        }).then(parseFunctionResponse);
      });
    },

    refreshListingFeeReceipt: function (listingId) {
      return authHeader().then(function (authorization) {
        return fetch(functionUrl("app702-rentmytree-api"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authorization,
          },
          body: JSON.stringify({
            action: "refresh_listing_fee_receipt",
            listingId: listingId,
          }),
        }).then(parseFunctionResponse);
      });
    },

    listIncomingBookings: function (sellerUserId) {
      return db()
        .from("bookings")
        .select("*, listings!inner(id, title, seller_user_id, rental_period, listing_fee_currency)")
        .eq("listings.seller_user_id", sellerUserId)
        .order("created_at", { ascending: false })
        .then(unwrap);
    },

    updateBookingStatus: function (id, status) {
      return db().from("bookings").update({ status: status }).eq("id", id).select("*").single().then(unwrap);
    },

    // The renter's own booking requests, so they can see the owner's response.
    listMyBookings: function (renterUserId) {
      return db()
        .from("bookings")
        .select("*, listings(id, title, city, seller_user_id, rental_period)")
        .eq("renter_user_id", renterUserId)
        .order("created_at", { ascending: false })
        .then(unwrap);
    },

    // ---- contact requests ----------------------------------------------
    createContactRequest: function (payload) {
      return db().from("contact_requests").insert(payload).select("*").single().then(unwrap);
    },

    listIncomingRequests: function (sellerUserId) {
      return contactRowsForUser(sellerUserId, true).catch(function () {
        return contactRowsForUser(sellerUserId, false);
      });
    },

    updateRequestStatus: function (id, status) {
      return db()
        .from("contact_requests")
        .update({ status: status })
        .eq("id", id)
        .select("*")
        .single()
        .then(unwrap);
    },

    createContactReply: function (payload) {
      return db().from("contact_replies").insert(payload).select("*").single().then(unwrap);
    },
  };

  window.AppApi = AppApi;
})();
