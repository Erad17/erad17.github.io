/* Prep Readiness Widget (portal) — progress ring animation.
   Server-rendered (the ring is only shown for authenticated families); the
   percentage animates on load. Depends on shared.js. */

class PrepReadinessWidget {
	constructor(element) {
		this.element = element;
		this.init();
	}

	init() {
		// Authenticated state is server-rendered — animate immediately.
		this.animateTo(0.72);
	}

	animateTo(ratio) {
		const ring = this.element.querySelector('#ringFg');
		const pct = this.element.querySelector('#ringPct');
		if (!ring || !pct) return;
		setTimeout(() => {
			ring.style.strokeDashoffset = 327 * (1 - ratio);
			pct.textContent = Math.round(ratio * 100) + '%';
		}, 120);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('[data-component="prep-readiness-widget"]').forEach(el => new PrepReadinessWidget(el));
});
