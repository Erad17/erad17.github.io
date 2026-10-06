// Shared utilities — loaded on every page.
/* Phase 2d — global_js bucket from .pipeline/01-parse/section-map.json
   ($, $$, esc, announce, toast, trapFocus, setTheme, router, initReveals,
   runCounter [with its inner rAF tick], path, onViewEnter), extracted from the
   prototype (spaToCMS/dolphinv2.html) and adapted from the hash-SPA to
   WordPress:
   - namespaced as window.dap — the handle every Phase 2c component class
     already expects (window.dap.toast / .announce / .trapFocus). The
     dolphinv2 slug stays reserved for CPT/meta prefixes (includes/cpts.php).
     Events use the same dap:* prefix the components dispatch on document.
   - event bus on/off/emit, implemented on top of document CustomEvents so
     bus traffic and the components' dap:* events interoperate;
   - toast()/announce() are idempotent (repeated calls coalesce instead of
     stacking) and self-provision their live regions if the chrome is missing;
   - setTheme() drives the [data-theme="dark"] system on :root
     (documentElement), persists to localStorage and emits dap:theme-change;
     applyCapsuleVars() adapts the holiday capsule system to the :root custom
     properties (--cap-a/--cap-b/--cap-glow) and emits dap:capsule-change
     (the capsule-ribbon component owns the ribbon UI and applies the same
     vars itself — kept in sync until it is migrated onto this helper);
   - runCounter()/initReveals() accept DOM elements (root defaults to document);
   - router()/path()/onViewEnter() re-aimed from the hash router to per-page
     WordPress: nav highlighting plus a dap:view-enter event. Per-view widget
     bootstrapping (quotes, catalog, coverage, portal, contact) is handled by
     the Phase 2c component classes on DOMContentLoaded.
   No Elementor hooks. */

(function () {
	'use strict';

	const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

	/* ═══════════════ DOM utilities ═══════════════ */

	const $ = (s, c = document) => c.querySelector(s);
	const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

	function esc(s) {
		return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	/* ═══════════════ Event bus ═══════════════ */
	/* Registered callbacks ride on document CustomEvents ("dap:" + event), so
	   dap.emit('foo') reaches both bus subscribers and any component listening
	   for the DOM event — and component-dispatched dap:* events reach bus
	   subscribers. on() is idempotent per (event, callback) pair. */

	const busWrappers = {};

	function on(event, cb) {
		if (!event || typeof cb !== 'function') return;
		const list = busWrappers[event] || (busWrappers[event] = []);
		if (list.some(w => w.cb === cb)) return;
		const wrap = e => cb(e.detail, e);
		list.push({ cb, wrap });
		document.addEventListener('dap:' + event, wrap);
	}

	function off(event, cb) {
		const list = busWrappers[event];
		if (!list) return;
		const i = list.findIndex(w => w.cb === cb);
		if (i === -1) return;
		document.removeEventListener('dap:' + event, list[i].wrap);
		list.splice(i, 1);
	}

	function emit(event, data) {
		document.dispatchEvent(new CustomEvent('dap:' + event, { detail: data }));
	}

	/* ═══════════════ Live regions: announce + toast ═══════════════ */

	function ensureAnnouncer() {
		let a = $('#announcer');
		if (!a) {
			a = document.createElement('p');
			a.id = 'announcer';
			a.className = 'sr-only';
			a.setAttribute('role', 'status');
			a.setAttribute('aria-live', 'polite');
			document.body.appendChild(a);
		}
		return a;
	}

	let announceT = null;

	function announce(msg) {
		const a = ensureAnnouncer();
		if (!a) return;
		if (announceT) clearTimeout(announceT); // idempotent: coalesce rapid calls
		a.textContent = '';
		announceT = setTimeout(() => { a.textContent = msg; }, 60);
	}

	function ensureToastRegion() {
		let r = $('#toastRegion');
		if (!r) {
			r = document.createElement('div');
			r.className = 'toast-region';
			r.id = 'toastRegion';
			r.setAttribute('aria-live', 'polite');
			r.setAttribute('aria-atomic', 'false');
			document.body.appendChild(r);
		}
		return r;
	}

	const liveToasts = new Map(); // "type|msg" -> { el, timer, dismiss }

	function toast(msg, type = 'ok') {
		const region = ensureToastRegion();
		if (!region) return;
		const key = type + '|' + msg;
		const prior = liveToasts.get(key);
		if (prior) {
			// idempotent: refresh the existing toast instead of stacking a twin
			clearTimeout(prior.timer);
			prior.timer = setTimeout(prior.dismiss, 4600);
			return;
		}
		const icons = {
			ok: '<path d="M20 6L9 17l-5-5"/>',
			warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
			err: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>'
		};
		const el = document.createElement('div');
		el.className = 'toast t-' + type;
		el.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[type] || icons.ok) + '</svg><span>' + esc(msg) + '</span><button class="t-x" aria-label="Dismiss notification"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px" aria-hidden="true"><path d="M6 6l12 12M18 6l6 18"/></svg></button>';
		region.appendChild(el);
		const entry = { el, timer: 0, dismiss: null };
		entry.dismiss = () => {
			clearTimeout(entry.timer);
			el.classList.add('out');
			setTimeout(() => { el.remove(); liveToasts.delete(key); }, 320);
		};
		entry.timer = setTimeout(entry.dismiss, 4600);
		el.querySelector('.t-x').addEventListener('click', entry.dismiss);
		liveToasts.set(key, entry);
	}

	/* ═══════════════ Focus trap ═══════════════ */

	function trapFocus(e, container) {
		if (e.key !== 'Tab') return;
		const f = $$(FOCUSABLE, container).filter(el => el.offsetParent !== null || el === document.activeElement);
		if (!f.length) return;
		const first = f[0], last = f[f.length - 1];
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}

	/* ═══════════════ Theme system (setTheme) ═══════════════ */
	/* Toggles [data-theme="dark"] on :root — the CSS custom-property switch
	   defined in global.css — persists the choice and emits dap:theme-change. */

	function setTheme(t) {
		const theme = t === 'dark' ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		try { localStorage.setItem('dap-theme', theme); } catch (err) { /* storage blocked */ }
		$$('#themeToggle, [data-theme-toggle]').forEach(btn => {
			btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
		});
		emit('theme-change', { theme, dark: theme === 'dark' });
	}

	/* Delegated so the toggle works whenever the header chrome renders. */
	document.addEventListener('click', e => {
		const btn = e.target && e.target.closest ? e.target.closest('#themeToggle, [data-theme-toggle]') : null;
		if (!btn) return;
		setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
	});

	/* ═══════════════ Capsule system (adapted) ═══════════════ */
	/* Writes the holiday capsule palette on :root (--cap-a/--cap-b/--cap-glow)
	   and emits dap:capsule-change. The capsule-ribbon component applies the
	   same custom properties; hero + holiday-capsule-strip listen for the event. */

	function applyCapsuleVars(cap, id) {
		if (!cap) return;
		const root = document.documentElement.style;
		root.setProperty('--cap-a', cap.a);
		root.setProperty('--cap-b', cap.b);
		root.setProperty('--cap-glow', cap.a + '3A');
		emit('capsule-change', { id: id || cap.id, cap });
	}

	/* ═══════════════ Capsule persistence (sessionStorage) ═══════════════ */
	/* The prototype was an SPA, so the capsule selection lived in memory for
	   the whole session. WordPress does full page loads and state dies with
	   each document — so the last selection is stored here on every
	   dap:capsule-change (ribbon select, capsule strip cards and the shared
	   applyCapsuleVars() all converge on that event) and re-applied in boot()
	   via dap:capsule-apply, which the capsule-ribbon component owns.
	   'auto' persists like any explicit choice; it resolves to the
	   date-window capsule at apply time. */

	const CAPSULE_KEY = 'dap-capsule';

	function setCapsule(id) {
		try { sessionStorage.setItem(CAPSULE_KEY, String(id)); } catch (err) { /* storage blocked */ }
	}

	function getCapsule() {
		try { return sessionStorage.getItem(CAPSULE_KEY); } catch (err) { return null; }
	}

	on('capsule-change', detail => {
		if (detail && detail.id) setCapsule(detail.id);
	});

	/* ═══════════════ Scroll reveals & counters ═══════════════ */

	let io = null;
	if ('IntersectionObserver' in window) {
		io = new IntersectionObserver(entries => {
			entries.forEach(e => {
				if (!e.isIntersecting) return;
				e.target.classList.add('is-in');
				if (e.target.dataset && e.target.dataset.count) runCounter(e.target);
				io.unobserve(e.target);
			});
		}, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
	}

	function initReveals(root = document) {
		const els = $$('.reveal,[data-count]', root);
		if (!io) {
			els.forEach(el => { el.classList.add('is-in'); if (el.dataset.count) runCounter(el); });
			return;
		}
		els.forEach(el => { el.classList.remove('is-in'); io.observe(el); });
	}

	function runCounter(el) {
		if (!el || !el.dataset || !el.dataset.count) return;
		const target = +el.dataset.count, pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
		const fmt = v => pre + v.toLocaleString('en-US') + suf;
		if (REDUCED) { el.innerHTML = fmt(target).replace(/([+%,])/, '<span class="sfx">$1</span>'); return; }
		const t0 = performance.now(), dur = 1300;
		(function tick(t) {
			const k = Math.min(1, (t - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
			el.innerHTML = fmt(Math.round(target * ease)).replace(/([+%,])/, '<span class="sfx">$1</span>');
			if (k < 1) requestAnimationFrame(tick);
		})(t0);
	}

	/* ═══════════════ Page routing (adapted from the hash SPA) ═══════════════ */

	function path() {
		return location.pathname;
	}

	/* View id mirrors the prototype ROUTES table ('/' -> view-home,
	   '/programs/' -> view-programs, ...) so dap:view-enter stays comparable. */
	function pageId() {
		const view = document.body.getAttribute('data-view');
		if (view) return view;
		const p = path().replace(/\/+$/, '') || '/';
		return 'view' + p.replace(/\//g, '-');
	}

	function highlightNav() {
		const here = path().replace(/\/+$/, '') || '/';
		$$('.main-nav a, .drawer nav a').forEach(a => {
			const href = a.getAttribute('href') || '';
			if (!href || href.charAt(0) === '#') return; // in-page anchors
			const there = (a.pathname || href).replace(/\/+$/, '') || '/';
			const on = there === here;
			a.classList.toggle('active', on);
			if (on) { a.setAttribute('aria-current', 'page'); } else { a.removeAttribute('aria-current'); }
		});
	}

	/* Prototype hooked per-view widget bootstrapping here (startQuotes,
	   ensureCatalog, renderCoverage, renderPortal, prepContact) — on WordPress
	   those live in the Phase 2c component classes, so this just broadcasts. */
	function onViewEnter(id) {
		emit('view-enter', { id: id || pageId() });
	}

	function router() {
		highlightNav();
		initReveals(document);
		onViewEnter(pageId());
	}

	/* ═══════════════ Namespace + boot ═══════════════ */

	window.dap = {
		$, $$, esc,
		on, off, emit,
		announce, toast,
		trapFocus,
		setTheme, applyCapsuleVars, setCapsule, getCapsule,
		initReveals, runCounter,
		path, router, onViewEnter
	};

	function boot() {
		let saved = null;
		try { saved = localStorage.getItem('dap-theme'); } catch (err) { /* storage blocked */ }
		setTheme(saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
		// Capsule persistence: re-apply the last selection. The emit is
		// deferred one tick because the capsule components (capsule-ribbon,
		// hero, holiday-capsule-strip) subscribe on this same DOMContentLoaded
		// dispatch — an immediate emit would fire before their handlers exist.
		const savedCapsule = getCapsule();
		if (savedCapsule) setTimeout(() => emit('capsule-apply', { id: savedCapsule }), 0);
		router();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
