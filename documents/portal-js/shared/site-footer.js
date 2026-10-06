/* Site Footer (chrome) — newsletter form, copyright year, service-area links.
   Area links (#footerAreas .f-link) are rendered server-side by the footer twig
   (prototype populated them with buildAreaLinks from COVERAGE_AREAS) — carry
   data-area on each link so the region can be pre-focused on the coverage page.
   Depends on shared.js (Phase 2d) for window.dap.toast. */

class SiteFooter {
	constructor(element) {
		this.element = element;
		this.init();
	}

	init() {
		const yr = this.element.querySelector('#yr');
		if (yr) yr.textContent = new Date().getFullYear();

		const form = this.element.querySelector('#nlForm');
		if (form) {
			form.addEventListener('submit', e => {
				e.preventDefault();
				const input = this.element.querySelector('#nlEmail');
				if (!input) return;
				const em = input.value.trim();
				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
					this.toast('Enter a valid email to join the list.', 'warn');
					return;
				}
				input.value = '';
				this.toast('You’re on the list — test-date alerts and free seminar invites incoming.');
			});
		}

		const areas = this.element.querySelector('#footerAreas');
		if (areas) {
			areas.querySelectorAll('.f-link').forEach(b => {
				b.addEventListener('click', () => {
					if (b.dataset.area) sessionStorage.setItem('dap-cov-focus', b.dataset.area);
					window.location.href = '/coverage/';
				});
			});
		}
	}

	toast(msg, type) {
		if (window.dap && window.dap.toast) window.dap.toast(msg, type);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('[data-component="site-footer"]').forEach(el => new SiteFooter(el));
});
