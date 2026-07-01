/* render.js
 * Pure rendering: read state, produce markup, write it into #app.
 * No state mutation, no fetching, no routing side effects here.
 * Map mounting is an explicit post-render step (AppRender.afterRender).
 */
(function () {
  "use strict";

  var cfg = window.AppConfig;
  var State = window.AppState;

  /* ----------------------------- helpers ------------------------------ */
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Currency-aware money formatter (minor units). Defaults to USD.
  function money(minor, code, decimals) {
    return cfg.formatMoney(minor, code || "USD", decimals);
  }

  function listingCurrency(listing) {
    return (listing && listing.listing_fee_currency) || "USD";
  }

  function periodLabel(value) {
    return cfg.labelFor(cfg.rentalPeriods, value);
  }

  function treeLabel(value) {
    return cfg.labelFor(cfg.treeTypes, value);
  }

  function coverPhoto(listing) {
    var photos = (listing && listing.listing_photos) || [];
    if (!photos.length) return "";
    photos = photos.slice().sort(function (a, b) {
      return (a.position || 0) - (b.position || 0);
    });
    return photos[0].url || "";
  }

  // Per-tree-type art for listings with no photo — one distinct placeholder per
  // tree_type, echoing the foliage/fruit colours of the globe trees.
  var TREE_ART = {
    citrus: { foliage: "#2e7d32", fruit: "#ff9f1c", bg: "#eaf4dd" },
    apple:  { foliage: "#4caf50", fruit: "#e53935", bg: "#eef5e6" },
    stone:  { foliage: "#66bb6a", fruit: "#ff7591", bg: "#f1f6ea" },
    berry:  { foliage: "#5d9c4f", fruit: "#7b2d8e", bg: "#eef3e6" },
    olive:  { foliage: "#8fae8b", fruit: "#566123", bg: "#eef1e6" },
    fig:    { foliage: "#3f7d3a", fruit: "#6a3d9a", bg: "#ecf3e4" },
    nut:    { foliage: "#33691e", fruit: "#8d6e63", bg: "#eef2e3" },
    other:  { foliage: "#4caf50", fruit: "#7cb342", bg: "#eef5e6" },
  };

  // Returns a self-contained SVG data URI usable as a CSS background-image.
  function treePlaceholder(type) {
    var a = TREE_ART[type] || TREE_ART.other;
    var label = treeLabel(type) || "Tree";
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="' + a.bg + '"/>' +
        "</linearGradient></defs>" +
        '<rect width="400" height="300" fill="url(#g)"/>' +
        '<ellipse cx="200" cy="232" rx="140" ry="22" fill="' + a.foliage + '" opacity="0.16"/>' +
        '<rect x="192" y="150" width="16" height="74" rx="6" fill="#7a5230"/>' +
        '<circle cx="166" cy="142" r="42" fill="' + a.foliage + '" opacity="0.92"/>' +
        '<circle cx="234" cy="142" r="42" fill="' + a.foliage + '" opacity="0.92"/>' +
        '<circle cx="200" cy="128" r="56" fill="' + a.foliage + '"/>' +
        '<circle cx="200" cy="110" r="40" fill="' + a.foliage + '" opacity="0.78"/>' +
        '<circle cx="182" cy="122" r="8" fill="' + a.fruit + '"/>' +
        '<circle cx="220" cy="134" r="8" fill="' + a.fruit + '"/>' +
        '<circle cx="200" cy="154" r="7" fill="' + a.fruit + '"/>' +
        '<text x="200" y="262" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="700" fill="#1f5135">' +
          esc(label) + " tree</text>" +
      "</svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function priceBlock(listing) {
    return (
      '<span class="price"><strong>' +
      money(listing.price_cents, listingCurrency(listing)) +
      "</strong> " +
      esc(periodLabel(listing.rental_period)) +
      "</span>"
    );
  }

  function isFavorited(state, id) {
    return state.favoriteIds.indexOf(id) >= 0;
  }

  function selectOptions(list, selected) {
    return list
      .map(function (o) {
        return (
          '<option value="' + esc(o.value) + '"' + (o.value === selected ? " selected" : "") + ">" +
          esc(o.label) + "</option>"
        );
      })
      .join("");
  }

  /* --------------------------- shell / chrome ------------------------- */
  function navLink(state, href, label, routeName) {
    var active = state.route.name === routeName ? " is-active" : "";
    return '<a class="nav-link' + active + '" href="' + href + '" data-nav>' + esc(label) + "</a>";
  }

  function authedNav(state) {
    return (
      navLink(state, "#/browse", "Browse", "browse") +
      navLink(state, "#/explore", "Explore", "explore") +
      navLink(state, "#/favorites", "Favorites", "favorites") +
      navLink(state, "#/dashboard", "Dashboard", "dashboard") +
      navLink(state, "#/payments", "Payments", "payments") +
      navLink(state, "#/settings", "Settings", "settings")
    );
  }

  function publicNav(state) {
    return (
      navLink(state, "#/browse", "Browse", "browse") +
      navLink(state, "#/explore", "Explore", "explore") +
      '<a class="nav-link" href="#/signin" data-nav>Sign in</a>'
    );
  }

  function header(state) {
    var signedIn = !!state.user;
    var links = signedIn ? authedNav(state) : publicNav(state);
    var cta = signedIn
      ? '<a class="btn btn-primary btn-sm" href="#/listings/new" data-nav>List a tree</a>'
      : '<button class="btn btn-primary btn-sm" type="button" data-action="open-auth" data-mode="signup">Get started</button>';

    return (
      '<header class="site-header">' +
        '<div class="container site-header__inner">' +
          '<a class="brand-wordmark" href="#/" data-nav aria-label="FruitLease home">' +
            'Fruit<span class="brand-wordmark__accent">Lease</span>' +
          "</a>" +
          '<nav class="primary-nav" aria-label="Primary">' + links + "</nav>" +
          '<div class="header-actions">' + cta + "</div>" +
          '<button class="nav-toggle" type="button" data-action="toggle-mobile-nav" ' +
            'aria-expanded="' + (state.mobileNavOpen ? "true" : "false") + '" aria-controls="mobile-drawer" aria-label="Menu">' +
            '<span class="nav-toggle__bar"></span><span class="nav-toggle__bar"></span><span class="nav-toggle__bar"></span>' +
          "</button>" +
        "</div>" +
      "</header>" +
      mobileDrawer(state, signedIn, cta)
    );
  }

  function mobileDrawer(state, signedIn, cta) {
    var open = state.mobileNavOpen ? " is-open" : "";
    var links = signedIn ? authedNav(state) : publicNav(state);
    return (
      '<div class="drawer-backdrop' + open + '" data-action="close-mobile-nav"></div>' +
      '<aside id="mobile-drawer" class="mobile-drawer' + open + '" aria-hidden="' + (state.mobileNavOpen ? "false" : "true") + '">' +
        '<div class="mobile-drawer__head">' +
          '<span class="brand-wordmark brand-wordmark--sm">Fruit<span class="brand-wordmark__accent">Lease</span></span>' +
          '<button class="icon-btn" type="button" data-action="close-mobile-nav" aria-label="Close menu">&times;</button>' +
        "</div>" +
        '<nav class="mobile-nav" aria-label="Mobile">' + links + "</nav>" +
        '<div class="mobile-drawer__cta">' + cta + "</div>" +
        (signedIn
          ? '<button class="btn btn-ghost btn-block" type="button" data-action="sign-out">Sign out</button>'
          : "") +
      "</aside>"
    );
  }

  function footer() {
    return (
      '<footer class="site-footer">' +
        '<div class="container site-footer__inner">' +
          '<div>' +
            '<span class="brand-wordmark brand-wordmark--sm">Fruit<span class="brand-wordmark__accent">Lease</span></span>' +
            '<p class="muted">' + esc(cfg.tagline) + "</p>" +
          "</div>" +
          '<nav class="footer-links" aria-label="Footer">' +
            '<a href="#/browse" data-nav>Browse trees</a>' +
            '<a href="#/explore" data-nav>Explore the globe</a>' +
            '<a href="#/listings/new" data-nav>List your tree</a>' +
            '<a href="#/favorites" data-nav>Favorites</a>' +
          "</nav>" +
        "</div>" +
        '<div class="container site-footer__legal muted">Map data &copy; OpenStreetMap contributors.</div>' +
      "</footer>"
    );
  }

  /* ------------------------------ home -------------------------------- */
  function homeView(state) {
    var preview = state.listings.slice(0, 3);
    var previewMarkup = preview.length
      ? preview.map(listingCard.bind(null, state)).join("")
      : '<div class="empty-inline">Fresh listings are sprouting soon.</div>';

    return (
      '<section class="hero hero--home"' + (cfg.heroImage ? ' style="--hero-img:url(\'' + esc(cfg.heroImage) + "')\"" : "") + ">" +
        '<div class="hero__overlay"></div>' +
        '<div class="hero__inner">' +
          '<p class="eyebrow">Rent a fruit, olive or nut tree &amp; keep the harvest</p>' +
          '<h1 class="hero__h1" aria-label="Find your fruit tree">Find your ' +
            '<span class="type-word"><span id="hero-type" class="type-word__text"></span><span class="type-caret" aria-hidden="true"></span></span>' +
            " tree</h1>" +
          '<p class="hero__lead">From a crate of homegrown oranges to a basket of olives, figs or almonds — rent a neighbour’s tree for the season and pick the harvest yourself.</p>' +
          '<form class="hero-search" data-form="hero-search" role="search">' +
            '<span class="hero-search__icon" aria-hidden="true">🔍</span>' +
            '<input class="hero-search__input" name="q" type="search" placeholder="Try “orange”, “olive”, or your town…" aria-label="Search trees" value="' + esc(state.filters.q) + '" />' +
            '<button class="hero-search__loc" type="button" data-action="use-my-location-home" title="Use my location" aria-label="Use my location">📍</button>' +
            '<button class="btn btn-primary hero-search__btn" type="submit">Search</button>' +
          "</form>" +
          '<ul class="chip-row">' +
            cfg.treeTypes
              .map(function (t) {
                return '<li><button class="chip" type="button" data-action="quick-type" data-type="' + esc(t.value) + '">' + esc(t.label) + "</button></li>";
              })
              .join("") +
          "</ul>" +
          '<a class="scroll-cue" href="#/explore" data-nav aria-label="Explore the globe"><span></span></a>' +
        "</div>" +
      "</section>" +

      '<section class="section globe-section" data-reveal>' +
        '<div class="container globe-section__inner">' +
          '<div class="globe-section__copy">' +
            '<p class="eyebrow">A world of trees</p>' +
            "<h2>See every tree on the globe</h2>" +
            '<p class="muted">Spin the planet to discover trees growers have shared around the world. Tap any tree to open its listing.</p>' +
            '<a class="btn btn-outline" href="#/explore" data-nav>Open full globe &rarr;</a>' +
          "</div>" +
          '<div id="home-globe" class="globe globe--home" role="img" aria-label="3D globe of listed trees">' +
            '<div class="globe-placeholder"><span aria-hidden="true">🌍</span><p>Loading the globe…</p></div>' +
          "</div>" +
        "</div>" +
      "</section>" +

      '<section class="section container" data-reveal>' +
        '<div class="section-head">' +
          "<h2>Fresh from the orchard</h2>" +
          '<a class="link-more" href="#/browse" data-nav>See all trees &rarr;</a>' +
        "</div>" +
        '<div class="card-grid">' + previewMarkup + "</div>" +
      "</section>" +

      '<section class="section section--muted" data-reveal>' +
        '<div class="container how">' +
          "<h2>How FruitLease works</h2>" +
          '<div class="how__grid">' +
            howStep("1", "Find a tree", "Search or spin the globe for citrus, apple, olive, fig and nut trees near you.") +
            howStep("2", "Book the season", "Send a request for the harvest season you want and agree on terms with the grower.") +
            howStep("3", "Pick the harvest", "Coordinate access with the grower and harvest the fruit or nuts yourself.") +
          "</div>" +
        "</div>" +
      "</section>" +

      '<section class="section container faq">' +
        "<h2>Common questions</h2>" +
        faqItem("What can I rent?", "Harvest-bearing trees only — citrus, apple and pear, stone fruit, berry, olive, fig and grape, and nut trees. You rent a tree for the season and keep its harvest.") +
        faqItem("How much does it cost to post a tree?", "Listing a tree is free. You only pay a small fee (" + acceptFeeLabel(cfg.detectCurrency()) + ") when you accept a booking — so you never pay before you have a renter. Owners keep the harvest price they set.") +
        faqItem("How do payments work?", "Listing is free. When a booking request comes in, the owner pays a small acceptance fee to confirm it, then arranges the harvest and payment directly with the renter.") +
        faqItem("Can I list my own tree?", "Yes — if you have a fruit, olive or nut tree, create a free grower profile, add photos and a location, and publish in minutes.") +
      "</section>"
    );
  }

  function howStep(num, title, body) {
    return (
      '<article class="how__step">' +
        '<span class="how__num">' + esc(num) + "</span>" +
        "<h3>" + esc(title) + "</h3>" +
        '<p class="muted">' + esc(body) + "</p>" +
      "</article>"
    );
  }

  function faqItem(q, a) {
    return (
      '<details class="faq__item">' +
        "<summary>" + esc(q) + "</summary>" +
        '<p class="muted">' + esc(a) + "</p>" +
      "</details>"
    );
  }

  /* ------------------------------ cards ------------------------------- */
  function listingCard(state, listing) {
    var photo = coverPhoto(listing);
    var media = photo
      ? '<div class="card__media" style="background-image:url(\'' + esc(photo) + "')\"></div>"
      : '<div class="card__media card__media--placeholder" style="background-image:url(\'' + treePlaceholder(listing.tree_type) + "')\"></div>";
    var favClass = isFavorited(state, listing.id) ? " is-active" : "";
    var place = listing.city ? listing.city : (listing.address || "Location on request");

    return (
      '<article class="card">' +
        '<a class="card__link" href="#/listings/' + esc(listing.id) + '" data-nav>' + media + "</a>" +
        '<button class="fav-btn' + favClass + '" type="button" data-action="toggle-favorite" data-id="' + esc(listing.id) + '" ' +
          'aria-pressed="' + (isFavorited(state, listing.id) ? "true" : "false") + '" aria-label="Save to favorites">&#9829;</button>' +
        '<div class="card__body">' +
          '<span class="tag">' + esc(treeLabel(listing.tree_type)) + "</span>" +
          '<h3 class="card__title"><a href="#/listings/' + esc(listing.id) + '" data-nav>' + esc(listing.title) + "</a></h3>" +
          '<p class="card__place muted">' + esc(place) + "</p>" +
          '<div class="card__foot">' + priceBlock(listing) + "</div>" +
        "</div>" +
      "</article>"
    );
  }

  /* ------------------------------ browse ------------------------------ */
  function browseView(state) {
    var f = state.filters;
    var content;
    if (state.listingsLoading) {
      content = loadingGrid();
    } else if (state.listingsError) {
      content = errorState("We couldn't load trees", state.listingsError, "retry-listings");
    } else if (!state.listings.length) {
      content = emptyState("No trees match yet", "Try widening your filters, or be the first to list a tree in this area.");
    } else {
      content = '<div class="card-grid">' + state.listings.map(listingCard.bind(null, state)).join("") + "</div>";
    }

    var count = state.listingsLoading ? "Loading trees…" : state.listings.length + " tree" + (state.listings.length === 1 ? "" : "s");
    var sort = state.filters.sort || "newest";

    return (
      '<section class="browse">' +
        '<div class="container">' +
          '<div class="browse__head">' +
            "<div><h1>Browse trees</h1>" +
            '<p class="muted">' + esc(count) + (state.userCoords ? " · sorted by distance" : "") + "</p></div>" +
          "</div>" +

          '<form class="filter-bar" data-form="filters">' +
            '<div class="filter-bar__search">' +
              '<span aria-hidden="true">🔍</span>' +
              '<input name="q" type="search" placeholder="Search trees, fruit, or town…" aria-label="Search" value="' + esc(f.q) + '" />' +
            "</div>" +
            '<select name="treeType" aria-label="Tree type"><option value="">All types</option>' + selectOptions(cfg.treeTypes, f.treeType) + "</select>" +
            '<select name="sort" aria-label="Sort"><option value="newest"' + (sort === "newest" ? " selected" : "") + ">Newest</option>" +
              '<option value="price-low"' + (sort === "price-low" ? " selected" : "") + ">Price: low to high</option>" +
              '<option value="nearest"' + (sort === "nearest" ? " selected" : "") + ">Nearest</option></select>" +
            '<button class="btn btn-primary btn-sm" type="submit">Search</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" data-action="clear-filters">Clear</button>' +
          "</form>" +

          '<div class="browse__layout">' +
            '<div class="browse__list">' + content + "</div>" +
            '<div class="browse__map">' +
              '<div id="browse-map" class="map" role="application" aria-label="Map of available trees"></div>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  /* ------------------------------ explore ----------------------------- */
  function exploreView(state) {
    var withCoords = state.listings.filter(function (l) {
      return l.latitude != null && l.longitude != null && isFinite(l.latitude) && isFinite(l.longitude);
    }).length;
    var sub = state.listingsLoading
      ? "Loading trees…"
      : withCoords + " tree" + (withCoords === 1 ? "" : "s") + " mapped worldwide";
    return (
      '<section class="explore">' +
        '<div id="explore-globe" class="globe globe--explore" role="img" aria-label="3D globe of every listed tree">' +
          '<div class="globe-placeholder"><span aria-hidden="true">🌍</span><p>Spinning up the globe…</p></div>' +
        "</div>" +
        '<div class="explore__overlay">' +
          '<p class="eyebrow">Explore</p>' +
          "<h1>Trees around the world</h1>" +
          '<p class="muted">' + esc(sub) + '. Drag to spin, scroll to zoom, tap a tree to open it.</p>' +
          '<div class="explore__actions">' +
            '<button class="btn btn-sm explore__locate" type="button" data-action="locate-me">📍 Go to my location</button>' +
            '<a class="btn btn-primary btn-sm" href="#/browse" data-nav>Browse the list</a>' +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  /* ------------------------------ detail ------------------------------ */
  function detailView(state) {
    if (state.selectedLoading) {
      return '<section class="section container"><div class="skeleton-detail">Loading listing…</div></section>';
    }
    if (state.selectedError) {
      return '<section class="section container">' + errorState("Listing unavailable", state.selectedError, "retry-detail") + "</section>";
    }
    var l = state.selectedListing;
    if (!l) {
      return '<section class="section container">' + emptyState("Listing not found", "This tree may have been unlisted.") + "</section>";
    }

    var photos = (l.listing_photos || []).slice().sort(function (a, b) {
      return (a.position || 0) - (b.position || 0);
    });
    var gallery = photos.length
      ? '<div class="gallery">' +
          photos
            .map(function (p) {
              return '<div class="gallery__item" style="background-image:url(\'' + esc(p.url) + "')\"></div>";
            })
            .join("") +
        "</div>"
      : '<div class="gallery gallery--placeholder"><div class="gallery__item" style="background-image:url(\'' + treePlaceholder(l.tree_type) + "')\"></div></div>";

    var seller = l.profiles || {};
    var hasCoords = isFinite(l.latitude) && isFinite(l.longitude) && l.latitude !== null && l.longitude !== null;
    var favClass = isFavorited(state, l.id) ? " is-active" : "";
    var owner = state.user && l.seller_user_id === state.user.id;

    return (
      '<section class="detail container">' +
        '<a class="back-link" href="#/browse" data-nav>&larr; Back to browse</a>' +
        '<div class="detail__grid">' +
          '<div class="detail__main">' +
            gallery +
            '<div class="detail__head">' +
              '<span class="tag">' + esc(treeLabel(l.tree_type)) + "</span>" +
              "<h1>" + esc(l.title) + "</h1>" +
              '<p class="detail__place"><span class="detail__pin" aria-hidden="true">📍</span> ' +
                esc(l.city || l.address || "Location shared after booking") + "</p>" +
            "</div>" +
            '<div class="detail__section">' +
              '<h2 class="detail__subhead">About this tree</h2>' +
              '<div class="detail__desc"><p>' + esc(l.description || "The grower hasn't added a description yet.").replace(/\n/g, "<br />") + "</p></div>" +
            "</div>" +
            locationBlock(l, hasCoords) +
          "</div>" +

          '<aside class="detail__aside">' +
            '<div class="booking-card">' +
              '<div class="booking-card__price">' + priceBlock(l) + "</div>" +
              '<p class="muted booking-card__seller">Offered by ' + esc(seller.full_name || "a local grower") + "</p>" +
              (owner
                ? '<a class="btn btn-primary btn-block" href="#/listings/' + esc(l.id) + '/edit" data-nav>Edit this listing</a>'
                : bookingForm(state, l)) +
              '<button class="btn btn-ghost btn-block fav-inline' + favClass + '" type="button" data-action="toggle-favorite" data-id="' + esc(l.id) + '">' +
                (isFavorited(state, l.id) ? "&#9829; Saved" : "&#9825; Save to favorites") +
              "</button>" +
            "</div>" +
            (owner ? "" : contactForm(state, l)) +
          "</aside>" +
        "</div>" +
      "</section>"
    );
  }

  function locationBlock(l, hasCoords) {
    var place = l.city || l.address || "";
    if (hasCoords) {
      return (
        '<div class="detail__section">' +
          '<h2 class="detail__subhead">Where it grows</h2>' +
          '<div id="detail-map" class="map map--detail" role="application" aria-label="Tree location map"></div>' +
        "</div>"
      );
    }
    return (
      '<div class="detail__section">' +
        '<h2 class="detail__subhead">Where it grows</h2>' +
        '<div class="location-hidden">' +
          '<span class="location-hidden__pin" aria-hidden="true">🌳</span>' +
          "<div>" +
            "<strong>" + esc(place || "Shared after booking") + "</strong>" +
            '<p class="muted">The exact spot is revealed once the grower accepts your booking request.</p>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function bookingForm(state, listing) {
    if (!state.user) {
      return (
        '<button class="btn btn-primary btn-block" type="button" data-action="open-auth" data-mode="signin">Sign in to request</button>' +
        '<p class="muted form-hint">Create a free account to request this tree.</p>'
      );
    }
    var st = state.requestStatus["booking-" + listing.id] || {};
    return (
      '<form class="booking-form" data-form="booking" data-id="' + esc(listing.id) + '">' +
        bookingWindowFields(listing) +
        '<div class="field"><label for="b-msg">Note to grower</label><textarea id="b-msg" name="message" rows="3" placeholder="Tell the grower about your plans…"></textarea></div>' +
        '<button class="btn btn-primary btn-block" type="submit"' + (st.loading ? " disabled" : "") + ">" +
          (st.loading ? "Sending…" : "Request booking") +
        "</button>" +
        statusLine(st) +
      "</form>"
    );
  }

  function todayInputValue() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function bookingWindowFields(listing) {
    var period = (listing && listing.rental_period) || "season";
    var today = todayInputValue();
    if (period === "season") {
      var year = new Date().getFullYear();
      var options = [year, year + 1, year + 2]
        .map(function (y) {
          return '<option value="' + esc(y) + '">' + esc(y + " harvest season") + "</option>";
        })
        .join("");
      return (
        '<input type="hidden" name="bookingPeriod" value="season" />' +
        '<div class="booking-window booking-window--season">' +
          '<div class="field"><label for="b-season">Harvest season</label><select id="b-season" name="seasonYear" required>' + options + "</select></div>" +
          '<p class="muted form-hint">This listing is priced for the whole harvest season. Use the note for timing, picking days, or access questions.</p>' +
        "</div>"
      );
    }
    if (period === "day") {
      return (
        '<input type="hidden" name="bookingPeriod" value="day" />' +
        '<div class="booking-window">' +
          '<div class="field"><label for="b-start">Harvest visit date</label><input id="b-start" name="startDate" type="date" min="' + esc(today) + '" required autocomplete="off" /></div>' +
          '<p class="muted form-hint">The daily price covers one visit on the selected date.</p>' +
        "</div>"
      );
    }
    if (period === "week" || period === "month") {
      return (
        '<input type="hidden" name="bookingPeriod" value="' + esc(period) + '" />' +
        '<div class="booking-window">' +
          '<div class="field"><label for="b-start">Preferred start date</label><input id="b-start" name="startDate" type="date" min="' + esc(today) + '" required autocomplete="off" /></div>' +
          '<p class="muted form-hint">The ' + esc(period) + "ly price covers one " + esc(period) + " from this date. The grower can confirm the exact access window.</p>" +
        "</div>"
      );
    }
    return (
      '<input type="hidden" name="bookingPeriod" value="custom" />' +
      '<div class="grid-2 booking-window">' +
        '<div class="field"><label for="b-start">Start date</label><input id="b-start" name="startDate" type="date" min="' + esc(today) + '" required autocomplete="off" /></div>' +
        '<div class="field"><label for="b-end">End date</label><input id="b-end" name="endDate" type="date" min="' + esc(today) + '" required autocomplete="off" /></div>' +
      "</div>"
    );
  }

  function contactForm(state, listing) {
    if (!state.user) return "";
    var st = state.requestStatus["contact-" + listing.id] || {};
    return (
      '<form class="contact-form card-soft" data-form="contact" data-id="' + esc(listing.id) + '">' +
        "<h3>Ask the grower</h3>" +
        '<div class="field"><label for="c-msg">Message</label><textarea id="c-msg" name="message" rows="3" required placeholder="Is this tree available in May?"></textarea></div>' +
        '<button class="btn btn-outline btn-block" type="submit"' + (st.loading ? " disabled" : "") + ">" +
          (st.loading ? "Sending…" : "Send message") +
        "</button>" +
        statusLine(st) +
      "</form>"
    );
  }

  function statusLine(st) {
    if (!st) return "";
    if (st.error) return '<p class="form-status form-status--error" role="alert">' + esc(st.error) + "</p>";
    if (st.success) return '<p class="form-status form-status--ok" role="status">' + esc(st.success) + "</p>";
    return "";
  }

  function routeNotice(state) {
    var query = (state.route && state.route.params && state.route.params.query) || {};
    if (query.listing_fee === "success") {
      return (
        '<div class="route-notice route-notice--success" role="status">' +
          "<strong>Listing fee paid.</strong>" +
          "<span>Your listing publishes after confirmation. The receipt link appears in Payments below once the charge is confirmed.</span>" +
        "</div>"
      );
    }
    if (query.listing_fee === "cancelled") {
      return (
        '<div class="route-notice" role="status">' +
          "<strong>Checkout cancelled.</strong>" +
          "<span>Your draft was saved. Publish it when you are ready to pay the listing fee.</span>" +
        "</div>"
      );
    }
    if (query.acceptance_fee === "success") {
      return (
        '<div class="route-notice route-notice--success" role="status">' +
          "<strong>Booking accepted.</strong>" +
          "<span>The acceptance fee is paid. The renter can now see it's confirmed — arrange the harvest and payment with them directly.</span>" +
        "</div>"
      );
    }
    if (query.acceptance_fee === "cancelled") {
      return (
        '<div class="route-notice" role="status">' +
          "<strong>Acceptance cancelled.</strong>" +
          "<span>The booking is still pending. Accept it when you're ready to pay the small fee.</span>" +
        "</div>"
      );
    }
    return "";
  }

  /* ---------------------------- dashboard ----------------------------- */
  function dashboardView(state) {
    if (!state.user) return authGateView("Sign in to your grower dashboard", "signin");

    var listingsBlock;
    if (state.myListingsLoading) {
      listingsBlock = loadingGrid();
    } else if (!state.myListings.length) {
      listingsBlock = emptyState("No listings yet", "List your first tree to start renting it out to neighbors.", "#/listings/new", "List a tree");
    } else {
      listingsBlock =
        '<div class="owner-grid">' +
        state.myListings.map(ownerListingRow.bind(null, state)).join("") +
        "</div>";
    }

    return (
      '<section class="section container dashboard">' +
        '<div class="section-head">' +
          "<div><h1>Your dashboard</h1><p class=\"muted\">Manage your listings, bookings, and messages.</p></div>" +
          '<a class="btn btn-primary" href="#/listings/new" data-nav>List a tree</a>' +
        "</div>" +
        routeNotice(state) +

        '<div class="stat-row">' +
          statCard(state.myListings.length, "Listings") +
          statCard(state.incomingBookings.filter(function (b) { return b.status === "pending"; }).length, "Pending bookings") +
          statCard(state.incomingRequests.filter(function (r) { return r.status === "new"; }).length, "New messages") +
        "</div>" +

        '<h2 class="subhead">Your listings</h2>' + listingsBlock +
        '<h2 class="subhead">Payments</h2>' + paymentsPanel(state) +

        '<h2 class="subhead">Booking requests</h2>' + bookingsTable(state) +
        '<h2 class="subhead">Messages</h2>' + requestsList(state) +
      "</section>"
    );
  }

  function statCard(num, label) {
    return (
      '<div class="stat-card">' +
        '<span class="stat-card__label">' + esc(label) + "</span>" +
        '<span class="stat-card__num">' + esc(num) + "</span>" +
      "</div>"
    );
  }

  function ownerListingRow(state, listing) {
    var photo = coverPhoto(listing);
    var media = photo
      ? '<div class="owner-row__media" style="background-image:url(\'' + esc(photo) + "')\"></div>"
      : '<div class="owner-row__media owner-row__media--placeholder" style="background-image:url(\'' + treePlaceholder(listing.tree_type) + "')\"></div>";
    var fee = listing.listing_fee_status
      ? '<span class="payment-pill payment-pill--' + esc(listing.listing_fee_status) + '">' + esc(listingFeeLabel(listing.listing_fee_status)) + "</span>"
      : "";
    return (
      '<article class="owner-row">' +
        media +
        '<div class="owner-row__body">' +
          '<div class="owner-row__top">' +
            '<a class="owner-row__title" href="#/listings/' + esc(listing.id) + '" data-nav>' + esc(listing.title) + "</a>" +
            '<span class="status status--' + esc(listing.status) + '">' + esc(cfg.labelFor(cfg.listingStatuses, listing.status)) + "</span>" +
          "</div>" +
          '<p class="muted">' + priceBlock(listing) + " &middot; " + esc(treeLabel(listing.tree_type)) + fee + "</p>" +
          '<div class="owner-row__actions">' +
            '<a class="btn btn-sm btn-outline" href="#/listings/' + esc(listing.id) + '/edit" data-nav>Edit</a>' +
            (listing.status === "published"
              ? '<button class="btn btn-sm btn-ghost" type="button" data-action="set-status" data-id="' + esc(listing.id) + '" data-status="archived">Unpublish</button>'
              : '<button class="btn btn-sm btn-ghost" type="button" data-action="set-status" data-id="' + esc(listing.id) + '" data-status="published">Publish</button>') +
            '<button class="btn btn-sm btn-danger" type="button" data-action="delete-listing" data-id="' + esc(listing.id) + '">Delete</button>' +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function paymentsPanel(state) {
    if (state.myListingsLoading) {
      return '<div class="data-list"><div class="data-row"><span class="muted">Loading payment records...</span></div></div>';
    }
    // Acceptance fees the owner has paid (or started) on their bookings.
    var feeBookings = (state.incomingBookings || []).filter(function (b) {
      return b.acceptance_fee_status && b.acceptance_fee_status !== "unpaid";
    });
    // Any legacy listings that actually paid a listing fee (free listings are 'waived').
    var legacyPaid = (state.myListings || []).filter(function (l) {
      return l.listing_fee_status === "paid";
    });
    if (!feeBookings.length && !legacyPaid.length) {
      return emptyState("No payments yet", "When you accept a booking, the acceptance fee and its receipt show up here.");
    }
    var rows = feeBookings.map(acceptancePaymentRow).join("") + legacyPaid.map(paymentRow).join("");
    return '<div class="payments-list">' + rows + "</div>";
  }

  function acceptanceFeeStatusLabel(v) {
    if (v === "paid") return "Fee paid";
    if (v === "checkout_pending") return "Checkout pending";
    if (v === "failed") return "Fee failed";
    if (v === "waived") return "Fee waived";
    return "Unpaid";
  }

  function acceptancePaymentRow(b) {
    var status = b.acceptance_fee_status || "unpaid";
    var code = (b.acceptance_fee_currency || (b.listings && b.listings.listing_fee_currency) || cfg.detectCurrency()).toUpperCase();
    var amountLabel = b.acceptance_fee_cents
      ? money(b.acceptance_fee_cents, code, cfg.currencyDecimals(code)) + " incl. VAT"
      : acceptFeeLabel(code);
    var title = b.listings ? b.listings.title : "Listing";
    var paidAt = b.acceptance_fee_paid_at ? new Date(b.acceptance_fee_paid_at).toLocaleDateString() : "";
    var meta = (paidAt ? "Paid " + paidAt : "In progress") + " &middot; " + esc(bookingWindowLabel(b));
    var actions = [];
    if (status === "paid") {
      if (b.acceptance_fee_receipt_url) {
        actions.push('<a class="btn btn-sm btn-outline" href="' + esc(b.acceptance_fee_receipt_url) + '" target="_blank" rel="noopener">View receipt</a>');
      } else {
        actions.push('<button class="btn btn-sm btn-outline" type="button" data-action="refresh-acceptance-receipt" data-id="' + esc(b.id) + '">Find receipt</button>');
      }
    }
    return (
      '<div class="payment-row">' +
        '<div class="payment-row__main">' +
          "<strong>" + esc(title) + "</strong>" +
          '<span class="muted">' + esc(amountLabel) + " acceptance fee &middot; " + meta + "</span>" +
        "</div>" +
        '<span class="payment-pill payment-pill--' + esc(status) + '">' + esc(acceptanceFeeStatusLabel(status)) + "</span>" +
        '<div class="payment-row__actions">' + actions.join("") + "</div>" +
      "</div>"
    );
  }

  // Localised listing fee with VAT added (display only). Uses the listing's
  // stored currency when present, otherwise the visitor's detected currency.
  function feeLabel(listing) {
    var code = (listing && listing.listing_fee_currency) || cfg.detectCurrency();
    var f = cfg.feeFor(code);
    var net = (listing && listing.listing_fee_cents) || f.net;
    var gross = Math.round(net * (1 + cfg.pricing.vatRate));
    return money(gross, f.code, f.decimals) + " incl. " + f.vatPct + "% VAT";
  }

  // Fixed acceptance fee (owner pays on accepting a booking), VAT-inclusive.
  function acceptFeeLabel(code) {
    var f = cfg.acceptanceFeeFor(code);
    return money(f.gross, f.code, f.decimals) + " incl. " + f.vatPct + "% VAT";
  }

  function paymentRow(listing) {
    var status = listing.listing_fee_status || "unpaid";
    var paid = status === "paid" || status === "waived";
    var paidAt = listing.listing_fee_paid_at ? new Date(listing.listing_fee_paid_at).toLocaleDateString() : "";
    var meta = paidAt ? "Paid " + paidAt : "Due before publishing";
    var actions = [];

    if (paid) {
      if (listing.listing_fee_receipt_url) {
        actions.push('<a class="btn btn-sm btn-outline" href="' + esc(listing.listing_fee_receipt_url) + '" target="_blank" rel="noopener">View receipt</a>');
      } else {
        actions.push('<button class="btn btn-sm btn-outline" type="button" data-action="refresh-listing-receipt" data-id="' + esc(listing.id) + '">Find receipt</button>');
      }
    } else {
      actions.push(
        '<button class="btn btn-sm btn-primary" type="button" data-action="pay-listing-fee" data-id="' + esc(listing.id) + '">' +
          (status === "checkout_pending" ? "Resume checkout" : "Pay listing fee") +
        "</button>"
      );
    }

    return (
      '<div class="payment-row">' +
        '<div class="payment-row__main">' +
          '<strong><a href="#/listings/' + esc(listing.id) + '/edit" data-nav>' + esc(listing.title) + "</a></strong>" +
          '<span class="muted">' + esc(feeLabel(listing)) + " listing fee &middot; " + esc(meta) + "</span>" +
        "</div>" +
        '<span class="payment-pill payment-pill--' + esc(status) + '">' + esc(listingFeeLabel(status)) + "</span>" +
        '<div class="payment-row__actions">' + actions.join("") + "</div>" +
      "</div>"
    );
  }

  function paymentsView(state) {
    if (!state.user) return authGateView("Sign in to view payments", "signin");
    return (
      '<section class="section container dashboard payments-page">' +
        '<div class="section-head">' +
          "<div><h1>Payments</h1><p class=\"muted\">Your booking acceptance fees and receipts.</p></div>" +
          '<a class="btn btn-primary" href="#/listings/new" data-nav>List a tree</a>' +
        "</div>" +
        routeNotice(state) +
        paymentsPanel(state) +
      "</section>"
    );
  }

  function bookingsTable(state) {
    if (!state.incomingBookings.length) {
      return emptyState("No booking requests yet", "Booking requests from renters will show up here.");
    }
    var rows = state.incomingBookings
      .map(function (b) {
        var title = b.listings ? b.listings.title : "Listing";
        var feeCode = (b.listings && b.listings.listing_fee_currency) || cfg.detectCurrency();
        var feeAmount = cfg.acceptanceFeeFor(feeCode);
        var feeShort = money(feeAmount.gross, feeAmount.code, feeAmount.decimals);
        return (
          '<div class="data-row">' +
            '<div><strong>' + esc(title) + "</strong><br /><span class=\"muted\">" + esc(bookingWindowLabel(b)) + "</span></div>" +
            '<span class="status status--' + esc(b.status) + '">' + esc(cfg.labelFor(cfg.bookingStatuses, b.status)) + "</span>" +
            '<div class="data-row__actions">' +
              (b.status === "pending"
                ? '<button class="btn btn-sm btn-primary" type="button" data-action="booking-status" data-id="' + esc(b.id) + '" data-status="accepted">Accept (' + esc(feeShort) + " fee)</button>" +
                  '<button class="btn btn-sm btn-ghost" type="button" data-action="booking-status" data-id="' + esc(b.id) + '" data-status="declined">Decline</button>'
                : '<button class="btn btn-sm btn-ghost" type="button" data-action="booking-status" data-id="' + esc(b.id) + '" data-status="completed">Mark complete</button>') +
            "</div>" +
          "</div>"
        );
      })
      .join("");
    return '<div class="data-list">' + rows + "</div>";
  }

  function bookingWindowLabel(booking) {
    var period = booking && booking.listings ? booking.listings.rental_period : "";
    if (period === "season") {
      var season = seasonYearFromBooking(booking);
      return season ? season + " harvest season" : "Harvest season";
    }
    if (period === "day") {
      return booking.start_date ? "Harvest visit on " + formatShortDate(booking.start_date) : "Harvest visit";
    }
    if (period === "week") {
      return booking.start_date ? "Week of " + formatShortDate(booking.start_date) : "One-week request";
    }
    if (period === "month") {
      return booking.start_date ? "Month from " + formatShortDate(booking.start_date) : "One-month request";
    }
    if (booking && booking.start_date && booking.end_date) {
      return formatShortDate(booking.start_date) + " to " + formatShortDate(booking.end_date);
    }
    return "Requested window";
  }

  function seasonYearFromBooking(booking) {
    var msg = (booking && booking.message) || "";
    var match = msg.match(/Harvest season:\s*(\d{4})/i);
    if (match) return match[1];
    if (booking && booking.start_date) return String(booking.start_date).slice(0, 4);
    return "";
  }

  function formatShortDate(value) {
    if (!value) return "";
    try {
      var parts = String(value).split("-");
      if (parts.length === 3) {
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      }
      return new Date(value).toLocaleDateString();
    } catch (e) {
      return value;
    }
  }

  function paymentLabel(value) {
    if (value === "checkout_pending") return "Checkout pending";
    if (value === "paid") return "Paid";
    if (value === "failed") return "Payment failed";
    if (value === "refunded") return "Refunded";
    return value || "";
  }

  function listingFeeLabel(value) {
    if (value === "checkout_pending") return "Listing checkout pending";
    if (value === "paid") return "Listing fee paid";
    if (value === "failed") return "Listing fee failed";
    if (value === "waived") return "Listing fee waived";
    return "Listing fee due";
  }

  function requestsList(state) {
    if (!state.incomingRequests.length) {
      return emptyState("No messages yet", "Questions from renters will appear here.");
    }
    return '<div class="message-thread-list">' + groupContactRequests(state).map(messageThread.bind(null, state)).join("") + "</div>";
  }

  function groupContactRequests(state) {
    var groups = {};
    (state.incomingRequests || []).forEach(function (request) {
      var key = (request.listing_id || "listing") + "::" + (request.sender_user_id || "sender");
      var listing = request.listings || {};
      if (!groups[key]) {
        groups[key] = {
          key: key,
          listingId: request.listing_id,
          ownerId: listing.seller_user_id || "",
          senderId: request.sender_user_id || "",
          title: listing.title || "Listing",
          email: request.email || "",
          requests: [],
          latestAt: 0,
        };
      }
      groups[key].requests.push(request);
      groups[key].latestAt = Math.max(groups[key].latestAt, messageTimestamp(request));
    });

    return Object.keys(groups)
      .map(function (key) {
        var group = groups[key];
        group.requests.sort(function (a, b) {
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        });
        group.latestRequest = group.requests[group.requests.length - 1];
        group.unreadIds = group.requests
          .filter(function (request) { return request.status === "new"; })
          .map(function (request) { return request.id; });
        return group;
      })
      .sort(function (a, b) { return b.latestAt - a.latestAt; });
  }

  function messageTimestamp(request) {
    var latest = new Date(request.created_at || 0).getTime();
    ((request && request.contact_replies) || []).forEach(function (reply) {
      latest = Math.max(latest, new Date(reply.created_at || 0).getTime());
    });
    return latest;
  }

  function messageThread(state, group) {
    var userId = state.user && state.user.id;
    var isOwner = group.ownerId === userId;
    var participant = isOwner
      ? (group.email || "a renter")
      : "the grower";
    var events = messageEvents(group);
    var request = group.latestRequest || {};
    var status = isOwner && group.unreadIds.length ? "new" : "read";
    var statusText = isOwner ? (group.unreadIds.length ? "New" : "Read") : "Sent";
    var st = state.requestStatus["reply-" + request.id] || {};
    var count = events.length + " message" + (events.length === 1 ? "" : "s");

    return (
      '<article class="message-thread">' +
        '<div class="message-thread__head">' +
          '<div class="message-thread__title">' +
            '<strong><a href="#/listings/' + esc(group.listingId) + '" data-nav>' + esc(group.title) + "</a></strong>" +
            '<span class="muted">' + esc(count + " with " + participant) + "</span>" +
          "</div>" +
          '<span class="status status--' + esc(status) + '">' + esc(statusText) + "</span>" +
        "</div>" +
        '<div class="message-thread__body">' + events.map(messageBubble.bind(null, state, group)).join("") + "</div>" +
        '<form class="reply-form" data-form="message-reply" data-request-id="' + esc(request.id) + '">' +
          '<label for="reply-' + esc(request.id) + '">' + esc(isOwner ? "Answer this message" : "Reply to the grower") + "</label>" +
          '<textarea id="reply-' + esc(request.id) + '" name="message" rows="2" required placeholder="' + esc(isOwner ? "Write a clear answer for the renter..." : "Add a follow-up message...") + '"></textarea>' +
          '<div class="reply-form__actions">' +
            (group.unreadIds.length && isOwner
              ? '<button class="btn btn-sm btn-ghost" type="button" data-action="request-status" data-ids="' + esc(group.unreadIds.join(",")) + '" data-status="read">Mark thread read</button>'
              : "") +
            '<button class="btn btn-sm btn-primary" type="submit"' + (st.loading ? " disabled" : "") + ">" + (st.loading ? "Sending..." : "Send reply") + "</button>" +
          "</div>" +
          statusLine(st) +
        "</form>" +
      "</article>"
    );
  }

  function messageEvents(group) {
    var events = [];
    group.requests.forEach(function (request) {
      events.push({
        id: request.id,
        requestId: request.id,
        authorId: request.sender_user_id,
        message: request.message,
        createdAt: request.created_at,
        kind: "request",
      });
      ((request && request.contact_replies) || []).forEach(function (reply) {
        events.push({
          id: reply.id,
          requestId: request.id,
          authorId: reply.author_user_id,
          message: reply.message,
          createdAt: reply.created_at,
          kind: "reply",
        });
      });
    });
    return events.sort(function (a, b) {
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
  }

  function messageBubble(state, group, item) {
    var currentUserId = state.user && state.user.id;
    var mine = item.authorId === currentUserId;
    var author = mine ? "You" : (item.authorId === group.ownerId ? "Grower" : (group.email || "Renter"));
    return (
      '<div class="message-bubble' + (mine ? " message-bubble--mine" : "") + '">' +
        '<div class="message-bubble__meta">' +
          '<strong>' + esc(author) + "</strong>" +
          '<span>' + esc(formatDateTime(item.createdAt)) + "</span>" +
        "</div>" +
        '<p>' + esc(item.message || "") + "</p>" +
      "</div>"
    );
  }

  function formatDateTime(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  /* ------------------------- listing editor --------------------------- */
  function editorView(state) {
    if (!state.user) return authGateView("Sign in to list a tree", "signin");
    var editing = state.editingListing;
    var isEdit = state.route.name === "listing-edit";
    if (isEdit && state.editorLoading) {
      return '<section class="section container"><div class="skeleton-detail">Loading listing…</div></section>';
    }
    var l = editing || {};
    var st = state.requestStatus.editor || {};
    var curCode = l.listing_fee_currency ? l.listing_fee_currency.toUpperCase() : cfg.detectCurrency();

    return (
      '<section class="section container editor">' +
        '<a class="back-link" href="#/dashboard" data-nav>&larr; Back to dashboard</a>' +
        "<h1>" + (isEdit ? "Edit listing" : "List a tree") + "</h1>" +
        routeNotice(state) +
        '<div class="cost-banner" role="note">' +
          "<strong>Free to list.</strong>" +
          '<span>You only pay a small fee (<span class="js-accept-fee">' + esc(acceptFeeLabel(curCode)) + "</span>) when you accept a booking. The price below is the harvest price you set.</span>" +
        "</div>" +
        '<form class="form-card" data-form="listing" data-id="' + esc(l.id || "") + '">' +
          '<div class="field"><label for="l-title">Title</label>' +
            '<input id="l-title" name="title" required maxlength="120" placeholder="Heritage apple, fruiting now" value="' + esc(l.title || "") + '" /></div>' +
          '<div class="grid-2">' +
            '<div class="field"><label for="l-type">Tree type</label><select id="l-type" name="treeType">' + selectOptions(cfg.treeTypes, l.tree_type || "citrus") + "</select></div>" +
            '<div class="field"><label for="l-period">Rental period</label><select id="l-period" name="period">' + selectOptions(cfg.rentalPeriods, l.rental_period || "season") + "</select></div>" +
          "</div>" +
          '<div class="grid-2">' +
            '<div class="field"><label for="l-price">Harvest rental price</label>' +
              '<div class="money-input">' +
                '<input id="l-price" name="price" type="number" min="0" step="1" required value="' + esc(l.price_cents ? l.price_cents / 100 : "") + '" />' +
                '<select name="currency" aria-label="Payout currency" title="Currency you want to be paid in (also sets your acceptance-fee currency)">' + selectOptions(cfg.currencyOptions(), curCode) + "</select>" +
              "</div></div>" +
            '<div class="field"><label for="l-status">Status</label><select id="l-status" name="status">' + selectOptions(cfg.listingStatuses, l.status || "published") + "</select></div>" +
          "</div>" +
          '<div class="field"><label for="l-desc">Description</label>' +
            '<textarea id="l-desc" name="description" rows="5" placeholder="Variety, height, care notes, what makes it special…">' + esc(l.description || "") + "</textarea></div>" +
          locationPicker(l) +
          photoUploader(l) +
          '<div class="form-actions">' +
            '<button class="btn btn-primary" type="submit"' + (st.loading ? " disabled" : "") + ">" + (st.loading ? "Saving…" : isEdit ? "Save changes" : "Save listing") + "</button>" +
            (isEdit ? '<a class="btn btn-ghost" href="#/listings/' + esc(l.id || "") + '" data-nav>View</a>' : "") +
          "</div>" +
          statusLine(st) +
        "</form>" +
      "</section>"
    );
  }

  function locationPicker(l) {
    var hasPin = l.latitude != null && l.longitude != null && isFinite(l.latitude) && isFinite(l.longitude);
    var readout = hasPin
      ? "Pin set: " + Number(l.latitude).toFixed(5) + ", " + Number(l.longitude).toFixed(5)
      : "No location set yet — tap the map, search, or use your location.";
    return (
      '<div class="location-picker">' +
        '<label class="picker-label">Where is your tree?</label>' +
        '<p class="muted form-hint">Tap the map to drop a pin, drag it to fine-tune, search an address, or use your current location.</p>' +
        '<div class="picker-search">' +
          '<input type="text" name="locationSearch" placeholder="Search address, city, or landmark…" autocomplete="off" />' +
          '<button class="btn btn-outline btn-sm" type="button" data-action="geocode-search">Search</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-action="use-my-location">📍 Use my location</button>' +
        "</div>" +
        '<div id="editor-map" class="map map--picker" role="application" aria-label="Pick your tree location on the map"></div>' +
        '<p id="pin-readout" class="pin-readout' + (hasPin ? " is-set" : "") + '">' + esc(readout) + "</p>" +
        '<input type="hidden" name="latitude" value="' + esc(l.latitude != null ? l.latitude : "") + '" />' +
        '<input type="hidden" name="longitude" value="' + esc(l.longitude != null ? l.longitude : "") + '" />' +
        '<div class="grid-2">' +
          '<div class="field"><label for="l-city">City / area (shown publicly)</label><input id="l-city" name="city" placeholder="Portland, OR" value="' + esc(l.city || "") + '" /></div>' +
          '<div class="field"><label for="l-address">Address (kept private)</label><input id="l-address" name="address" placeholder="Street address" value="' + esc(l.address || "") + '" /></div>' +
        "</div>" +
      "</div>"
    );
  }

  var MAX_PHOTOS = 5;

  function photoUploader(l) {
    var photos = (l.listing_photos || []).slice().sort(function (a, b) {
      return (a.position || 0) - (b.position || 0);
    });
    var existing = photos
      .map(function (p) {
        return (
          '<div class="photo-tile" data-photo-id="' + esc(p.id) + '" style="background-image:url(\'' + esc(p.url) + "')\">" +
            '<button type="button" class="photo-tile__remove" data-action="remove-photo" data-photo-id="' + esc(p.id) + '" aria-label="Remove photo">&times;</button>' +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="photo-uploader" data-existing="' + photos.length + '">' +
        '<label class="picker-label">Photos <span class="muted">(up to ' + MAX_PHOTOS + ")</span></label>" +
        '<p class="muted form-hint">Add up to ' + MAX_PHOTOS + " photos of your tree. They're saved securely and shown on your listing.</p>" +
        '<div id="photo-grid" class="photo-grid">' + existing + "</div>" +
        '<label class="btn btn-outline btn-sm photo-add">' +
          "<span>Add photos</span>" +
          '<input id="photo-input" type="file" accept="image/*" multiple hidden />' +
        "</label>" +
        '<span id="photo-count" class="muted form-hint photo-count">' + photos.length + " of " + MAX_PHOTOS + " added</span>" +
      "</div>"
    );
  }

  /* ----------------------------- favorites ---------------------------- */
  function favoritesView(state) {
    if (!state.user) return authGateView("Sign in to see your favorites", "signin");
    var content;
    if (state.favoritesLoading) {
      content = loadingGrid();
    } else if (!state.favoriteListings.length) {
      content = emptyState("No favorites yet", "Tap the heart on any tree to save it here for later.", "#/browse", "Browse trees");
    } else {
      content = '<div class="card-grid">' + state.favoriteListings.map(listingCard.bind(null, state)).join("") + "</div>";
    }
    return (
      '<section class="section container">' +
        '<div class="section-head"><h1>Your favorites</h1></div>' +
        content +
      "</section>"
    );
  }

  /* ----------------------------- settings ----------------------------- */
  function settingsView(state) {
    if (!state.user) return authGateView("Sign in to manage your account", "signin");
    var p = state.profile || {};
    var st = state.requestStatus.profile || {};
    return (
      '<section class="section container settings">' +
        '<div class="section-head"><h1>Settings</h1></div>' +
        '<form class="form-card" data-form="profile">' +
          "<h2>Grower profile</h2>" +
          '<div class="field"><label for="p-name">Full name</label><input id="p-name" name="fullName" value="' + esc(p.full_name || "") + '" placeholder="Your name" /></div>' +
          '<div class="field"><label for="p-location">Location</label><input id="p-location" name="location" value="' + esc(p.location || "") + '" placeholder="City, State" /></div>' +
          '<div class="field"><label for="p-bio">About you</label><textarea id="p-bio" name="bio" rows="4" placeholder="Tell renters about your trees and garden…">' + esc(p.bio || "") + "</textarea></div>" +
          '<div class="field"><label for="p-avatar">Avatar URL</label><input id="p-avatar" name="avatarUrl" type="url" value="' + esc(p.avatar_url || "") + '" placeholder="https://…" /></div>' +
          '<div class="form-actions"><button class="btn btn-primary" type="submit"' + (st.loading ? " disabled" : "") + ">" + (st.loading ? "Saving…" : "Save profile") + "</button></div>" +
          statusLine(st) +
        "</form>" +
        '<div class="account-row">' +
          '<div><strong>' + esc((state.user && state.user.email) || "") + "</strong><p class=\"muted\">Signed in</p></div>" +
          '<button class="btn btn-ghost" type="button" data-action="sign-out">Sign out</button>' +
        "</div>" +
      "</section>"
    );
  }

  /* ------------------------ shared sub-views -------------------------- */
  function authGateView(title, mode) {
    return (
      '<section class="section container">' +
        '<div class="auth-gate">' +
          "<h1>" + esc(title) + "</h1>" +
          '<p class="muted">Sign-in is handled securely by Supabase. If you have used another service from the same provider, the same account may work here.</p>' +
          '<button class="btn btn-primary" type="button" data-action="open-auth" data-mode="' + esc(mode) + '">Sign in</button>' +
        "</div>" +
      "</section>"
    );
  }

  function emptyState(title, body, href, cta) {
    return (
      '<div class="empty-state">' +
        '<span class="empty-state__leaf" aria-hidden="true"></span>' +
        "<h3>" + esc(title) + "</h3>" +
        '<p class="muted">' + esc(body) + "</p>" +
        (href ? '<a class="btn btn-primary btn-sm" href="' + esc(href) + '" data-nav>' + esc(cta) + "</a>" : "") +
      "</div>"
    );
  }

  function errorState(title, message, retryAction) {
    return (
      '<div class="error-state" role="alert">' +
        "<h3>" + esc(title) + "</h3>" +
        '<p class="muted">' + esc(message) + "</p>" +
        '<button class="btn btn-outline btn-sm" type="button" data-action="' + esc(retryAction) + '">Try again</button>' +
      "</div>"
    );
  }

  function loadingGrid() {
    var cells = "";
    for (var i = 0; i < 6; i++) cells += '<div class="card card--skeleton"><div class="card__media"></div><div class="card__body"><span class="sk-line"></span><span class="sk-line sk-line--short"></span></div></div>';
    return '<div class="card-grid">' + cells + "</div>";
  }

  /* ---------------------------- auth modal ---------------------------- */
  function authModal(state) {
    if (!state.authModalOpen) return "";
    var signup = state.authMode === "signup";
    return (
      '<div class="modal-backdrop" data-action="close-auth">' +
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" data-stop>' +
          '<button class="icon-btn modal__close" type="button" data-action="close-auth" aria-label="Close">&times;</button>' +
          '<h2 id="auth-title">' + (signup ? "Create your account" : "Welcome back") + "</h2>" +
          '<p class="muted modal__sub">' + (signup ? "Join FruitLease to rent and list trees." : "Sign in to book and manage your trees.") + "</p>" +
          '<form class="auth-form" data-form="auth">' +
            (signup ? '<div class="field"><label for="a-name">Full name</label><input id="a-name" name="fullName" placeholder="Your name" autocomplete="name" /></div>' : "") +
            '<div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" required autocomplete="email" placeholder="you@email.com" /></div>' +
            '<div class="field"><label for="a-password">Password</label><input id="a-password" name="password" type="password" required minlength="6" autocomplete="' + (signup ? "new-password" : "current-password") + '" placeholder="••••••••" /></div>' +
            (state.authError ? '<p class="form-status form-status--error" role="alert">' + esc(state.authError) + "</p>" : "") +
            (state.authNotice ? '<p class="form-status form-status--ok" role="status">' + esc(state.authNotice) + "</p>" : "") +
            '<button class="btn btn-primary btn-block" type="submit"' + (state.authPending ? " disabled" : "") + ">" +
              (state.authPending ? "Please wait…" : signup ? "Create account" : "Sign in") +
            "</button>" +
          "</form>" +
          '<p class="auth-switch muted">' +
            (signup
              ? 'Already have an account? <button type="button" class="link-btn" data-action="switch-auth" data-mode="signin">Sign in</button>'
              : 'New here? <button type="button" class="link-btn" data-action="switch-auth" data-mode="signup">Create an account</button>') +
          "</p>" +
          '<p class="trust-note muted">Sign-in is handled securely by Supabase. If you have used another service from the same provider, the same account may work here.</p>' +
        "</div>" +
      "</div>"
    );
  }

  function profileGate(state) {
    if (!state.user || !state.needsProfile) return "";
    return (
      '<div class="modal-backdrop">' +
        '<div class="modal" role="dialog" aria-modal="true" data-stop>' +
          "<h2>Finish setting up your profile</h2>" +
          '<p class="muted">We just need a name to complete your grower profile.</p>' +
          '<form class="auth-form" data-form="complete-profile">' +
            '<div class="field"><label for="g-name">Full name</label><input id="g-name" name="fullName" required placeholder="Your name" /></div>' +
            '<div class="field"><label for="g-location">Location</label><input id="g-location" name="location" placeholder="City, State" /></div>' +
            '<button class="btn btn-primary btn-block" type="submit">Complete profile</button>' +
          "</form>" +
        "</div>" +
      "</div>"
    );
  }

  /* ------------------------------ route map --------------------------- */
  function routeView(state) {
    switch (state.route.name) {
      case "home": return homeView(state);
      case "browse": return browseView(state);
      case "explore": return exploreView(state);
      case "listing": return detailView(state);
      case "favorites": return favoritesView(state);
      case "dashboard": return dashboardView(state);
      case "payments": return paymentsView(state);
      case "settings": return settingsView(state);
      case "listing-new":
      case "listing-edit": return editorView(state);
      default:
        return '<section class="section container">' + emptyState("Page not found", "That page wandered off into the woods.", "#/", "Go home") + "</section>";
    }
  }

  /* ----------------------------- render ------------------------------- */
  function render(state) {
    var root = document.getElementById("app");
    if (!root) return;
    root.setAttribute("aria-busy", "false");
    root.innerHTML =
      header(state) +
      '<main id="view" class="view">' + routeView(state) + "</main>" +
      footer() +
      authModal(state) +
      profileGate(state);
  }

  /* --------------------- post-render map mounting --------------------- */
  var maps = { browse: null, detail: null, editor: null };
  var editorMarker = null;
  var isEditorRoute = false;

  function destroyMap(key) {
    if (maps[key]) {
      try { maps[key].remove(); } catch (e) {}
      maps[key] = null;
    }
  }

  /* ----------------------- hero typewriter ---------------------------- */
  var typer = { timer: null, node: null };
  var TYPE_WORDS = ["apple", "orange", "olive", "fig", "lemon", "almond", "cherry", "peach", "walnut", "plum"];

  function stopTyper() {
    if (typer.timer) { clearTimeout(typer.timer); typer.timer = null; }
    typer.node = null;
  }

  function startTyper() {
    var el = document.getElementById("hero-type");
    if (!el) { stopTyper(); return; }
    stopTyper();
    typer.node = el;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { el.textContent = TYPE_WORDS[0]; return; }
    var wi = Math.floor(Math.random() * TYPE_WORDS.length);
    var ci = 0;
    var deleting = false;
    function tick() {
      if (!typer.node) return;
      var word = TYPE_WORDS[wi];
      if (!deleting) {
        ci++;
        el.textContent = word.slice(0, ci);
        if (ci >= word.length) { deleting = true; typer.timer = setTimeout(tick, 1500); return; }
        typer.timer = setTimeout(tick, 95);
      } else {
        ci--;
        el.textContent = word.slice(0, ci);
        if (ci <= 0) { deleting = false; wi = (wi + 1) % TYPE_WORDS.length; typer.timer = setTimeout(tick, 380); return; }
        typer.timer = setTimeout(tick, 45);
      }
    }
    tick();
  }

  function applySky() {
    var h = new Date().getHours();
    var phase = (h >= 21 || h < 5) ? "night" : (h < 8 ? "dawn" : (h < 18 ? "day" : "dusk"));
    var b = document.body;
    ["night", "dawn", "day", "dusk"].forEach(function (p) {
      b.classList.toggle("sky-" + p, p === phase);
    });
  }

  // Keep the acceptance-fee figure in the banner in sync with the chosen currency.
  function syncEditorCurrency() {
    var form = document.querySelector('form[data-form="listing"]');
    if (!form) return;
    var sel = form.querySelector('select[name="currency"]');
    var feeEl = document.querySelector(".editor .cost-banner .js-accept-fee");
    if (!sel || !feeEl) return;
    sel.addEventListener("change", function () {
      feeEl.textContent = acceptFeeLabel(sel.value);
    });
  }

  function afterRender(state) {
    applySky();
    manageGlobe(state);
    if (state.route.name === "home") startTyper(); else stopTyper();
    if (state.route.name === "listing-new" || state.route.name === "listing-edit") syncEditorCurrency();
    if (!window.L) return;
    isEditorRoute = state.route.name === "listing-new" || state.route.name === "listing-edit";
    // Tear down maps that are not on the current route.
    if (state.route.name !== "browse") destroyMap("browse");
    if (state.route.name !== "listing") destroyMap("detail");
    if (!isEditorRoute) { destroyMap("editor"); editorMarker = null; }

    if (state.route.name === "browse") mountBrowseMap(state);
    if (state.route.name === "listing") mountDetailMap(state);
    if (isEditorRoute) mountEditorMap();
  }

  /* --------------------------- tree marker ---------------------------- */
  // Fruit-tree map marker: green canopy dotted with orange fruit on a trunk.
  function treeIcon() {
    return window.L.divIcon({
      className: "tree-marker",
      html:
        '<span class="tree-marker__pin"><svg viewBox="0 0 32 40" width="34" height="42">' +
          '<ellipse cx="16" cy="37" rx="6.5" ry="1.9" fill="rgba(20,40,26,0.22)"/>' +
          '<rect x="14.4" y="22" width="3.2" height="13" rx="1.6" fill="#9a6b3f"/>' +
          '<circle cx="16" cy="14" r="12" fill="#2f8f4e"/>' +
          '<path fill="#46b46a" d="M16 2.6c-4.4 0-8 3.2-8.8 7.4C9 8 12.3 6.4 16 6.4s7 1.6 8.8 3.6C24 5.8 20.4 2.6 16 2.6z"/>' +
          '<circle cx="10.6" cy="12.4" r="2.1" fill="#f3920f"/>' +
          '<circle cx="20.8" cy="10.6" r="2.1" fill="#f3920f"/>' +
          '<circle cx="16" cy="16.8" r="2.1" fill="#f3920f"/>' +
          '<circle cx="22.4" cy="16.6" r="1.9" fill="#ffb24d"/>' +
          '<circle cx="10.2" cy="17.4" r="1.9" fill="#ffb24d"/>' +
        "</svg></span>",
      iconSize: [34, 42],
      iconAnchor: [17, 38],
      popupAnchor: [0, -36],
    });
  }

  /* ------------------------------ globe ------------------------------- */
  var globeRoute = null; // "home" | "explore" | null
  var homeGlobeObserver = null;

  function disconnectGlobeObserver() {
    if (homeGlobeObserver) { homeGlobeObserver.disconnect(); homeGlobeObserver = null; }
  }

  function manageGlobe(state) {
    if (!window.AppGlobe) return;
    var name = state.route.name;

    if (name !== "explore" && name !== "home") {
      disconnectGlobeObserver();
      if (globeRoute) { window.AppGlobe.destroy(); globeRoute = null; }
      return;
    }

    if (name === "explore") {
      disconnectGlobeObserver();
      var exEl = document.getElementById("explore-globe");
      if (exEl) {
        window.AppGlobe.mount(exEl, state.listings, { altitude: 2.0, enableZoom: true });
        globeRoute = "explore";
      }
      return;
    }

    // Home: lazy-mount when the globe scrolls into view.
    if (name === "home") {
      if (globeRoute === "explore") { window.AppGlobe.destroy(); globeRoute = null; }
      var el = document.getElementById("home-globe");
      if (!el) return;
      disconnectGlobeObserver();
      if (!("IntersectionObserver" in window)) {
        window.AppGlobe.mount(el, state.listings, { rotateSpeed: 0.6 });
        globeRoute = "home";
        return;
      }
      homeGlobeObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            window.AppGlobe.mount(el, State.getState().listings, { rotateSpeed: 0.6 });
            globeRoute = "home";
            disconnectGlobeObserver();
          }
        });
      }, { rootMargin: "120px" });
      homeGlobeObserver.observe(el);
    }
  }

  /* --------------------- editor location picker ----------------------- */
  function placeEditorMarker(lat, lng) {
    if (!maps.editor) return;
    if (editorMarker) {
      editorMarker.setLatLng([lat, lng]);
    } else {
      editorMarker = window.L.marker([lat, lng], { draggable: true, icon: treeIcon() }).addTo(maps.editor);
      editorMarker.on("dragend", function (e) {
        var p = e.target.getLatLng();
        writeEditorLocation(p.lat, p.lng);
      });
    }
  }

  // Update the hidden inputs + readout without re-rendering (keeps map alive).
  function writeEditorLocation(lat, lng) {
    var latEl = document.querySelector('input[name="latitude"]');
    var lngEl = document.querySelector('input[name="longitude"]');
    if (latEl) latEl.value = lat.toFixed(6);
    if (lngEl) lngEl.value = lng.toFixed(6);
    var readout = document.getElementById("pin-readout");
    if (readout) {
      readout.textContent = "Pin set: " + lat.toFixed(5) + ", " + lng.toFixed(5);
      readout.classList.add("is-set");
    }
  }

  // Public: move the pin + recenter (used by geolocation / address search).
  function setEditorLocation(lat, lng, recenter) {
    if (!maps.editor) return;
    placeEditorMarker(lat, lng);
    writeEditorLocation(lat, lng);
    if (recenter) maps.editor.setView([lat, lng], cfg.map.detailZoom);
  }

  function fillEditorPlace(fields) {
    if (!fields) return;
    var cityEl = document.querySelector('input[name="city"]');
    var addrEl = document.querySelector('input[name="address"]');
    if (cityEl && !cityEl.value && fields.city) cityEl.value = fields.city;
    if (addrEl && !addrEl.value && fields.address) addrEl.value = fields.address;
  }

  function mountEditorMap() {
    var el = document.getElementById("editor-map");
    if (!el) return;
    destroyMap("editor");
    editorMarker = null;
    var latEl = document.querySelector('input[name="latitude"]');
    var lngEl = document.querySelector('input[name="longitude"]');
    var lat = latEl && latEl.value !== "" ? Number(latEl.value) : null;
    var lng = lngEl && lngEl.value !== "" ? Number(lngEl.value) : null;
    var hasPin = lat != null && lng != null && isFinite(lat) && isFinite(lng);
    var center = hasPin ? [lat, lng] : cfg.map.defaultCenter;
    var zoom = hasPin ? cfg.map.detailZoom : cfg.map.defaultZoom;

    var map = window.L.map(el, { scrollWheelZoom: false }).setView(center, zoom);
    baseTileLayer().addTo(map);
    maps.editor = map;
    if (hasPin) placeEditorMarker(lat, lng);
    map.on("click", function (e) {
      placeEditorMarker(e.latlng.lat, e.latlng.lng);
      writeEditorLocation(e.latlng.lat, e.latlng.lng);
    });
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 60);
  }

  function baseTileLayer() {
    return window.L.tileLayer(cfg.map.tileUrl, {
      maxZoom: cfg.map.maxZoom,
      attribution: cfg.map.attribution,
    });
  }

  function mountBrowseMap(state) {
    var el = document.getElementById("browse-map");
    if (!el) return;
    destroyMap("browse");
    var map = window.L.map(el, { scrollWheelZoom: false }).setView(cfg.map.defaultCenter, cfg.map.defaultZoom);
    baseTileLayer().addTo(map);

    var pts = [];
    state.listings.forEach(function (l) {
      if (!isFinite(l.latitude) || !isFinite(l.longitude) || l.latitude == null || l.longitude == null) return;
      var marker = window.L.marker([l.latitude, l.longitude], { icon: treeIcon() }).addTo(map);
      marker.bindPopup(
        '<strong>' + esc(l.title) + "</strong><br />" + money(l.price_cents) + " " + esc(periodLabel(l.rental_period)) +
        '<br /><a href="#/listings/' + esc(l.id) + '">View listing</a>'
      );
      pts.push([l.latitude, l.longitude]);
    });
    if (pts.length === 1) map.setView(pts[0], cfg.map.detailZoom);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30] });

    maps.browse = map;
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 60);
  }

  function mountDetailMap(state) {
    var el = document.getElementById("detail-map");
    var l = state.selectedListing;
    if (!el || !l) return;
    if (!isFinite(l.latitude) || !isFinite(l.longitude) || l.latitude == null || l.longitude == null) return;
    destroyMap("detail");
    var map = window.L.map(el, { scrollWheelZoom: false }).setView([l.latitude, l.longitude], cfg.map.detailZoom);
    baseTileLayer().addTo(map);
    window.L.marker([l.latitude, l.longitude], { icon: treeIcon() }).addTo(map);
    maps.detail = map;
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 60);
  }

  window.AppRender = {
    render: render,
    afterRender: afterRender,
    setEditorLocation: setEditorLocation,
    fillEditorPlace: fillEditorPlace,
  };
})();
