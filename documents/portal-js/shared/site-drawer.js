/* Site Drawer (chrome) — off-canvas mobile navigation.
   The open button (#drawerBtn) lives inside the site-header and the scrim is a
   body-level sibling: both are reached via document with cross-component notes.
   Service-area links (.drawer-area) are rendered server-side by the drawer twig
   (prototype populated them with buildAreaLinks from COVERAGE_AREAS). */

class SiteDrawer {
	constructor(element) {
		this.element = element;
		this.init();
	}

	init() {
		// CROSS-COMPONENT: references site-header — #drawerBtn is rendered there.
		this.drawerBtn = document.getElementById('drawerBtn');
		this.scrim = document.getElementById('scrim');
		if (!this.drawerBtn) return;

		this.drawerBtn.addEventListener('click', () => this.open());
		const closeBtn = this.element.querySelector('#drawerClose');
		if (closeBtn) closeBtn.addEventListener('click', () => this.close());
		if (this.scrim) this.scrim.addEventListener('click', () => this.close());

		// Escape closes the drawer (unless the intake wizard is open — it wins).
		document.addEventListener('keydown', e => {
			if (e.key !== 'Escape') return;
			if (document.querySelector('.overlay:not([hidden])')) return;
			this.close();
		});

		// Focus trap while open.
		document.addEventListener('keydown', e => {
			if (e.key !== 'Tab' || !this.element.classList.contains('open')) return;
			if (window.dap && window.dap.trapFocus) window.dap.trapFocus(e, this.element);
		});

		// Service-area links: remember the region, then visit the coverage page.
		this.element.querySelectorAll('.drawer-area[data-area]').forEach(b => {
			b.addEventListener('click', () => {
				sessionStorage.setItem('dap-cov-focus', b.dataset.area);
				window.location.href = '/coverage/';
			});
		});
	}

	open() {
		this.element.classList.add('open');
		if (this.scrim) this.scrim.classList.add('open');
		this.drawerBtn.setAttribute('aria-expanded', 'true');
		const closeBtn = this.element.querySelector('#drawerClose');
		if (closeBtn) closeBtn.focus();
	}

	close() {
		if (!this.element.classList.contains('open')) return;
		const inside = this.element.contains(document.activeElement);
		this.element.classList.remove('open');
		if (this.scrim) this.scrim.classList.remove('open');
		this.drawerBtn.setAttribute('aria-expanded', 'false');
		if (inside) this.drawerBtn.focus();
	}
}

document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('[data-component="site-drawer"]').forEach(el => new SiteDrawer(el));
});
