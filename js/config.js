/* config.js
 * App identity, storage prefix, auth storage key, Supabase schema, and runtime config.
 * Reads Polymai runtime config from window.__POLYMAI_SUPABASE_CONFIG__ (loaded earlier).
 */
(function () {
  "use strict";

  var runtime =
    (typeof window !== "undefined" && window.__POLYMAI_SUPABASE_CONFIG__) ||
    (typeof window !== "undefined" && window.__SUPABASE_CONFIG__) ||
    {};

  var appStoragePrefix = runtime.appStoragePrefix || "polymai:app702:";

  var AppConfig = {
    appId: runtime.appId || "app702",
    brand: "FruitLease",
    tagline: "Rent a tree, keep the harvest.",

    // Rotating hero backgrounds (one picked at random per visit).
    heroImages: [
      "https://images.unsplash.com/photo-1597714026720-8f74c62310ba?auto=format&fit=crop&w=1900&q=75",
      "https://images.unsplash.com/photo-1444392061186-9fc38f84f726?auto=format&fit=crop&w=1900&q=75",
      "https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=1900&q=75",
      "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=1900&q=75",
      "https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?auto=format&fit=crop&w=1900&q=75",
      "https://images.unsplash.com/photo-1568569350062-ebfa3cb195df?auto=format&fit=crop&w=1900&q=75",
      "https://images.unsplash.com/photo-1570913149827-d2ac84ab3f9a?auto=format&fit=crop&w=1900&q=75",
      "https://images.unsplash.com/photo-1596363505729-4190a9506133?auto=format&fit=crop&w=1900&q=75",
      "https://images.unsplash.com/photo-1601493700631-2b16ec4b4716?auto=format&fit=crop&w=1900&q=75",
      "https://images.unsplash.com/photo-1557800636-894a64c1696f?auto=format&fit=crop&w=1900&q=75",
    ],

    // Listing fee (owner-paid to publish). Localised by the seller's region.
    // VAT is added on top at checkout — keep vatRate in sync with the Edge
    // Function's LISTING_VAT_RATE. Amounts are Stripe minor units (2 decimals).
    pricing: {
      fallback: "USD",
      vatRate: 0.25,
      currencies: {
        USD: { net: 299, decimals: 2 },
        EUR: { net: 299, decimals: 2 },
        GBP: { net: 249, decimals: 2 },
        SEK: { net: 2900, decimals: 0 },
        INR: { net: 9900, decimals: 0 },
        ZAR: { net: 1900, decimals: 0 },
        NGN: { net: 150000, decimals: 0 },
      },
      countryToCurrency: {
        US: "USD", GB: "GBP", SE: "SEK", IN: "INR", ZA: "ZAR", NG: "NGN",
        AT: "EUR", BE: "EUR", CY: "EUR", EE: "EUR", FI: "EUR", FR: "EUR", DE: "EUR",
        GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR",
        NL: "EUR", PT: "EUR", SK: "EUR", SI: "EUR", ES: "EUR", HR: "EUR",
      },
      // Fixed acceptance fee the owner pays when they accept a booking. GROSS
      // amounts INCLUDING VAT (minor units) — the owner pays exactly this.
      // Keep in sync with the ACCEPTANCE_FEE table in the Edge function.
      acceptanceFee: {
        USD: 199, EUR: 199, GBP: 179, SEK: 1900, INR: 9900, ZAR: 1900, NGN: 150000,
      },
    },

    // Supabase runtime (frontend-safe values only)
    supabase: {
      url: runtime.url || "",
      anonKey: runtime.anonKey || "",
      functionsBaseUrl: runtime.functionsBaseUrl || "",
      siteUrl: runtime.siteUrl || "",
      authStorageKey: runtime.authStorageKey || appStoragePrefix + "auth",
      // Schema-per-app: the client is scoped to this Postgres schema.
      schema: "app702_rentmytree",
      storageBucket: "app702_rentmytree_media",
    },

    // App-owned browser storage keys (all app-scoped to avoid cross-app collisions).
    storage: {
      prefix: appStoragePrefix,
      pendingSignup: appStoragePrefix + "pending-signup",
      filters: appStoragePrefix + "browse-filters",
      listingDraft: appStoragePrefix + "listing-draft",
    },

    // Map configuration (OpenStreetMap / Leaflet). Tile + geocoder URLs are replaceable.
    map: {
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      geocoderUrl: "https://nominatim.openstreetmap.org/search",
      defaultCenter: [39.5, -98.35], // continental US centroid as a neutral default
      defaultZoom: 4,
      detailZoom: 13,
      maxZoom: 18,
    },

    // 3D globe street-detail tiles, shown when the user zooms in. Provider-
    // agnostic: swap tileUrl to a satellite source (e.g. MapTiler/Mapbox, which
    // need an API key) without touching globe code. {z}/{x}/{y} placeholders.
    globe: {
      // Esri World Imagery (satellite, keyless). NOTE: Esri tiles are {z}/{y}/{x}.
      // Free for evaluation/non-commercial; for production swap to a keyed
      // provider (MapTiler/Mapbox satellite) and update the attribution.
      // Street-map alternative: https://tile.openstreetmap.org/{z}/{x}/{y}.png
      tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      tileMaxLevel: 18,
      tileAttribution: 'Imagery © <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
    },

    // Domain vocabulary
    // Harvest-bearing trees only — the marketplace is about buying a grower's crop.
    treeTypes: [
      { value: "citrus", label: "Citrus" },
      { value: "apple", label: "Apple & pear" },
      { value: "stone", label: "Stone fruit" },
      { value: "berry", label: "Berry" },
      { value: "olive", label: "Olive" },
      { value: "fig", label: "Fig & grape" },
      { value: "nut", label: "Nuts" },
      { value: "other", label: "Other harvest" },
    ],
    rentalPeriods: [
      { value: "day", label: "per day" },
      { value: "week", label: "per week" },
      { value: "month", label: "per month" },
      { value: "season", label: "per season" },
    ],
    listingStatuses: [
      { value: "draft", label: "Draft" },
      { value: "published", label: "Published" },
      { value: "archived", label: "Archived" },
    ],
    bookingStatuses: [
      { value: "pending", label: "Pending" },
      { value: "accepted", label: "Accepted" },
      { value: "declined", label: "Declined" },
      { value: "cancelled", label: "Cancelled" },
      { value: "completed", label: "Completed" },
    ],
  };

  AppConfig.isSupabaseReady = function () {
    return !!(AppConfig.supabase.url && AppConfig.supabase.anonKey);
  };

  // Pick a random hero background once per page load.
  AppConfig.heroImage = (function () {
    var list = AppConfig.heroImages || [];
    return list.length ? list[Math.floor(Math.random() * list.length)] : "";
  })();

  // Detect the visitor's currency from their browser locale region.
  AppConfig.detectCurrency = function () {
    try {
      var langs = (navigator.languages && navigator.languages.length)
        ? navigator.languages : [navigator.language || "en-US"];
      for (var i = 0; i < langs.length; i++) {
        var m = String(langs[i]).match(/[-_]([A-Za-z]{2})\b/);
        if (m) {
          var cc = m[1].toUpperCase();
          if (AppConfig.pricing.countryToCurrency[cc]) return AppConfig.pricing.countryToCurrency[cc];
        }
      }
    } catch (e) {}
    return AppConfig.pricing.fallback;
  };

  // Listing-fee breakdown for a currency code (net, gross incl. VAT, decimals).
  AppConfig.feeFor = function (code) {
    code = String(code || AppConfig.detectCurrency()).toUpperCase();
    var c = AppConfig.pricing.currencies[code] || AppConfig.pricing.currencies[AppConfig.pricing.fallback];
    if (!AppConfig.pricing.currencies[code]) code = AppConfig.pricing.fallback;
    var rate = AppConfig.pricing.vatRate;
    return { code: code, net: c.net, gross: Math.round(c.net * (1 + rate)), vatPct: Math.round(rate * 100), decimals: c.decimals };
  };

  AppConfig.currencyDecimals = function (code) {
    var c = AppConfig.pricing.currencies[String(code || "USD").toUpperCase()];
    return c ? c.decimals : 2;
  };

  // Acceptance fee for a currency: the stored amount is GROSS (VAT included), so
  // we back out the net + VAT parts for display/receipts.
  AppConfig.acceptanceFeeFor = function (code) {
    code = String(code || AppConfig.detectCurrency()).toUpperCase();
    var table = AppConfig.pricing.acceptanceFee;
    if (table[code] == null) code = AppConfig.pricing.fallback;
    var gross = table[code];
    var net = Math.round(gross / (1 + AppConfig.pricing.vatRate));
    return {
      code: code,
      gross: gross,
      net: net,
      vat: gross - net,
      vatPct: Math.round(AppConfig.pricing.vatRate * 100),
      decimals: AppConfig.currencyDecimals(code),
    };
  };

  // Currency picker options for the listing editor — every supported payout
  // currency, labelled with its symbol.
  AppConfig.currencyOptions = function () {
    var sym = { USD: "$", EUR: "€", GBP: "£", SEK: "kr", INR: "₹", ZAR: "R", NGN: "₦" };
    return Object.keys(AppConfig.pricing.currencies).map(function (code) {
      return { value: code, label: sym[code] ? code + " (" + sym[code] + ")" : code };
    });
  };

  // Format Stripe minor units in the given currency using the browser locale.
  AppConfig.formatMoney = function (minor, code, decimals) {
    code = String(code || "USD").toUpperCase();
    decimals = decimals == null ? AppConfig.currencyDecimals(code) : decimals;
    var value = (Number(minor) || 0) / 100;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency", currency: code,
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      }).format(value);
    } catch (e) {
      return value.toFixed(decimals) + " " + code;
    }
  };

  // Build an auth email redirect base. On localhost use the live URL; otherwise
  // prefer the configured site URL, falling back to the current origin + path.
  AppConfig.authRedirectUrl = function () {
    try {
      var loc = window.location;
      var host = loc.hostname;
      if (host === "127.0.0.1" || host === "localhost") {
        return loc.origin + loc.pathname;
      }
      if (AppConfig.supabase.siteUrl) return AppConfig.supabase.siteUrl;
      return loc.origin + loc.pathname;
    } catch (e) {
      return "";
    }
  };

  AppConfig.labelFor = function (list, value) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].value === value) return list[i].label;
    }
    return value || "";
  };

  window.AppConfig = AppConfig;
})();
