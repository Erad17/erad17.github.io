/* Capsule Ribbon (chrome) — holiday capsule theming system.
   Owns the :root capsule custom properties and the ribbon announcement text.
   Depends on shared.js (Phase 2d) for window.dap.toast and the event bus
   (dap.emit / dap.on — Phase 3c) — falls back silently. */

class CapsuleRibbon {
	constructor(element) {
		this.element = element;
		this.select = element.querySelector('#capsulePreview');
		this.unsubs = [];
		this.init();
	}

	/* dap.on() returns no unsubscriber — subscribe() tracks (event, handler)
	   pairs so destroy() can detach them via dap.off(). */
	subscribe(event, handler) {
		window.dap.on(event, handler);
		this.unsubs.push(() => window.dap.off(event, handler));
	}

	destroy() {
		this.unsubs.forEach(off => off());
		this.unsubs.length = 0;
	}

	/* Prototype data (CAPSULES). TODO: feed from the dolphinv2_capsule CPT
	   (id, name, greet, dates, start, end, a, b, motif). */
	static get CAPSULES() {
		return [
			{ id: 'diwali', name: 'Diwali', greet: 'Wishing you a bright Diwali.', dates: 'Oct 25 – Nov 5', start: [10, 25], end: [11, 5], a: '#FFB300', b: '#E65100', motif: 'diya' },
			{ id: 'election', name: 'Election Week', greet: 'Election Week — your future, your voice, your prep.', dates: 'Nov 1 – Nov 7', start: [11, 1], end: [11, 7], a: '#3B6FE0', b: '#D64545', motif: 'star' },
			{ id: 'thanks', name: 'Thanksgiving', greet: 'Happy Thanksgiving — gratitude & grit.', dates: 'Nov 20 – Nov 30', start: [11, 20], end: [11, 30], a: '#E08A00', b: '#9C4A12', motif: 'leaf' },
			{ id: 'winter', name: 'Winter Break', greet: 'Winter Intensive — snow-day-proof sessions.', dates: 'Dec 15 – Jan 4', start: [12, 15], end: [1, 4], a: '#6FC7E8', b: '#2B7BB9', motif: 'snow' },
			{ id: 'lunar', name: 'Lunar New Year', greet: 'Happy Lunar New Year — fresh starts, big goals.', dates: 'Jan 20 – Feb 10', start: [1, 20], end: [2, 10], a: '#E23B3B', b: '#FFC53D', motif: 'lantern' },
			{ id: 'spring', name: 'Spring Term', greet: 'Spring forward — prep season is open.', dates: 'Mar 1 – Mar 25', start: [3, 1], end: [3, 25], a: '#3FA66A', b: '#0E7C86', motif: 'petal' },
			{ id: 'default', name: 'Open Enrollment', greet: 'A calm, coached learning season starts here.', dates: 'Auto · year-round', start: null, end: null, a: '#12A5B0', b: '#F4650F', motif: 'spark' }
		];
	}

	init() {
		if (!this.select) return;
		this.buildOptions();
		this.select.addEventListener('change', () => {
			this.applyCapsule(this.select.value);
			const c = CapsuleRibbon.CAPSULES.find(x => x.id === this.select.value);
			this.toast(this.select.value === 'auto'
				? 'Capsule set to automatic scheduling.'
				: 'Capsule preview: ' + c.name + ' — ribbon & hero updated.');
		});
		// Other components (capsule strip cards) can request a capsule switch
		// over the shared event bus.
		this.subscribe('capsule-apply', detail => {
			this.select.value = detail.id;
			this.applyCapsule(detail.id);
		});
		// Defer the initial capsule one tick: this component's script loads
		// before the per-page component scripts (hero, capsule strip), so
		// emitting capsule-change synchronously here would fire before those
		// components subscribe on the same DOMContentLoaded dispatch and they
		// would miss the event (hero motifs would never render).
		//
		// Capsule persistence: shared.js stores the last selection
		// (sessionStorage, dap-capsule) and re-applies it from its own boot()
		// via a deferred dap:capsule-apply emit — which lands on the handler
		// below (setting the select and applying the theme) after everything
		// has subscribed. Only fall back to automatic scheduling when nothing
		// was persisted, so the dropdown remembers the selection.
		setTimeout(() => {
			if (window.dap.getCapsule && window.dap.getCapsule()) return;
			this.applyCapsule('auto');
		}, 0);
	}

	buildOptions() {
		if (this.select.options.length > 1) return; // server-rendered options win
		CapsuleRibbon.CAPSULES.forEach(c => {
			if (c.id === 'default') return;
			const o = document.createElement('option');
			o.value = c.id;
			o.textContent = c.name;
			this.select.appendChild(o);
		});
	}

	capsuleForToday() {
		const now = new Date(), m = now.getMonth() + 1, d = now.getDate();
		const inWin = c => {
			if (!c.start) return false;
			const sm = c.start[0], sd = c.start[1], em = c.end[0], ed = c.end[1];
			const cur = m * 100 + d, s = sm * 100 + sd, e = em * 100 + ed;
			return s <= e ? (cur >= s && cur <= e) : (cur >= s || cur <= e);
		};
		return CapsuleRibbon.CAPSULES.find(inWin) || CapsuleRibbon.CAPSULES.find(c => c.id === 'default');
	}

	applyCapsule(id) {
		const cap = CapsuleRibbon.CAPSULES.find(c => c.id === id) || this.capsuleForToday();
		// Capsule palette lives on :root so any component can use var(--cap-*).
		const root = document.documentElement.style;
		root.setProperty('--cap-a', cap.a);
		root.setProperty('--cap-b', cap.b);
		root.setProperty('--cap-glow', cap.a + '3A');

		const rt = this.element.querySelector('#ribbonTxt');
		if (rt) {
			rt.innerHTML = '<strong>' + cap.greet + '</strong> &nbsp;·&nbsp; '
				+ (cap.id === 'default'
					? 'Now enrolling across North/Central NJ &amp; NYC — in-home tutors come to you.'
					: 'Holiday Capsule · ' + cap.dates + ' · themed automatically.');
		}

		// CROSS-COMPONENT: hero (greeting/dates/motifs) and holiday-capsule-strip
		// (card pressed states) react to capsule changes over the shared event bus.
		window.dap.emit('capsule-change', { id, cap });
	}

	toast(msg, type) {
		if (window.dap && window.dap.toast) window.dap.toast(msg, type);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('[data-component="capsule-ribbon"]').forEach(el => new CapsuleRibbon(el));
});
