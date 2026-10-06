/* Portal Login (portal) — real authentication.
   The form POSTs to the custom AJAX handler (action=dolphin_portal_login,
   see plugins/dolphin-portal/dolphin-portal.php) which authenticates via
   wp_signon(), verifies the account has a portal role, and returns the
   portal URL to reload into the authenticated dashboard. Boot config comes
   from the localized window.dolphinPortal (loginNonce). Depends on shared.js
   for window.dap.toast / .announce. */

class PortalLogin {
	constructor(element) {
		this.element = element;
		this.init();
	}

	init() {
		const form = this.element.querySelector('#loginForm');
		if (form) form.addEventListener('submit', e => this.onSubmit(e));
	}

	onSubmit(e) {
		e.preventDefault();
		const email = this.element.querySelector('#lEmail');
		const pass = this.element.querySelector('#lPass');
		const err = this.element.querySelector('#lError');
		const btn = this.element.querySelector('#lSubmit');

		const em = email ? email.value.trim() : '';
		const pw = pass ? pass.value : '';

		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || pw.length < 1) {
			if (err) {
				err.hidden = false;
				err.textContent = 'Check your credentials — a valid email and your password are required.';
			}
			return;
		}
		if (err) err.hidden = true;

		btn.disabled = true;
		btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Verifying…';

		const config = window.dolphinPortal || {};
		const body = new URLSearchParams();
		body.append('action', 'dolphin_portal_login');
		body.append('nonce', config.loginNonce || '');
		body.append('email', em);
		body.append('password', pw);

		fetch(config.ajaxUrl || '/wp-admin/admin-ajax.php', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		})
			.then(response => response.json())
			.then(json => {
				if (!json || !json.success) {
					throw new Error(json && json.data && json.data.message ? json.data.message : 'Sign-in failed — please try again.');
				}
				if (pass) pass.value = '';
				this.announce('Signed in to the Family Portal');
				window.location.assign(json.data.redirect || window.location.pathname);
			})
			.catch(error => {
				btn.disabled = false;
				btn.innerHTML = 'Sign in <span class="arr" aria-hidden="true">→</span>';
				if (err) {
					err.hidden = false;
					err.textContent = error.message;
				}
				this.toast(error.message, 'err');
			});
	}

	toast(msg, type) {
		if (window.dap && window.dap.toast) window.dap.toast(msg, type);
	}

	announce(msg) {
		if (window.dap && window.dap.announce) window.dap.announce(msg);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('[data-component="portal-login"]').forEach(el => new PortalLogin(el));
});
