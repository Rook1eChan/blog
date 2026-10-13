// Dithered video effect (header + footer)
//
// Renders a looping video through a 1-bit ordered-dither fragment shader
// (Atkinson 4x4 by default, or Bayer 8x8 / random noise via ?dither=).
// Transparent pixels let the CSS page background show through, so the water
// fades into the page at the edges instead of being painted by the shader.

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
      node = node.parentElement;
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
  const FRAME_INTERVAL = 1000 / 30; // ~30fps is plenty for a 24fps source
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Resolve sibling static assets from this script's own URL so the site keeps
  // working under any base path.
  function staticUrl(name) {
    const script = document.currentScript;
    if (script && script.src) {
      return script.src.replace(/[^/]+$/, name);
    }
    return name;
  }

  const vsSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0, 1);
      v_texCoord = a_texCoord;
    }
  `;

  const fsSource = `
    precision highp float;
    uniform sampler2D u_image;
    uniform sampler2D u_bayer;
    uniform vec2 u_resolution;
    uniform int u_ditherMode;  // 0 = Bayer, 1 = Atkinson, 2 = noise
    uniform float u_isLight;
    uniform float u_flip;
    uniform float u_alphaFallback;
    uniform vec3 u_backgroundColor;
    varying vec2 v_texCoord;

    // Hash function for stable random noise
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
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
      // u_flip mirrors the whole effect vertically (the footer uses it so the
      // water blends into the page from the top).  u_isLight additionally
      // mirrors the source so its brighter top lands near the page background.
      float mirrorY = u_isLight + u_flip - 2.0 * u_isLight * u_flip;
      vec2 sampleCoord = vec2(v_texCoord.x, mix(v_texCoord.y, 1.0 - v_texCoord.y, mirrorY));
      vec4 color = texture2D(u_image, sampleCoord);
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));

      // Fade away at the edge facing the page content.
      float screenY = gl_FragCoord.y / u_resolution.y;
      screenY = mix(screenY, 1.0 - screenY, u_flip);
      float fade = smoothstep(0.0, 0.4, screenY);
      gray = mix(gray * fade, mix(1.0, gray, fade), u_isLight);

      float threshold;
      if (u_ditherMode == 2) {
        threshold = hash(gl_FragCoord.xy);
      } else if (u_ditherMode == 1) {
        // Slight contrast boost to mimic Atkinson's 75% error diffusion
        gray = clamp(gray * 1.2 - 0.1, 0.0, 1.0);
        threshold = atkinsonThreshold(gl_FragCoord.xy);
      } else {
        vec2 bayerCoord = mod(gl_FragCoord.xy, 8.0) / 8.0;
        threshold = texture2D(u_bayer, bayerCoord).r;
      }

      // Bias the threshold toward the edge color for each theme.
      float thresholdLevel = clamp(threshold + mix(0.1, -0.1, u_isLight), 0.001, 0.999);
      float dithered = step(thresholdLevel, gray);

      vec3 darkInk = vec3(0.91, 0.835, 0.718);   // #e8d5b7
      vec3 lightInk = vec3(0.541, 0.329, 0.110); // #8a541c
      vec3 ink = mix(darkInk, lightInk, u_isLight);
      float inkAlpha = mix(dithered, 1.0 - dithered, u_isLight);
      if (u_alphaFallback > 0.5) {
        gl_FragColor = vec4(mix(u_backgroundColor, ink, inkAlpha), 1.0);
      } else {
        gl_FragColor = vec4(ink, inkAlpha);
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

  // Shared media: one video element drives every canvas.
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.src = staticUrl('waves.mp4');

  const fallbackImage = new Image();
  fallbackImage.crossOrigin = 'anonymous';
  fallbackImage.src = staticUrl('waves-fallback.jpg');

  let videoPlaying = false;
  let fallbackReady = false;

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

    const texLoc = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(texLoc);

    const texBuffer = gl.createBuffer();

    const bayerTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bayerTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 8, 8, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bayerData);
    gl.uniform1i(gl.getUniformLocation(program, 'u_bayer'), 1);

    gl.uniform1i(gl.getUniformLocation(program, 'u_ditherMode'), ditherMode);

    const loc = {
      image: gl.getUniformLocation(program, 'u_image'),
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      isLight: gl.getUniformLocation(program, 'u_isLight'),
      flip: gl.getUniformLocation(program, 'u_flip'),
      alphaFallback: gl.getUniformLocation(program, 'u_alphaFallback'),
      backgroundColor: gl.getUniformLocation(program, 'u_backgroundColor')
    };
    gl.uniform1f(loc.alphaFallback, alphaFallback ? 1.0 : 0.0);
    gl.uniform1f(loc.flip, flip ? 1.0 : 0.0);

    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(loc.image, 0);

    return {
      canvas: canvas,
      gl: gl,
      loc: loc,
      posBuffer: posBuffer,
      posLoc: posLoc,
      texLoc: texLoc,
      texBuffer: texBuffer,
      texture: texture,
      alphaFallback: alphaFallback,
      source: null,
      needsResize: true,
      visible: true
    };
  }

  function setupCanvas(effect, source) {
    const gl = effect.gl;
    const sourceWidth = source === video ? video.videoWidth : fallbackImage.naturalWidth;
    const sourceHeight = source === video ? video.videoHeight : fallbackImage.naturalHeight;
    if (!sourceWidth || !sourceHeight) return false;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(effect.canvas.offsetWidth * dpr));
    const height = Math.max(1, Math.round(effect.canvas.offsetHeight * dpr));
    if (effect.canvas.width !== width || effect.canvas.height !== height) {
      effect.canvas.width = width;
      effect.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    // Cover behavior: show the bottom of the source (crop the top).  The
    // fragment shader mirrors Y in light mode / for the footer.
    const canvasAspect = width / height;
    const sourceAspect = sourceWidth / sourceHeight;
    let texTop = 1, texBottom = 0, texLeft = 0, texRight = 1;
    if (sourceAspect > canvasAspect) {
      const scale = canvasAspect / sourceAspect;
      texLeft = (1 - scale) / 2;
      texRight = 1 - texLeft;
    } else {
      texTop = sourceAspect / canvasAspect;
      texBottom = 0;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, effect.texBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      texLeft, texBottom,   texRight, texBottom,
      texLeft, texTop,      texRight, texTop
    ]), gl.STATIC_DRAW);

    gl.uniform2f(effect.loc.resolution, width, height);
    effect.source = source;
    return true;
  }

  function renderEffect(effect, source) {
    const gl = effect.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, effect.posBuffer);
    gl.vertexAttribPointer(effect.posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, effect.texBuffer);
    gl.vertexAttribPointer(effect.texLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, effect.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.uniform1f(effect.loc.isLight, window.darkThoughtsTheme.isLight() ? 1.0 : 0.0);
    if (effect.alphaFallback) {
      window.darkThoughtsShader.setBackgroundUniform(gl, effect.loc.backgroundColor, effect.canvas);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function currentSource() {
    if (videoPlaying && video.readyState >= 2) return video;
    if (fallbackReady) return fallbackImage;
    return null;
  }

  let effects = [];
  let lastFrameTime = 0;
  let lastDpr = window.devicePixelRatio;

  function drawEffect(effect) {
    const source = currentSource();
    if (!source) return;
    if (effect.needsResize || effect.source !== source) {
      if (!setupCanvas(effect, source)) return;
      effect.needsResize = false;
    }
    renderEffect(effect, source);
  }

  function drawVisibleEffects() {
    for (const effect of effects) {
      if (effect.visible) drawEffect(effect);
    }
  }

  function frame(timestamp) {
    requestAnimationFrame(frame);
    if (document.hidden || effects.length === 0) return;
    if (timestamp - lastFrameTime < FRAME_INTERVAL) return;
    lastFrameTime = timestamp;

    const dpr = window.devicePixelRatio;
    if (dpr !== lastDpr) {
      lastDpr = dpr;
      for (const effect of effects) effect.needsResize = true;
    }

    drawVisibleEffects();
  }

  let themeRepaintId = null;
  function repaintWhileStatic() {
    if (themeRepaintId) cancelAnimationFrame(themeRepaintId);
    const started = performance.now();
    function repaint() {
      const source = currentSource();
      if (videoPlaying || !source) {
        themeRepaintId = null;
        return;
      }
      for (const effect of effects) {
        if (effect.visible) renderEffect(effect, source);
      }
      if (performance.now() - started < 350) {
        themeRepaintId = requestAnimationFrame(repaint);
      } else {
        themeRepaintId = null;
      }
    }
    themeRepaintId = requestAnimationFrame(repaint);
  }

  function tryPlayVideo() {
    if (videoPlaying || REDUCED_MOTION) return;
    video.play().then(function() {
      videoPlaying = true;
      for (const effect of effects) effect.needsResize = true;
    }).catch(function() {
      // Autoplay blocked - retry on first user interaction.
    });
  }

  function onFirstInteraction() {
    tryPlayVideo();
    document.removeEventListener('click', onFirstInteraction);
    document.removeEventListener('touchstart', onFirstInteraction);
    document.removeEventListener('keydown', onFirstInteraction);
    document.removeEventListener('scroll', onFirstInteraction);
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
            if (effect.visible) drawEffect(effect);
          }
        }
      }
    }, { threshold: 0 });
    for (const effect of effects) observer.observe(effect.canvas);

    window.addEventListener('resize', function() {
      for (const effect of effects) effect.needsResize = true;
    });

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        video.pause();
      } else {
        tryPlayVideo();
        drawVisibleEffects();
      }
    });

    fallbackImage.addEventListener('load', function() {
      fallbackReady = true;
      for (const effect of effects) effect.needsResize = true;
    });

    video.addEventListener('loadeddata', tryPlayVideo);

    document.addEventListener('click', onFirstInteraction);
    document.addEventListener('touchstart', onFirstInteraction);
    document.addEventListener('keydown', onFirstInteraction);
    document.addEventListener('scroll', onFirstInteraction);

    window.darkThoughtsTheme.onChange(repaintWhileStatic);

    tryPlayVideo();
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
