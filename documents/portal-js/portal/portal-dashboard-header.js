/* Portal Dashboard Header (portal) — greeting, sign out, intake CTA.
   Server-rendered from the portal context (greeting/initials come from the
   authenticated user). The intake button opens the portal intake wizard over
   the shared event bus (dap.emit — see shared.js). */

class PortalDashboardHeader {
	constructor(element) {
		this.element = element;
		this.init();
	}

	init() {
		// CROSS-COMPONENT: the portal intake wizard opens on dap:wizard-open.
		this.element.querySelectorAll('[data-wizard-open]').forEach(btn => {
			btn.addEventListener('click', () => window.dap.emit('wizard-open'));
		});
	}
}

document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('[data-component="portal-dashboard-header"]').forEach(el => new PortalDashboardHeader(el));
});
