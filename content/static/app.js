// Procedural dithered wave effect (header + footer)
//
// A metaball "sea" is generated in the fragment shader and then flattened to
// 1-bit ordered-dither ink (Atkinson 4x4 by default, or Bayer 8x8 / random
// noise via ?dither=).  Transparent pixels let the CSS page background show
// through, so the water blends into the page instead of being painted over it.

// Theme bridge so the effect can follow the site theme (light / dark / system).
(function() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function addMediaListener(callback) {
    if (media.addEventListener) {
      media.addEventListener('change', callback);
      return () => media.removeEventListener('change', callback);
    }
    media.addListener(callback);
    return () => media.removeListener(callback);
  }

  window.darkThoughtsTheme = {
    isLight() {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme === 'light') return true;
      if (theme === 'dark') return false;
      return !media.matches;
    },
    onChange(callback) {
      window.addEventListener('dark:themechange', callback);
      const removeMediaListener = addMediaListener(callback);
      return () => {
        window.removeEventListener('dark:themechange', callback);
        removeMediaListener();
      };
    }
  };
})();

// Alpha-fallback helpers.  iOS Safari can report an alpha-capable WebGL
// context but still composite transparent canvas pixels against white instead
// of the CSS backdrop; in that case the shader has to flatten against the
// current background color itself.  Ported from dark.ronacher.eu.
(function() {
  let cachedCanvasAlphaWorks = null;

  function parseCssChannel(value) {
    value = value.trim();
    if (value.endsWith('%')) {
      return parseFloat(value) * 2.55;
    }
    return parseFloat(value);
  }

  function parseCssAlpha(value) {
    value = value.trim();
    if (value.endsWith('%')) {
      return parseFloat(value) / 100;
    }
    return parseFloat(value);
  }

  function parseCssUnitInterval(value) {
    value = value.trim();
    if (value.endsWith('%')) {
      return parseFloat(value) / 100;
    }
    return parseFloat(value);
  }

  function parseCssColor(color) {
    if (!color) return null;
    color = color.trim().toLowerCase();
    if (color === 'transparent') return [0, 0, 0, 0];

    let match = color.match(/^rgba?\((.*)\)$/);
    if (match) {
      let channels;
      let alpha = 1;
      const body = match[1].trim();
      if (body.includes(',')) {
        const parts = body.split(/\s*,\s*/);
        channels = parts.slice(0, 3).map(parseCssChannel);
        if (parts[3] !== undefined) alpha = parseCssAlpha(parts[3]);
      } else {
        const parts = body.split('/');
        channels = parts[0].trim().split(/\s+/).slice(0, 3).map(parseCssChannel);
        if (parts[1] !== undefined) alpha = parseCssAlpha(parts[1]);
      }
      if (channels.length !== 3 || channels.some(Number.isNaN) || Number.isNaN(alpha)) return null;
      return [
        Math.min(Math.max(channels[0] / 255, 0), 1),
        Math.min(Math.max(channels[1] / 255, 0), 1),
        Math.min(Math.max(channels[2] / 255, 0), 1),
        Math.min(Math.max(alpha, 0), 1)
      ];
    }

    match = color.match(/^color\([a-z0-9-]+\s+([^\)]+)\)$/);
    if (match) {
      const parts = match[1].split('/');
      const channels = parts[0].trim().split(/\s+/).slice(0, 3).map(parseCssUnitInterval);
      const alpha = parts[1] === undefined ? 1 : parseCssAlpha(parts[1]);
      if (channels.length !== 3 || channels.some(Number.isNaN) || Number.isNaN(alpha)) return null;
      return [
        Math.min(Math.max(channels[0], 0), 1),
        Math.min(Math.max(channels[1], 0), 1),
        Math.min(Math.max(channels[2], 0), 1),
        Math.min(Math.max(alpha, 0), 1)
      ];
    }

    return null;
  }

  function compositeColor(fg, bg) {
    const alpha = fg[3] + bg[3] * (1 - fg[3]);
    if (alpha <= 0) return [0, 0, 0, 0];
    return [
      (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / alpha,
      (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / alpha,
      (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / alpha,
      alpha
    ];
  }

  function fallbackBackgroundColor() {
    return window.darkThoughtsTheme.isLight()
      ? [0xff / 255, 0xff / 255, 0xff / 255, 1]
      : [0x1b / 255, 0x31 / 255, 0x56 / 255, 1];
  }

  function getBackdropColor(element) {
    let node = element && element.nodeType === 1 ? element : document.documentElement;
    if (!node.isConnected) node = document.documentElement;

    const chain = [];
    while (node && node.nodeType === 1) {
      chain.push(node);
      node = node.parentNode;
    }

    let color = [1, 1, 1, 1];
    let foundColor = false;
    for (let i = chain.length - 1; i >= 0; i--) {
      const parsed = parseCssColor(getComputedStyle(chain[i]).backgroundColor);
      if (parsed && parsed[3] > 0) {
        foundColor = true;
        color = compositeColor(parsed, color);
      }
    }

    return foundColor ? color : fallbackBackgroundColor();
  }

  function isIOSWebKit() {
    const ua = navigator.userAgent;
    const platform = navigator.platform;
    const isiOS = /iP(?:hone|ad|od)/.test(platform) ||
      (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isiOS && /AppleWebKit/.test(ua);
  }

  function contextHasAlphaBuffer(gl) {
    const attrs = gl.getContextAttributes && gl.getContextAttributes();
    if (!attrs || attrs.alpha === false) return false;

    const previousClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    const pixel = new Uint8Array(4);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.clearColor(previousClearColor[0], previousClearColor[1], previousClearColor[2], previousClearColor[3]);
    return pixel[3] < 128;
  }

  function transparentCanvasComposites() {
    if (cachedCanvasAlphaWorks !== null) return cachedCanvasAlphaWorks;

    try {
      const source = document.createElement('canvas');
      source.width = 1;
      source.height = 1;
      const gl = source.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true
      });
      if (!gl || !contextHasAlphaBuffer(gl)) {
        cachedCanvasAlphaWorks = false;
        return cachedCanvasAlphaWorks;
      }

      const target = document.createElement('canvas');
      target.width = 1;
      target.height = 1;
      const ctx = target.getContext('2d');
      ctx.fillStyle = 'rgb(17, 34, 51)';
      ctx.fillRect(0, 0, 1, 1);
      ctx.drawImage(source, 0, 0);
      const pixel = ctx.getImageData(0, 0, 1, 1).data;
      cachedCanvasAlphaWorks = Math.abs(pixel[0] - 17) <= 1 &&
        Math.abs(pixel[1] - 34) <= 1 &&
        Math.abs(pixel[2] - 51) <= 1;

      const loseContext = gl.getExtension('WEBGL_lose_context');
      if (loseContext) loseContext.loseContext();
    } catch (e) {
      cachedCanvasAlphaWorks = false;
    }

    return cachedCanvasAlphaWorks;
  }

  window.darkThoughtsShader = {
    needsAlphaFallback(gl) {
      if (!contextHasAlphaBuffer(gl)) return true;
      if (isIOSWebKit()) return true;
      return !transparentCanvasComposites();
    },
    setBackgroundUniform(gl, location, element) {
      const color = getBackdropColor(element) || fallbackBackgroundColor();
      gl.uniform3f(location, color[0], color[1], color[2]);
    }
  };
})();

// The effect itself.
(function() {
  const DEFAULT_DITHER = 'atkinson';
  const FRAME_INTERVAL = 1000 / 30; // ~30fps is plenty

  const vsSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0, 1);
    }
  `;

  const fsSource = `
    precision highp float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_dpr;
    uniform float u_isLight;
    uniform float u_flip;
    uniform float u_hover;
    uniform int u_ditherMode;  // 0 = Bayer, 1 = Atkinson, 2 = noise
    uniform sampler2D u_bayer;
    uniform float u_alphaFallback;
    uniform vec3 u_backgroundColor;

    // Cheap hash - single multiply-add chain
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    vec2 hash2(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(p) * 43758.5453);
    }

    // Simple value noise - much cheaper than simplex
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      ) * 2.0 - 1.0;
    }

    // Metaball field - sums smooth falloff from nearby blob centers.
    // Returns vec2(field, accentWeight) where accentWeight is 0-1 based on the
    // accent blob contribution and the hover progress.
    vec2 metaball(vec2 p, float time) {
      vec2 i = floor(p);
      vec2 f = fract(p);

      float sum = 0.0;
      float accentSum = 0.0;

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 cellId = i + neighbor;
          vec2 point = hash2(cellId);
          point = 0.5 + 0.4 * sin(time * 0.3 + 6.28 * point);
          vec2 diff = neighbor + point - f;
          float r2 = dot(diff, diff);

          float influence = max(0.0, 1.0 - r2);
          float contrib = influence * influence * influence;
          sum += contrib;

          float isAccent = step(0.92, hash(cellId + 0.5));
          float blobDelay = hash(cellId + 0.7) * 0.75;
          float blobVisible = smoothstep(blobDelay, blobDelay + 0.25, u_hover);
          accentSum += contrib * isAccent * blobVisible;
        }
      }

      float accentWeight = sum > 0.0 ? accentSum / sum : 0.0;
      return vec2(sum, accentWeight);
    }

    // Cheap warping using value noise
    vec2 warpCoords(vec2 p, float time) {
      float warp1 = vnoise(p * 0.5 + time * 0.05);
      float warp2 = vnoise(p * 0.3 - time * 0.03 + 100.0);
      return p + vec2(warp1, warp2) * 0.4;
    }

    // Atkinson-style threshold pattern (4x4)
    float atkinsonThreshold(vec2 pos) {
      int x = int(mod(pos.x, 4.0));
      int y = int(mod(pos.y, 4.0));
      int idx = y * 4 + x;
      float thresholds[16];
      thresholds[0] = 0.0;    thresholds[1] = 12.0;  thresholds[2] = 3.0;   thresholds[3] = 15.0;
      thresholds[4] = 8.0;   thresholds[5] = 4.0;   thresholds[6] = 11.0;  thresholds[7] = 7.0;
      thresholds[8] = 2.0;   thresholds[9] = 14.0;  thresholds[10] = 1.0;  thresholds[11] = 13.0;
      thresholds[12] = 10.0; thresholds[13] = 6.0;  thresholds[14] = 9.0;  thresholds[15] = 5.0;
      for (int i = 0; i < 16; i++) {
        if (i == idx) return thresholds[i] / 16.0;
      }
      return 0.0;
    }

    void main() {
      float dpr = max(u_dpr, 1.0);

      // Metaball space is measured in CSS pixels so the look is DPR independent.
      vec2 p = gl_FragCoord.xy / dpr * 0.0133;

      // Wavy water line.  pixelY is measured from the page-facing edge so the
      // footer (u_flip) mirrors the header.  Everything is relative to the
      // canvas height so the header and the much taller footer stay in
      // proportion.
      float xCoord = gl_FragCoord.x / dpr;
      float boundary = u_resolution.y * 0.42;
      boundary += vnoise(vec2(xCoord * 0.008, u_time * 0.08)) * u_resolution.y * 0.07;
      boundary += vnoise(vec2(xCoord * 0.02, u_time * 0.04 + 50.0)) * u_resolution.y * 0.035;

      float pixelY = mix(gl_FragCoord.y, u_resolution.y - gl_FragCoord.y, u_flip);
      float distToBoundary = pixelY - boundary;

      // Blobs pool against the boundary.
      float wallInfluence = smoothstep(u_resolution.y * 0.22, 0.0, distToBoundary) * 0.25;

      // Bottom layer - darker, larger scale
      vec2 p1 = p * 0.7 + vec2(u_time * 0.02, u_time * 0.015);
      vec2 meta1 = metaball(warpCoords(p1, u_time * 0.6), u_time * 0.6);
      float field1 = meta1.x + wallInfluence;

      // Top layer - brighter, smaller scale
      vec2 p2 = p + vec2(u_time * 0.06, -u_time * 0.02);
      vec2 meta2 = metaball(warpCoords(p2 + 100.0, u_time), u_time);
      float field2 = meta2.x + wallInfluence;

      float taper = smoothstep(-u_resolution.y * 0.16, 0.0, distToBoundary);
      field1 *= taper;
      field2 *= taper;

      // Turn the metaball field into an ink density (0 = none, 1 = solid ink).
      // The old effect hard-thresholded the field at 0.92 / 0.95; ramping
      // around those values keeps the blob shapes while giving the dither a
      // gradient to work with.
      float body = smoothstep(0.50, 1.10, field1) * 0.50;
      float foam = smoothstep(0.72, 1.32, field2) * 0.35;
      float density = clamp(body + foam, 0.0, 0.85);

      // A few blobs light up in the accent colour while hovering.
      float accentDensity = clamp(max(meta1.y, meta2.y) * u_hover * 1.5, 0.0, 1.0);
      accentDensity *= smoothstep(0.05, 0.4, density);

      // ---- ordered dithering ----
      float threshold;
      if (u_ditherMode == 2) {
        threshold = hash(gl_FragCoord.xy);
      } else if (u_ditherMode == 1) {
        threshold = atkinsonThreshold(gl_FragCoord.xy);
      } else {
        threshold = texture2D(u_bayer, mod(gl_FragCoord.xy, 8.0) / 8.0).r;
      }

      float dithered = step(clamp(threshold, 0.001, 0.999), density);
      float accent = step(fract(threshold + 0.5), accentDensity) * dithered;

      vec3 darkInk = vec3(0.400, 0.702, 1.000);      // #66b3ff
      vec3 lightInk = vec3(0.067, 0.361, 0.631);     // #115ca1
      vec3 darkAccent = vec3(1.000, 0.400, 0.400);   // #ff6666
      vec3 lightAccent = vec3(0.804, 0.055, 0.055);  // #cd0e0e

      vec3 ink = mix(darkInk, lightInk, u_isLight);
      ink = mix(ink, mix(darkAccent, lightAccent, u_isLight), accent);

      if (u_alphaFallback > 0.5) {
        gl_FragColor = vec4(mix(u_backgroundColor, ink, dithered), 1.0);
      } else {
        gl_FragColor = vec4(ink, dithered);
      }
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  // 8x8 Bayer matrix
  const bayerData = new Uint8Array([
    0,128,32,160,8,136,40,168,
    192,64,224,96,200,72,232,104,
    48,176,16,144,56,184,24,152,
    240,112,208,80,248,120,216,88,
    12,140,44,172,4,132,36,164,
    204,76,236,108,196,68,228,100,
    60,188,28,156,52,180,20,148,
    252,124,220,92,244,116,212,84
  ]);

  const ditherModes = { gaussian: 0, bayer: 0, atkinson: 1, noise: 2 };
  const ditherParam = new URLSearchParams(window.location.search).get('dither');
  const ditherMode = ditherModes[ditherParam] ?? ditherModes[DEFAULT_DITHER];

  function createEffect(canvasId, flip) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) return null;

    const alphaFallback = window.darkThoughtsShader.needsAlphaFallback(gl);

    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return null;
    }
    gl.useProgram(program);

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const bayerTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bayerTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 8, 8, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bayerData);
    gl.uniform1i(gl.getUniformLocation(program, 'u_bayer'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_ditherMode'), ditherMode);

    const loc = {
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      dpr: gl.getUniformLocation(program, 'u_dpr'),
      isLight: gl.getUniformLocation(program, 'u_isLight'),
      flip: gl.getUniformLocation(program, 'u_flip'),
      hover: gl.getUniformLocation(program, 'u_hover'),
      alphaFallback: gl.getUniformLocation(program, 'u_alphaFallback'),
      backgroundColor: gl.getUniformLocation(program, 'u_backgroundColor')
    };
    gl.uniform1f(loc.alphaFallback, alphaFallback ? 1.0 : 0.0);
    gl.uniform1f(loc.flip, flip ? 1.0 : 0.0);

    return {
      canvas: canvas,
      gl: gl,
      loc: loc,
      bayerTex: bayerTex,
      posBuffer: posBuffer,
      posLoc: posLoc,
      alphaFallback: alphaFallback,
      hoverTarget: 0,
      hoverValue: 0,
      needsResize: true,
      visible: true
    };
  }

  function setupCanvas(effect) {
    const gl = effect.gl;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(effect.canvas.offsetWidth * dpr));
    const height = Math.max(1, Math.round(effect.canvas.offsetHeight * dpr));
    if (effect.canvas.width !== width || effect.canvas.height !== height) {
      effect.canvas.width = width;
      effect.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(effect.loc.resolution, width, height);
    gl.uniform1f(effect.loc.dpr, dpr);
    effect.needsResize = false;
  }

  function renderEffect(effect, time) {
    const gl = effect.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, effect.posBuffer);
    gl.vertexAttribPointer(effect.posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, effect.bayerTex);
    gl.uniform1f(effect.loc.time, time);
    gl.uniform1f(effect.loc.isLight, window.darkThoughtsTheme.isLight() ? 1.0 : 0.0);
    gl.uniform1f(effect.loc.hover, effect.hoverValue);
    if (effect.alphaFallback) {
      window.darkThoughtsShader.setBackgroundUniform(gl, effect.loc.backgroundColor, effect.canvas);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let effects = [];
  let lastFrameTime = 0;
  let lastDpr = window.devicePixelRatio;
  let startTime = performance.now();

  function elapsed() {
    return (performance.now() - startTime) / 1000;
  }

  function drawEffectNow(effect) {
    if (effect.needsResize) setupCanvas(effect);
    renderEffect(effect, elapsed());
  }

  function frame(timestamp) {
    requestAnimationFrame(frame);
    if (document.hidden || effects.length === 0) return;
    if (timestamp - lastFrameTime < FRAME_INTERVAL) return;

    const dt = lastFrameTime ? Math.min((timestamp - lastFrameTime) / 1000, 0.1) : 0;
    lastFrameTime = timestamp;

    const dpr = window.devicePixelRatio;
    if (dpr !== lastDpr) {
      lastDpr = dpr;
      for (const effect of effects) effect.needsResize = true;
    }

    const time = elapsed();

    for (const effect of effects) {
      // Animate hover linearly (~2.65s for the staggered blobs).
      const hoverSpeed = dt / 2.65;
      if (effect.hoverTarget > effect.hoverValue) {
        effect.hoverValue = Math.min(effect.hoverTarget, effect.hoverValue + hoverSpeed);
      } else if (effect.hoverTarget < effect.hoverValue) {
        effect.hoverValue = Math.max(effect.hoverTarget, effect.hoverValue - hoverSpeed);
      }

      if (!effect.visible) continue;
      if (effect.needsResize) setupCanvas(effect);
      renderEffect(effect, time);
    }
  }

  function init() {
    effects = [
      createEffect('header-canvas', false),
      createEffect('footer-canvas', true)
    ].filter(Boolean);

    if (effects.length === 0) return;

    const observer = new IntersectionObserver(function(entries) {
      for (const entry of entries) {
        for (const effect of effects) {
          if (effect.canvas === entry.target) {
            effect.visible = entry.isIntersecting;
            // Repaint immediately so scrolling back does not flash an empty canvas.
            if (effect.visible) drawEffectNow(effect);
          }
        }
      }
    }, { threshold: 0 });

    for (const effect of effects) {
      observer.observe(effect.canvas);

      const container = effect.canvas.parentElement;
      if (container) {
        container.addEventListener('mouseenter', function() { effect.hoverTarget = 1; });
        container.addEventListener('mouseleave', function() { effect.hoverTarget = 0; });
      }
    }

    window.addEventListener('resize', function() {
      for (const effect of effects) effect.needsResize = true;
    });

    startTime = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// htmx configuration and error handling
(function() {
  htmx.config.scrollIntoViewOnBoost = false;

  // Fall back to native navigation on htmx errors
  function htmxFallbackToNative(evt) {
    var path = evt.detail.pathInfo?.requestPath || evt.detail.requestConfig?.path;
    if (path) {
      window.location.href = path;
    }
  }

  // Network error (offline, DNS failure, etc.)
  htmx.on('htmx:sendError', htmxFallbackToNative);
  // Swap error (invalid HTML, can't find target, etc.)
  htmx.on('htmx:swapError', htmxFallbackToNative);
  // Server error responses (4xx, 5xx) - let browser handle natively
  htmx.on('htmx:responseError', htmxFallbackToNative);
})();

// Date warning for old articles
(function() {
  function updateDateWarning() {
    const dateEl = document.querySelector("p.date");
    if (!dateEl || dateEl.querySelector(".date-warning")) return;

    const pubDate = new Date(dateEl.dataset.date);
    if (Number.isNaN(pubDate.getTime())) return;

    const dayDiff = Math.floor((Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24));
    const yearDiff = Math.floor(dayDiff / 365);

    if (dayDiff >= 365) {
      const warning = document.createElement("span");
      warning.className = "date-warning";
      warning.textContent = `this article is ${yearDiff} year${yearDiff != 1 ? 's' : ''} old.`;
      dateEl.appendChild(document.createTextNode(" — "));
      dateEl.appendChild(warning);
    }
  }

  document.addEventListener("DOMContentLoaded", updateDateWarning);
  document.addEventListener("htmx:afterSettle", function(event) {
    updateDateWarning();
    // History restores have no boosted request and manage their own scroll position.
    if (event.detail.boosted) {
      setTimeout(function() { window.scrollTo(0, 0); }, 50);
    }
  });
})();
