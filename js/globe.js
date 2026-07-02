/* globe.js
 * Interactive 3D globe of every listed tree (globe.gl + three.js).
 * The library is heavy, so it is injected on demand the first time a globe is
 * mounted — it never blocks first paint. Owns globe lifecycle only; reads
 * listing data passed in and delegates navigation to AppRouter.
 */
(function () {
  "use strict";

  // Pinned together: globe.gl 2.46.1 renders with three >=0.179, and the 3D tree
  // objects must be built with a matching three instance or the renderer drops
  // them. Bump both in lock-step if you upgrade.
  var LIB_URL = "https://cdn.jsdelivr.net/npm/globe.gl@2.46.1";
  var THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
  var EARTH_TEX = "https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg"; // 4K — fast first paint
  // 8K Blue Marble (jsdelivr GitHub mirror, pinned commit, CORS-enabled). Loaded
  // lazily on zoom-in so the heavier download never blocks the initial view.
  var EARTH_TEX_HI = "https://cdn.jsdelivr.net/gh/franky-adl/threejs-earth@9575513f799d5be43b3f6f04e95dbf6cec4224c2/src/assets/Albedo.jpg";
  var EARTH_BUMP = "https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png";
  // Cloud shell texture (jsdelivr GitHub mirror, pinned, CORS-enabled).
  var CLOUDS_TEX = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r180/examples/textures/planets/earth_clouds_1024.png";
  var libPromise = null;
  var threePromise = null;
  var THREE = null;

  function loadLibrary() {
    if (window.Globe) return Promise.resolve(window.Globe);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = LIB_URL;
      s.async = true;
      var timer = setTimeout(function () {
        reject(new Error("Globe library timed out."));
      }, 12000);
      s.onload = function () {
        clearTimeout(timer);
        if (window.Globe) resolve(window.Globe);
        else reject(new Error("Globe library unavailable."));
      };
      s.onerror = function () {
        clearTimeout(timer);
        reject(new Error("Globe library failed to load."));
      };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  // three.module.js is self-contained (no bare imports), so a dynamic import of
  // the pinned CDN build is enough. Cached after first load.
  function loadThree() {
    if (THREE) return Promise.resolve(THREE);
    if (threePromise) return threePromise;
    threePromise = import(THREE_URL).then(function (mod) {
      THREE = mod;
      return mod;
    });
    return threePromise;
  }

  function validPoints(listings) {
    return (listings || [])
      .filter(function (l) {
        return (
          l &&
          l.latitude != null &&
          l.longitude != null &&
          isFinite(l.latitude) &&
          isFinite(l.longitude)
        );
      })
      .map(function (l) {
        return {
          id: l.id,
          lat: Number(l.latitude),
          lng: Number(l.longitude),
          title: l.title || "Tree",
          type: l.tree_type || "tree",
        };
      });
  }

  // --- low-poly 3D tree -----------------------------------------------------
  // Built along local +y; globe.gl's objectFacesSurface (default) then orients
  // +y along the surface normal so each tree stands up out of the planet and
  // tilts/rotates naturally as the globe spins.

  // Deterministic per-tree variation so a given listing always looks the same.
  function hashSeed(str) {
    str = String(str == null ? "t" : str);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Per-type tree styling. Each harvest category (the tree_type enum) gets its
  // own silhouette, foliage colour and fruit so the globe reads at a glance.
  //   form    — canopy build pattern (see FORMS below)
  //   foliage — one or more greens; a blob picks one deterministically
  //   trunk   — bark colour
  //   fruit   — fruit colour, or null for none
  //   fruitN  — fruit count, fruitR — fruit radius
  //   scale   — size multiplier on top of the base size
  var TREE_PROFILES = {
    citrus: { form: "round",  foliage: [0x2e7d32, 0x388e3c], trunk: 0x6b4a2b, fruit: 0xff9f1c, fruitN: 6, fruitR: 0.17, scale: 1.0 },
    apple:  { form: "round",  foliage: [0x4caf50, 0x43a047], trunk: 0x6b4a2b, fruit: 0xe53935, fruitN: 5, fruitR: 0.18, scale: 1.05 },
    stone:  { form: "round",  foliage: [0x66bb6a, 0x57a05a], trunk: 0x7a5230, fruit: 0xff7591, fruitN: 5, fruitR: 0.17, scale: 1.0 },
    berry:  { form: "bush",   foliage: [0x5d9c4f, 0x6fae3a], trunk: 0x5f4326, fruit: 0x7b2d8e, fruitN: 8, fruitR: 0.12, scale: 0.8 },
    olive:  { form: "spread", foliage: [0x8fae8b, 0x9bbf94], trunk: 0x837a5e, fruit: 0x3c421f, fruitN: 4, fruitR: 0.13, scale: 1.05 },
    fig:    { form: "round",  foliage: [0x3f7d3a, 0x4f8a3f], trunk: 0x6b4a2b, fruit: 0x6a3d9a, fruitN: 4, fruitR: 0.16, scale: 1.1 },
    nut:    { form: "tall",   foliage: [0x33691e, 0x2e5d1a], trunk: 0x5a3d22, fruit: 0x8d6e63, fruitN: 3, fruitR: 0.15, scale: 1.3 },
    other:  { form: "round",  foliage: [0x4caf50, 0x3f9d52], trunk: 0x6b4a2b, fruit: null,     fruitN: 0, fruitR: 0.15, scale: 1.0 },
  };

  // Canopy shape per form: trunk height, and how blobs are laid out.
  var FORMS = {
    round:  { trunkH: 1.2, canopyY: 0.55, blobs: 3, spread: 0.5,  flat: 1.0, blobR: [0.85, 1.15] },
    bush:   { trunkH: 0.45, canopyY: 0.3, blobs: 4, spread: 0.75, flat: 0.9, blobR: [0.55, 0.8] },
    spread: { trunkH: 1.05, canopyY: 0.35, blobs: 3, spread: 0.85, flat: 0.65, blobR: [0.9, 1.2] },
    tall:   { trunkH: 1.9, canopyY: 0.7,  blobs: 3, spread: 0.6,  flat: 1.05, blobR: [1.0, 1.35] },
  };

  // Shared geometries/materials: built once, referenced by every tree mesh so
  // adding hundreds of markers stays cheap. A colour→material cache keeps the
  // per-type palette without allocating a material per tree.
  var assets = null;
  function getAssets() {
    if (assets) return assets;
    assets = {
      trunkGeo: new THREE.CylinderGeometry(0.16, 0.26, 1.2, 6),
      blobGeo: new THREE.IcosahedronGeometry(1, 0),
      fruitGeo: new THREE.IcosahedronGeometry(1, 0),
      // Dark inverted-hull outline: rendered on back faces, scaled up, so a crisp
      // contour rims each tree against the busy planet texture.
      outlineMat: new THREE.MeshBasicMaterial({ color: 0x122c18, side: THREE.BackSide }),
      lambertCache: {},
      lambert: function (hex) {
        if (!this.lambertCache[hex]) {
          this.lambertCache[hex] = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
        }
        return this.lambertCache[hex];
      },
    };
    return assets;
  }

  // Add a part plus its outline shell to the tree group.
  function addPart(g, A, geo, mat, x, y, z, sx, sy, sz, rotY, outline) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    if (rotY) m.rotation.y = rotY;
    g.add(m);
    if (outline) {
      var o = new THREE.Mesh(geo, A.outlineMat);
      o.position.set(x, y, z);
      o.scale.set(sx * 1.12, sy * 1.12, sz * 1.12);
      if (rotY) o.rotation.y = rotY;
      g.add(o);
    }
    return m;
  }

  function buildTree(d) {
    var A = getAssets();
    var p = TREE_PROFILES[d.type] || TREE_PROFILES.other;
    var fm = FORMS[p.form];
    var rnd = mulberry32(hashSeed(d.id || d.title));
    // globe.gl orients the returned object's local +z along the surface normal.
    // We build the tree along +y, then tilt the inner group +90° about X so its
    // up-axis maps to +z — so the tree stands straight out of the planet.
    var root = new THREE.Group();
    var g = new THREE.Group();
    g.rotation.x = Math.PI / 2;
    root.add(g);
    var pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };

    // Trunk — geometry is 1.2 tall, scale.y stretches it to the form height.
    var trunkMat = A.lambert(p.trunk);
    addPart(g, A, A.trunkGeo, trunkMat, 0, fm.trunkH / 2, 0, 1, fm.trunkH / 1.2, 1, 0, true);

    // Canopy — overlapping faceted blobs. First is the dominant crown, the rest
    // cluster around it; `flat` squashes the canopy for spreading/olive forms.
    var base = fm.trunkH + fm.canopyY;
    for (var i = 0; i < fm.blobs; i++) {
      var leaf = A.lambert(pick(p.foliage));
      var r = fm.blobR[0] + rnd() * (fm.blobR[1] - fm.blobR[0]);
      if (i === 0) {
        addPart(g, A, A.blobGeo, leaf, 0, base + r * 0.6, 0, r, r * fm.flat, r, rnd() * Math.PI, true);
      } else {
        var ang = rnd() * Math.PI * 2;
        var rad = fm.spread * (0.5 + rnd() * 0.5);
        var rr = r * (0.7 + rnd() * 0.25);
        addPart(g, A, A.blobGeo, leaf, Math.cos(ang) * rad, base + (rnd() - 0.2) * 0.5, Math.sin(ang) * rad, rr, rr * fm.flat, rr, rnd() * Math.PI, true);
      }
    }

    // Fruit — small coloured spheres tucked onto the canopy. No outline (reads
    // cleaner small), and skipped for types with no showy fruit.
    if (p.fruit != null) {
      var fruitMat = A.lambert(p.fruit);
      for (var f = 0; f < p.fruitN; f++) {
        var fa = rnd() * Math.PI * 2;
        var frad = fm.spread * (0.6 + rnd() * 0.5);
        addPart(g, A, A.fruitGeo, fruitMat, Math.cos(fa) * frad, base + (rnd() - 0.1) * 0.7, Math.sin(fa) * frad, p.fruitR, p.fruitR, p.fruitR, 0, false);
      }
    }

    // Base size lives on the inner group. The zoom scale is applied by applyZoom
    // to globe.gl's own wrapper object (see there), so root stays identity.
    g.scale.setScalar((1.8 + rnd() * 0.5) * p.scale);
    return root;
  }

  function escapeText(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  var current = { instance: null, container: null, resize: null, ro: null, clouds: null, cloudRAF: null, zoomRAF: null, treeScale: 1, altitude: 2.2, hiResLoaded: false, hiResLoading: false, tilesOn: false, credit: null, debug: null };
  var DEBUG_ZOOM = false; // set true to show an on-screen altitude / tree-scale readout

  // Poll the live camera altitude every frame and drive zoom-dependent behaviour
  // from it. More reliable than globe.gl's onZoom, which can miss scroll-wheel
  // dollying and leave the tree scale stuck at the overview value.
  function startZoomWatch(globe) {
    var last = -1;
    (function tick() {
      if (current.instance !== globe) return;
      var pov = globe.pointOfView && globe.pointOfView();
      if (pov && typeof pov.altitude === "number" && Math.abs(pov.altitude - last) > 0.0008) {
        last = pov.altitude;
        applyZoom(pov.altitude);
      }
      current.zoomRAF = requestAnimationFrame(tick);
    })();
  }

  // Street-detail tiles: read from AppConfig so the provider is swappable.
  function tileConf() {
    var g = (window.AppConfig && window.AppConfig.globe) || {};
    return {
      url: g.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maxLevel: g.tileMaxLevel || 17,
      attribution: g.tileAttribution || "",
    };
  }
  function tileUrlBuilder(tpl) {
    return function (x, y, l) {
      return tpl.replace("{z}", l).replace("{x}", x).replace("{y}", y);
    };
  }

  // Swap the stylised Blue Marble for live map tiles when zoomed in (and back
  // again when zoomed out). Hysteresis between the on/off altitudes avoids
  // flicker when the camera hovers near the threshold.
  var TILE_ON_ALT = 0.6;
  var TILE_OFF_ALT = 0.82;
  function applyTiles(globe, altitude) {
    if (!globe || !globe.globeTileEngineUrl) return;
    if (!current.tilesOn && altitude < TILE_ON_ALT) {
      var c = tileConf();
      globe.globeTileEngineUrl(tileUrlBuilder(c.url)).globeTileEngineMaxLevel(c.maxLevel);
      current.tilesOn = true;
      if (current.credit) current.credit.style.opacity = "1";
    } else if (current.tilesOn && altitude > TILE_OFF_ALT) {
      globe.globeTileEngineUrl(null);
      current.tilesOn = false;
      if (current.credit) current.credit.style.opacity = "0";
    }
  }

  // Max anisotropic filtering keeps the surface sharp at the globe's grazing
  // edges instead of smearing. Cheap, no extra download.
  function applyAnisotropy(globe) {
    try {
      var mat = globe.globeMaterial && globe.globeMaterial();
      if (!mat) return;
      var max = globe.renderer().capabilities.getMaxAnisotropy() || 8;
      [mat.map, mat.bumpMap].forEach(function (t) {
        if (t && t.anisotropy !== max) { t.anisotropy = max; t.needsUpdate = true; }
      });
    } catch (e) {}
  }

  // Swap in the 8K Earth texture for real detail when the user zooms in. Loaded
  // once, on demand; failures fall back silently to the 4K texture.
  var HIRES_TRIGGER_ALT = 1.3;
  function loadHighResGlobe(globe) {
    if (current.hiResLoaded || current.hiResLoading || !globe) return;
    current.hiResLoading = true;
    var maxAniso = 8;
    try { maxAniso = globe.renderer().capabilities.getMaxAnisotropy() || 8; } catch (e) {}
    new THREE.TextureLoader().load(
      EARTH_TEX_HI,
      function (tex) {
        if (current.instance !== globe) return; // remounted while loading
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        var mat = globe.globeMaterial && globe.globeMaterial();
        if (mat) {
          if (mat.map) mat.map.dispose();
          mat.map = tex;
          mat.needsUpdate = true;
        }
        current.hiResLoaded = true;
        current.hiResLoading = false;
      },
      undefined,
      function () { current.hiResLoading = false; }
    );
  }

  // Trees are fixed-size world objects, so without this they balloon when the
  // camera zooms in. Scaling each tree by (altitude / REF) keeps their on-screen
  // size roughly constant across zoom — like a map pin. REF is the framing zoom
  // where scale 1.0 looks right.
  var ZOOM_REF_ALT = 2.2;
  var MIN_ZOOM_ALT = 0.04; // deepest zoom-in allowed (≈ village/street level)
  // Scale ∝ altitude^POW. On-screen size ∝ altitude^(POW-1):
  //   POW = 1   → constant on-screen size (map-pin).
  //   POW > 1   → shrinks as you zoom in (was too small at ground level).
  //   POW < 1   → grows gently as you zoom in — bigger, readable at ground level,
  //               while the growth is slow enough that it never swamps the view.
  var ZOOM_SHRINK_POW = 0.65;
  function clampScale(f) { return Math.max(0.0006, Math.min(1.5, f)); }

  // The cloud texture is low-res and reads as blurry smears up close, so fade the
  // shell out as the camera approaches the surface — clouds belong to the
  // planet-from-afar view.
  var CLOUD_MAX_OPACITY = 0.55;
  function applyCloudFade(altitude) {
    if (!current.clouds) return;
    // Fully faded by ~0.95 so clouds are gone before the map tiles appear.
    var t = Math.max(0, Math.min(1, ((Number(altitude) || ZOOM_REF_ALT) - 0.95) / (1.6 - 0.95)));
    current.clouds.material.opacity = CLOUD_MAX_OPACITY * t;
    current.clouds.visible = t > 0.01;
  }

  // Single zoom hook: resize trees and fade clouds, and remember the altitude so
  // a cloud shell that finishes loading later can match the current zoom.
  function applyZoom(altitude) {
    current.altitude = Number(altitude) || ZOOM_REF_ALT;
    current.treeScale = clampScale(Math.pow(Math.max(current.altitude / ZOOM_REF_ALT, 0), ZOOM_SHRINK_POW));
    // Scale globe.gl's own per-object wrapper (marked __globeObjType==="object"),
    // which is the node it positions/renders — robust to how it builds objects.
    var found = 0;
    if (current.instance && current.instance.scene) {
      var s = current.treeScale;
      current.instance.scene().traverse(function (o) {
        if (o.__globeObjType === "object") { o.scale.setScalar(s); found++; }
      });
    }
    if (current.debug) {
      current.debug.textContent =
        "alt " + current.altitude.toFixed(3) + " · scale " + current.treeScale.toFixed(3) + " · trees " + found;
    }
    applyCloudFade(current.altitude);
    if (current.instance) applyAnisotropy(current.instance);
    if (current.altitude < HIRES_TRIGGER_ALT) loadHighResGlobe(current.instance);
    applyTiles(current.instance, current.altitude);
  }

  // Translucent, slowly drifting cloud shell wrapped around the globe. Added to
  // the globe's own scene so it shares its lighting (day/night terminator) and
  // orbits together as the user spins.
  function addClouds(globe) {
    var R = globe.getGlobeRadius ? globe.getGlobeRadius() : 100;
    new THREE.TextureLoader().load(CLOUDS_TEX, function (tex) {
      if (current.instance !== globe) return; // remounted before texture arrived
      var clouds = new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.015, 48, 32),
        new THREE.MeshPhongMaterial({ map: tex, transparent: true, opacity: CLOUD_MAX_OPACITY, depthWrite: false })
      );
      globe.scene().add(clouds);
      current.clouds = clouds;
      applyCloudFade(current.altitude); // match the current zoom level

      (function spin() {
        if (current.clouds !== clouds) return; // stopped on destroy
        clouds.rotation.y += 0.00035;
        current.cloudRAF = requestAnimationFrame(spin);
      })();
    });
  }

  function destroy() {
    if (current.resize) {
      window.removeEventListener("resize", current.resize);
      current.resize = null;
    }
    if (current.ro) {
      try { current.ro.disconnect(); } catch (e) {}
      current.ro = null;
    }
    if (current.cloudRAF) {
      cancelAnimationFrame(current.cloudRAF);
      current.cloudRAF = null;
    }
    if (current.zoomRAF) {
      cancelAnimationFrame(current.zoomRAF);
      current.zoomRAF = null;
    }
    if (current.clouds) {
      try {
        if (current.clouds.parent) current.clouds.parent.remove(current.clouds);
        current.clouds.geometry.dispose();
        if (current.clouds.material.map) current.clouds.material.map.dispose();
        current.clouds.material.dispose();
      } catch (e) {}
      current.clouds = null;
    }
    if (current.instance && current.container) {
      try {
        current.instance._destructor && current.instance._destructor();
      } catch (e) {}
      current.container.innerHTML = "";
    }
    current.instance = null;
    current.container = null;
    current.hiResLoaded = false;
    current.hiResLoading = false;
    current.tilesOn = false;
    current.credit = null;
    current.debug = null;
  }

  function showFallback(container, points) {
    container.innerHTML =
      '<div class="globe-fallback">' +
        '<span class="globe-fallback__icon" aria-hidden="true">🌍</span>' +
        "<p>" + (points.length ? points.length + " tree" + (points.length === 1 ? "" : "s") + " mapped worldwide." : "Trees will appear here as growers add locations.") + "</p>" +
        '<a class="btn btn-outline btn-sm" href="#/browse" data-nav>Browse the list instead</a>' +
      "</div>";
  }

  // Mount (or remount) the globe inside `container` with the given listings.
  function mount(container, listings, opts) {
    if (!container) return;
    opts = opts || {};
    var points = validPoints(listings);
    destroy();
    container.classList.add("globe-mounting");

    Promise.all([loadLibrary(), loadThree()])
      .then(function (res) {
        var Globe = res[0];
        container.classList.remove("globe-mounting");
        container.innerHTML = "";
        // Seed the zoom scale from the framing altitude so trees are sized right
        // the moment they're built (objectThreeObject runs during this setup).
        applyZoom(points.length ? (opts.altitude || ZOOM_REF_ALT) : 2.5);
        var globe = Globe()(container)
          .globeImageUrl(EARTH_TEX)
          .bumpImageUrl(EARTH_BUMP)
          .backgroundColor("rgba(0,0,0,0)")
          .showAtmosphere(true)
          .atmosphereColor("#f3f6f4")
          .atmosphereAltitude(0.14)
          .objectsData(points)
          .objectLat("lat")
          .objectLng("lng")
          .objectAltitude(0)
          .objectThreeObject(buildTree)
          .objectLabel(function (d) {
            return '<div class="globe-tip">' + escapeText(d.title) + "</div>";
          })
          .onObjectClick(function (d) {
            if (d && window.AppRouter) window.AppRouter.navigate("/listings/" + d.id);
          })
          .onObjectHover(function (d) {
            container.style.cursor = d ? "pointer" : "";
          });

        var w = container.clientWidth || 600;
        var h = container.clientHeight || 460;
        globe.width(w).height(h);

        // Frame the trees: center on their average, else a gentle default.
        if (points.length) {
          var avgLat = points.reduce(function (s, p) { return s + p.lat; }, 0) / points.length;
          var avgLng = points.reduce(function (s, p) { return s + p.lng; }, 0) / points.length;
          globe.pointOfView({ lat: avgLat, lng: avgLng, altitude: opts.altitude || 2.2 }, 0);
        } else {
          globe.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 0);
        }

        var controls = globe.controls();
        controls.autoRotate = false; // static globe — user can drag to spin
        controls.enableZoom = opts.enableZoom !== false;
        controls.enablePan = false;
        // Cap how far in you can zoom: past village/street level a stylised 3D
        // tree stops reading as a tree (you just see a dark blob from above), and
        // that depth isn't needed to see where a tree is.
        var gR = globe.getGlobeRadius ? globe.getGlobeRadius() : 100;
        controls.minDistance = gR * (1 + MIN_ZOOM_ALT);

        current.instance = globe;
        current.container = container;
        addClouds(globe);

        if (DEBUG_ZOOM) {
          var dbg = document.createElement("div");
          dbg.style.cssText =
            "position:absolute;left:8px;top:8px;z-index:5;font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,0.6);padding:2px 8px;border-radius:6px;pointer-events:none;";
          dbg.textContent = "…";
          container.appendChild(dbg);
          current.debug = dbg;
        }

        // Drive tree scale / tiles / clouds from the live camera altitude. Must
        // run after current.instance is set, or the watcher's guard exits at once.
        startZoomWatch(globe);

        // Map-tile attribution, shown only while tiles are visible (zoomed in).
        var conf = tileConf();
        if (conf.attribution) {
          var credit = document.createElement("div");
          credit.className = "globe-credit";
          credit.innerHTML = conf.attribution;
          credit.style.opacity = "0";
          container.appendChild(credit);
          current.credit = credit;
        }
        current.resize = function () {
          if (!current.instance || !current.container) return;
          var cw = current.container.clientWidth;
          var ch = current.container.clientHeight;
          if (cw && ch) current.instance.width(cw).height(ch);
        };
        window.addEventListener("resize", current.resize);
        // Re-measure across a few frames so the globe fills its box even if the
        // first measurement happened before layout/library settled. Also sharpen
        // the surface once globe.gl has finished loading its base textures.
        [60, 250, 600].forEach(function (ms) {
          setTimeout(function () { current.resize(); applyAnisotropy(globe); }, ms);
        });
        if ("ResizeObserver" in window) {
          current.ro = new ResizeObserver(current.resize);
          current.ro.observe(container);
        }
      })
      .catch(function () {
        container.classList.remove("globe-mounting");
        showFallback(container, points);
      });
  }

  // Animate the camera to a coordinate (e.g. the visitor's location). Returns
  // false if no globe is currently mounted.
  function goTo(lat, lng, altitude, ms) {
    if (!current.instance || lat == null || lng == null) return false;
    current.instance.pointOfView(
      { lat: Number(lat), lng: Number(lng), altitude: altitude == null ? 0.8 : altitude },
      ms == null ? 1400 : ms
    );
    return true;
  }

  window.AppGlobe = { mount: mount, destroy: destroy, validPoints: validPoints, goTo: goTo };
})();
