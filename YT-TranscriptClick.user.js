// ==UserScript==
// @name         YT-TranscriptClick
// @namespace    https://github.com/marcomarca/YT-TranscriptClick
// @version      0.1.0
// @description  Extractor flotante de subtítulos de YouTube en texto plano con copia rápida para Tampermonkey.
// @author       marcomarca
// @homepageURL  https://github.com/marcomarca/YT-TranscriptClick
// @supportURL   https://github.com/marcomarca/YT-TranscriptClick/issues
// @downloadURL  https://raw.githubusercontent.com/marcomarca/YT-TranscriptClick/main/YT-TranscriptClick.user.js
// @updateURL    https://raw.githubusercontent.com/marcomarca/YT-TranscriptClick/main/YT-TranscriptClick.user.js
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  try {
    if (window.top !== window.self) return;
  } catch (_) {
    return;
  }

  const APP = '__yt_transcript_click';
  const STORAGE_POSITION = `${APP}_position_v1`;
  const CAPTURES = [];

  const STATE = {
    videoId: '',
    lastText: '',
    lastTitle: '',
    panel: null,
    textarea: null,
    status: null,
    extractBtn: null,
    copyBtn: null,
    downloadBtn: null,
    drag: {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      originLeft: 0,
      originTop: 0,
    },
  };

  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch (_) {}
    return window;
  }

  const pageWindow = getPageWindow();
  let trustedPolicy = null;

  function initTrustedPolicy() {
    const trustedTypesObject = window.trustedTypes || pageWindow.trustedTypes;
    if (!trustedTypesObject || !trustedTypesObject.createPolicy) return;

    for (const name of ['MyPromptPolicy', 'dompurify', 'default', 'cwm-policy', '__yt_transcript_click_policy']) {
      try {
        trustedPolicy = trustedTypesObject.createPolicy(name, {
          createHTML: (value) => value,
        });
        break;
      } catch (_) {}
    }
  }

  initTrustedPolicy();

  function toTrustedHTML(value) {
    const text = String(value || '');
    if (trustedPolicy && typeof trustedPolicy.createHTML === 'function') {
      return trustedPolicy.createHTML(text);
    }
    return text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getCurrentVideoId() {
    try {
      const url = new URL(location.href);

      if (url.pathname === '/watch') return url.searchParams.get('v') || '';

      const shortsMatch = url.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch) return shortsMatch[1];

      const embedMatch = url.pathname.match(/^\/embed\/([^/?#]+)/);
      if (embedMatch) return embedMatch[1];
    } catch (_) {}

    return '';
  }

  function getVideoIdFromTimedTextUrl(url) {
    try {
      return new URL(url, location.href).searchParams.get('v') || '';
    } catch (_) {
      return '';
    }
  }

  function getVideoTitle() {
    try {
      const response = pageWindow.ytInitialPlayerResponse;
      const fromResponse = response && response.videoDetails && response.videoDetails.title;
      if (fromResponse) return fromResponse;
    } catch (_) {}

    const h1 = document.querySelector('h1 yt-formatted-string, h1.title, h1');
    const fromDom = h1 ? (h1.innerText || h1.textContent || '').trim() : '';
    if (fromDom) return fromDom;

    return document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'youtube-subtitles';
  }

  function sanitizeFilename(name) {
    return String(name || 'youtube-subtitles')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'youtube-subtitles';
  }

  function extractRequestUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.href;
      if (input && typeof input.url === 'string') return input.url;
      if (input && typeof input.href === 'string') return input.href;
      if (input && typeof input.toString === 'function') return input.toString();
    } catch (_) {}
    return '';
  }

  function isTimedTextUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return parsed.hostname.endsWith('youtube.com') && (parsed.pathname.includes('/api/timedtext') || parsed.pathname.includes('/timedtext'));
    } catch (_) {
      return false;
    }
  }

  function markHooked(fn, key) {
    try {
      Object.defineProperty(fn, key, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    } catch (_) {
      try { fn[key] = true; } catch (_) {}
    }
  }

  function isHooked(fn, key) {
    try { return !!(fn && fn[key]); } catch (_) { return false; }
  }

  function decodeHtmlEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = toTrustedHTML(text);
    return textarea.value;
  }

  function cleanCaptionText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactLines(lines) {
    const result = [];
    let previous = '';

    for (const line of lines) {
      const cleaned = cleanCaptionText(line);
      if (!cleaned) continue;
      if (cleaned === previous) continue;
      result.push(cleaned);
      previous = cleaned;
    }

    return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function parseJson3(json) {
    const lines = [];

    for (const event of json.events || []) {
      if (!Array.isArray(event.segs)) continue;
      const text = event.segs.map((segment) => segment.utf8 || '').join('');
      const cleaned = cleanCaptionText(text);
      if (cleaned) lines.push(cleaned);
    }

    return compactLines(lines);
  }

  function parseXmlCaptions(xmlText) {
    const doc = new DOMParser().parseFromString(toTrustedHTML(xmlText), 'text/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) throw new Error('XML inválido.');

    const textNodes = Array.from(doc.querySelectorAll('text'));
    if (textNodes.length) {
      return compactLines(textNodes.map((node) => cleanCaptionText(decodeHtmlEntities(node.textContent || ''))));
    }

    const pNodes = Array.from(doc.querySelectorAll('p'));
    if (pNodes.length) {
      return compactLines(pNodes.map((node) => cleanCaptionText(decodeHtmlEntities(node.textContent || ''))));
    }

    return '';
  }

  function parseVtt(vttText) {
    const lines = String(vttText || '').split(/\r?\n/);
    const output = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^WEBVTT/i.test(trimmed)) continue;
      if (/^\d+$/.test(trimmed)) continue;
      if (/-->/i.test(trimmed)) continue;
      if (/^(NOTE|STYLE|REGION)\b/i.test(trimmed)) continue;

      const cleaned = cleanCaptionText(trimmed.replace(/<[^>]+>/g, '').replace(/\{\\.*?\}/g, ''));
      if (cleaned) output.push(decodeHtmlEntities(cleaned));
    }

    return compactLines(output);
  }

  function parseCaptionBody(body, contentType = '') {
    const trimmed = String(body || '').trim();
    if (!trimmed) return '';

    if (trimmed.startsWith('{')) {
      return parseJson3(JSON.parse(trimmed));
    }

    if (/webvtt/i.test(contentType) || /^WEBVTT/i.test(trimmed)) {
      return parseVtt(trimmed);
    }

    if (trimmed.startsWith('<')) {
      return parseXmlCaptions(trimmed);
    }

    return '';
  }

  function setStatus(message) {
    if (STATE.status) STATE.status.textContent = message;
  }

  function ingestTimedTextCapture(payload) {
    if (!payload || !payload.url) return;

    const body = String(payload.body || '');
    const videoId = getVideoIdFromTimedTextUrl(payload.url) || getCurrentVideoId();

    let text = '';
    try {
      text = parseCaptionBody(body, payload.contentType || '');
    } catch (error) {
      console.warn(`${APP}: no se pudo parsear captura`, error);
    }

    let hasPot = false;
    let lang = '';
    let fmt = '';

    try {
      const parsed = new URL(payload.url, location.href);
      hasPot = parsed.searchParams.has('pot');
      lang = parsed.searchParams.get('lang') || '';
      fmt = parsed.searchParams.get('fmt') || '';
    } catch (_) {}

    const capture = {
      ts: Date.now(),
      videoId,
      url: payload.url,
      status: payload.status || 0,
      ok: !!payload.ok,
      method: payload.method || '',
      contentType: payload.contentType || '',
      bodyLength: body.length,
      body,
      text,
      textLength: text.length,
      hasPot,
      lang,
      fmt,
    };

    CAPTURES.push(capture);
    while (CAPTURES.length > 60) CAPTURES.shift();

    console.log(`${APP}: timedtext capture`, {
      videoId: capture.videoId,
      status: capture.status,
      method: capture.method,
      contentType: capture.contentType,
      bodyLength: capture.bodyLength,
      textLength: capture.textLength,
      hasPot: capture.hasPot,
      lang: capture.lang,
      fmt: capture.fmt,
    });

    if (capture.text && capture.videoId === getCurrentVideoId()) {
      const words = capture.text.split(/\s+/).filter(Boolean).length;
      setStatus(`Subtítulos capturados desde la petición real de YouTube. ${words} palabras aprox.`);
    }
  }

  function hookFetch() {
    try {
      if (!pageWindow || typeof pageWindow.fetch !== 'function') return;
      if (isHooked(pageWindow.fetch, `${APP}_fetch_hooked`)) return;

      const originalFetch = pageWindow.fetch;

      const wrappedFetch = function (...args) {
        const requestUrl = extractRequestUrl(args[0]);
        const shouldCapture = isTimedTextUrl(requestUrl);
        const promise = originalFetch.apply(this, args);

        if (shouldCapture) {
          promise.then((response) => {
            try {
              const clone = response.clone();
              clone.text().then((body) => {
                ingestTimedTextCapture({
                  url: requestUrl,
                  status: response.status,
                  ok: response.ok,
                  contentType: response.headers.get('content-type') || '',
                  body,
                  method: 'page-fetch',
                });
              }).catch(() => {});
            } catch (_) {}
          }).catch(() => {});
        }

        return promise;
      };

      markHooked(wrappedFetch, `${APP}_fetch_hooked`);
      pageWindow.fetch = wrappedFetch;
    } catch (error) {
      console.warn(`${APP}: no se pudo hookear fetch`, error);
    }
  }

  function hookXhr() {
    try {
      const XHR = pageWindow && pageWindow.XMLHttpRequest;
      const proto = XHR && XHR.prototype;
      if (!proto || typeof proto.open !== 'function' || typeof proto.send !== 'function') return;

      if (!isHooked(proto.open, `${APP}_xhr_open_hooked`)) {
        const originalOpen = proto.open;

        const wrappedOpen = function (method, url) {
          try {
            this.__captionLiftTimedTextUrl = extractRequestUrl(url);
            this.__captionLiftShouldCapture = isTimedTextUrl(this.__captionLiftTimedTextUrl);
          } catch (_) {
            this.__captionLiftTimedTextUrl = '';
            this.__captionLiftShouldCapture = false;
          }

          return originalOpen.apply(this, arguments);
        };

        markHooked(wrappedOpen, `${APP}_xhr_open_hooked`);
        proto.open = wrappedOpen;
      }

      if (!isHooked(proto.send, `${APP}_xhr_send_hooked`)) {
        const originalSend = proto.send;

        const wrappedSend = function () {
          if (this.__captionLiftShouldCapture) {
            try {
              this.addEventListener('loadend', () => {
                let body = '';

                try {
                  if (!this.responseType || this.responseType === 'text') {
                    body = this.responseText || '';
                  }
                } catch (_) {}

                ingestTimedTextCapture({
                  url: this.__captionLiftTimedTextUrl,
                  status: this.status,
                  ok: this.status >= 200 && this.status < 300,
                  contentType: this.getResponseHeader('content-type') || '',
                  body,
                  method: 'page-xhr',
                });
              });
            } catch (_) {}
          }

          return originalSend.apply(this, arguments);
        };

        markHooked(wrappedSend, `${APP}_xhr_send_hooked`);
        proto.send = wrappedSend;
      }
    } catch (error) {
      console.warn(`${APP}: no se pudo hookear XHR`, error);
    }
  }

  function installNetworkHooks() {
    hookFetch();
    hookXhr();
  }

  installNetworkHooks();
  setInterval(installNetworkHooks, 1500);

  function ensureStyles() {
    if (document.getElementById(`${APP}_styles`)) return;

    const css = `
      #${APP}_panel {
        all: initial;
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: min(440px, calc(100vw - 28px));
        background: rgba(18, 18, 22, 0.94);
        color: #f5f7fb;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 16px;
        box-shadow: 0 18px 48px rgba(0,0,0,.36);
        backdrop-filter: blur(14px);
        font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-sizing: border-box;
        overflow: hidden;
      }
      #${APP}_panel, #${APP}_panel * { box-sizing: border-box; }
      #${APP}_panel.__dragging, #${APP}_panel.__dragging * { cursor: grabbing !important; user-select: none !important; }
      #${APP}_header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.10); }
      #${APP}_drag { cursor: grab; width: 28px; height: 28px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; color: rgba(245,247,251,.74); background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.10); user-select: none; font-weight: 700; line-height: 1; }
      #${APP}_title { flex: 1; min-width: 0; }
      #${APP}_title strong { display: block; font-size: 13px; color: #fff; }
      #${APP}_title span { display: block; margin-top: 2px; color: rgba(245,247,251,.66); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #${APP}_body { padding: 12px; display: grid; gap: 10px; }
      #${APP}_buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      #${APP}_panel button { min-height: 36px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.07); color: #f5f7fb; padding: 0 10px; cursor: pointer; font: inherit; }
      #${APP}_panel button:hover { background: rgba(255,255,255,.11); }
      #${APP}_panel button:disabled { opacity: .45; cursor: default; }
      #${APP}_extract { grid-column: span 2; background: rgba(109,131,255,.24) !important; border-color: rgba(109,131,255,.42) !important; }
      #${APP}_textarea { width: 100%; min-height: 190px; max-height: 42vh; resize: vertical; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.22); color: #f5f7fb; padding: 10px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; outline: none; }
      #${APP}_status { min-height: 18px; color: rgba(245,247,251,.72); font-size: 12px; white-space: pre-wrap; }
      @media (prefers-color-scheme: light) {
        #${APP}_panel { background: rgba(255,255,255,.94); color: #111827; border-color: rgba(17,24,39,.12); box-shadow: 0 18px 48px rgba(15,23,42,.18); }
        #${APP}_header { border-bottom-color: rgba(17,24,39,.10); }
        #${APP}_drag, #${APP}_panel button { background: rgba(17,24,39,.05); border-color: rgba(17,24,39,.12); color: #111827; }
        #${APP}_panel button:hover { background: rgba(17,24,39,.08); }
        #${APP}_title strong { color: #111827; }
        #${APP}_title span, #${APP}_status { color: rgba(17,24,39,.66); }
        #${APP}_textarea { background: rgba(17,24,39,.04); border-color: rgba(17,24,39,.12); color: #111827; }
      }
    `;

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
      return;
    }

    const style = document.createElement('style');
    style.id = `${APP}_styles`;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function loadPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_POSITION);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function savePosition(left, top) {
    try { localStorage.setItem(STORAGE_POSITION, JSON.stringify({ left, top })); } catch (_) {}
  }

  function clampPanelPosition(left, top) {
    const panel = STATE.panel;
    if (!panel) return { left, top };

    const margin = 10;
    const rect = panel.getBoundingClientRect();
    const width = rect.width || 440;
    const height = rect.height || 280;

    return {
      left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin)),
      top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin)),
    };
  }

  function applySavedPosition() {
    if (!STATE.panel) return;
    const saved = loadPosition();
    if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;

    const position = clampPanelPosition(saved.left, saved.top);
    STATE.panel.style.left = `${position.left}px`;
    STATE.panel.style.top = `${position.top}px`;
    STATE.panel.style.right = 'auto';
    STATE.panel.style.bottom = 'auto';
  }

  function bindDrag(handle) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !STATE.panel) return;

      const rect = STATE.panel.getBoundingClientRect();
      STATE.drag.active = true;
      STATE.drag.pointerId = event.pointerId;
      STATE.drag.startX = event.clientX;
      STATE.drag.startY = event.clientY;
      STATE.drag.originLeft = rect.left;
      STATE.drag.originTop = rect.top;

      STATE.panel.classList.add('__dragging');
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!STATE.drag.active || event.pointerId !== STATE.drag.pointerId || !STATE.panel) return;

      const nextLeft = STATE.drag.originLeft + (event.clientX - STATE.drag.startX);
      const nextTop = STATE.drag.originTop + (event.clientY - STATE.drag.startY);
      const position = clampPanelPosition(nextLeft, nextTop);

      STATE.panel.style.left = `${position.left}px`;
      STATE.panel.style.top = `${position.top}px`;
      STATE.panel.style.right = 'auto';
      STATE.panel.style.bottom = 'auto';
    });

    const finish = (event) => {
      if (!STATE.drag.active || event.pointerId !== STATE.drag.pointerId || !STATE.panel) return;

      STATE.drag.active = false;
      STATE.panel.classList.remove('__dragging');

      const left = parseFloat(STATE.panel.style.left);
      const top = parseFloat(STATE.panel.style.top);

      if (Number.isFinite(left) && Number.isFinite(top)) savePosition(left, top);
      try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
    };

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function buildPanel() {
    if (!document.body) return;
    ensureStyles();

    const existing = document.getElementById(`${APP}_panel`);
    if (existing) {
      STATE.panel = existing;
      return;
    }

    const panel = document.createElement('div');
    panel.id = `${APP}_panel`;

    const header = document.createElement('div');
    header.id = `${APP}_header`;

    const drag = document.createElement('div');
    drag.id = `${APP}_drag`;
    drag.title = 'Arrastra para mover';
    drag.textContent = '⋮⋮';

    const title = document.createElement('div');
    title.id = `${APP}_title`;

    const titleStrong = document.createElement('strong');
    titleStrong.textContent = 'YT-TranscriptClick';

    const titleSmall = document.createElement('span');
    titleSmall.id = `${APP}_video_title`;
    titleSmall.textContent = 'YouTube subtitle extractor';

    title.appendChild(titleStrong);
    title.appendChild(titleSmall);
    header.appendChild(drag);
    header.appendChild(title);

    const body = document.createElement('div');
    body.id = `${APP}_body`;

    const buttons = document.createElement('div');
    buttons.id = `${APP}_buttons`;

    const extractBtn = document.createElement('button');
    extractBtn.id = `${APP}_extract`;
    extractBtn.type = 'button';
    extractBtn.textContent = 'Extraer y copiar';

    const copyBtn = document.createElement('button');
    copyBtn.id = `${APP}_copy`;
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copiar de nuevo';
    copyBtn.disabled = true;

    const downloadBtn = document.createElement('button');
    downloadBtn.id = `${APP}_download`;
    downloadBtn.type = 'button';
    downloadBtn.textContent = 'Descargar .txt';
    downloadBtn.disabled = true;

    buttons.appendChild(extractBtn);
    buttons.appendChild(copyBtn);
    buttons.appendChild(downloadBtn);

    const textarea = document.createElement('textarea');
    textarea.id = `${APP}_textarea`;
    textarea.readOnly = true;
    textarea.placeholder = 'Pulsa “Extraer y copiar”. Si YouTube exige PoToken, activa CC manualmente, espera unos segundos y vuelve a pulsar.';

    const status = document.createElement('div');
    status.id = `${APP}_status`;
    status.textContent = 'Listo. Si acabas de instalar o actualizar el script, recarga el video.';

    body.appendChild(buttons);
    body.appendChild(textarea);
    body.appendChild(status);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    STATE.panel = panel;
    STATE.textarea = textarea;
    STATE.status = status;
    STATE.extractBtn = extractBtn;
    STATE.copyBtn = copyBtn;
    STATE.downloadBtn = downloadBtn;

    bindDrag(drag);

    extractBtn.addEventListener('click', extractAndCopy);
    copyBtn.addEventListener('click', copyLastText);
    downloadBtn.addEventListener('click', downloadLastText);

    requestAnimationFrame(applySavedPosition);
  }

  function setVideoTitle(title) {
    const el = document.getElementById(`${APP}_video_title`);
    if (el) el.textContent = title || 'Video actual';
  }

  function setBusy(isBusy) {
    if (STATE.extractBtn) STATE.extractBtn.disabled = !!isBusy;
  }

  function findBestCapture(videoId, sinceTs = 0) {
    const candidates = CAPTURES
      .filter((capture) => {
        if (!capture) return false;
        if (sinceTs && capture.ts < sinceTs) return false;
        if (videoId && capture.videoId && capture.videoId !== videoId) return false;
        return true;
      })
      .sort((a, b) => b.ts - a.ts);

    return candidates.find((capture) => capture.text) || candidates.find((capture) => capture.hasPot && capture.url) || candidates[0] || null;
  }

  async function waitForCapture(videoId, sinceTs, timeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const capture = findBestCapture(videoId, sinceTs);
      if (capture && capture.text) return capture;
      if (capture && capture.hasPot && capture.url) return capture;
      await sleep(250);
    }

    return findBestCapture(videoId, sinceTs);
  }

  async function forceCaptionNetworkRequest() {
    const button = document.querySelector('.ytp-subtitles-button');
    if (!button) return false;

    const pressed = button.getAttribute('aria-pressed') === 'true' || button.classList.contains('ytp-button-active');

    if (pressed) {
      button.click();
      await sleep(350);
      button.click();
    } else {
      button.click();
    }

    return true;
  }

  function getPlayerResponse() {
    try {
      const direct = pageWindow.ytInitialPlayerResponse;
      if (direct) return direct;
    } catch (_) {}

    try {
      const raw = pageWindow.ytplayer && pageWindow.ytplayer.config && pageWindow.ytplayer.config.args && pageWindow.ytplayer.config.args.player_response;
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {}

    return null;
  }

  function getDirectTracks() {
    const response = getPlayerResponse();
    const tracks = response && response.captions && response.captions.playerCaptionsTracklistRenderer && response.captions.playerCaptionsTracklistRenderer.captionTracks;
    return Array.isArray(tracks) ? tracks.filter((track) => track && track.baseUrl) : [];
  }

  async function fetchTimedTextUrl(url) {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
    });

    const body = await response.text();
    if (!response.ok || !body.trim()) return '';

    return parseCaptionBody(body, response.headers.get('content-type') || '');
  }

  async function fetchCapturedUrl(capture) {
    if (!capture || !capture.url) return '';

    const variants = [];
    const seen = new Set();

    function add(url) {
      const href = url.toString();
      if (seen.has(href)) return;
      seen.add(href);
      variants.push(href);
    }

    const original = new URL(capture.url, location.href);
    add(original);

    for (const fmt of ['json3', 'vtt', 'srv3']) {
      const variant = new URL(original);
      variant.searchParams.set('fmt', fmt);
      add(variant);
    }

    for (const url of variants) {
      try {
        const text = await fetchTimedTextUrl(url);
        if (text) return text;
      } catch (error) {
        console.warn(`${APP}: captured URL fetch failed`, error);
      }
    }

    return '';
  }

  async function tryDirectBaseUrlFallback() {
    const tracks = getDirectTracks();
    if (!tracks.length) return '';

    const preferred = tracks.find((track) => String(track.languageCode || '').startsWith('es')) || tracks[0];
    const original = new URL(preferred.baseUrl, location.href);
    const urls = [original.toString()];

    for (const fmt of ['json3', 'vtt', 'srv3']) {
      const variant = new URL(original);
      variant.searchParams.set('fmt', fmt);
      urls.push(variant.toString());
    }

    for (const url of urls) {
      try {
        const text = await fetchTimedTextUrl(url);
        if (text) return text;
      } catch (_) {}
    }

    return '';
  }

  async function copyToClipboard(text) {
    if (!text) return;

    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, { type: 'text', mimetype: 'text/plain' });
      return;
    }

    if (typeof GM !== 'undefined' && GM && typeof GM.setClipboard === 'function') {
      await GM.setClipboard(text, 'text');
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try { document.execCommand('copy'); } finally { textarea.remove(); }
  }

  async function applyExtractedText(text) {
    STATE.lastText = text;
    STATE.lastTitle = getVideoTitle();

    if (STATE.textarea) STATE.textarea.value = text;

    await copyToClipboard(text);

    if (STATE.copyBtn) STATE.copyBtn.disabled = false;
    if (STATE.downloadBtn) STATE.downloadBtn.disabled = false;

    const words = text.split(/\s+/).filter(Boolean).length;
    setStatus(`Copiado al portapapeles. ${words} palabras aproximadamente.`);
  }

  async function extractAndCopy() {
    try {
      const videoId = getCurrentVideoId();
      if (!videoId) {
        setStatus('No estás en una página de video.');
        return;
      }

      STATE.videoId = videoId;
      STATE.lastTitle = getVideoTitle();
      setVideoTitle(STATE.lastTitle);
      setBusy(true);

      const existingCapture = findBestCapture(videoId, 0);
      if (existingCapture && existingCapture.text) {
        setStatus('Usando captura real ya disponible.');
        await applyExtractedText(existingCapture.text);
        return;
      }

      setStatus('Activando CC para capturar la petición real de YouTube…');
      const sinceTs = Date.now();
      await forceCaptionNetworkRequest();

      const capture = await waitForCapture(videoId, sinceTs, 9000);
      if (capture && capture.text) {
        await applyExtractedText(capture.text);
        return;
      }

      if (capture && capture.hasPot && capture.url) {
        setStatus('Se capturó URL con PoToken. Descargando subtítulos desde esa URL…');
        const textFromCapturedUrl = await fetchCapturedUrl(capture);
        if (textFromCapturedUrl) {
          await applyExtractedText(textFromCapturedUrl);
          return;
        }
      }

      setStatus('No se capturó respuesta útil. Probando fallback directo…');
      const fallbackText = await tryDirectBaseUrlFallback();
      if (fallbackText) {
        await applyExtractedText(fallbackText);
        return;
      }

      throw new Error('No pude extraer el subtítulo. Activa CC manualmente, espera 2 segundos y pulsa “Extraer y copiar” otra vez.');
    } catch (error) {
      console.error(`${APP}: error final`, error);
      setStatus(`Error: ${error.message || String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyLastText() {
    try {
      if (!STATE.lastText) {
        setStatus('No hay texto extraído todavía.');
        return;
      }

      await copyToClipboard(STATE.lastText);
      setStatus('Copiado de nuevo al portapapeles.');
    } catch (error) {
      setStatus(`Error copiando: ${error.message || String(error)}`);
    }
  }

  function downloadLastText() {
    if (!STATE.lastText) {
      setStatus('No hay texto para descargar.');
      return;
    }

    const blob = new Blob([STATE.lastText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `${sanitizeFilename(STATE.lastTitle || getVideoTitle())}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Archivo .txt generado.');
  }

  function boot() {
    if (!document.body) {
      setTimeout(boot, 100);
      return;
    }

    buildPanel();

    const videoId = getCurrentVideoId();
    STATE.videoId = videoId;
    STATE.lastTitle = getVideoTitle();
    setVideoTitle(videoId ? STATE.lastTitle : 'Abre un video de YouTube');

    if (STATE.panel) STATE.panel.style.display = videoId ? '' : 'none';
  }

  function onNavigation() {
    setTimeout(() => {
      const videoId = getCurrentVideoId();
      STATE.videoId = videoId;
      STATE.lastText = '';

      if (STATE.textarea) STATE.textarea.value = '';
      if (STATE.copyBtn) STATE.copyBtn.disabled = true;
      if (STATE.downloadBtn) STATE.downloadBtn.disabled = true;
      if (STATE.panel) STATE.panel.style.display = videoId ? '' : 'none';

      if (videoId) {
        STATE.lastTitle = getVideoTitle();
        setVideoTitle(STATE.lastTitle);
        setStatus('Video detectado. Pulsa “Extraer y copiar”.');
      }
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('yt-navigate-finish', onNavigation);
  window.addEventListener('popstate', onNavigation);

  window.addEventListener('resize', () => {
    if (!STATE.panel) return;

    const rect = STATE.panel.getBoundingClientRect();
    const position = clampPanelPosition(rect.left, rect.top);

    STATE.panel.style.left = `${position.left}px`;
    STATE.panel.style.top = `${position.top}px`;
    STATE.panel.style.right = 'auto';
    STATE.panel.style.bottom = 'auto';
  }, { passive: true });
})();
