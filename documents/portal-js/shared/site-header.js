/* Site Header (chrome) — scrolled-state affordance.
   Theme toggle (setTheme) and nav highlighting (router) live in shared.js
   (global_js bucket). */

class SiteHeader {
	constructor(element) {
		this.element = element;
		this.init();
	}

	init() {
		window.addEventListener('scroll', () => {
			this.element.classList.toggle('scrolled', window.scrollY > 8);
		}, { passive: true });
	}
}

document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('[data-component="site-header"]').forEach(el => new SiteHeader(el));
});
