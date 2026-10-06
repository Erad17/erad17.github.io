/* Intake Wizard (portal) — multi-step intake with validation, signature pad
   and AJAX submission.
   Root: .overlay[data-component="portal-intake-wizard"] (intake-wizard.twig).
   All four steps (+ success panel) are server-rendered; this class handles
   step navigation, per-step validation, the draw/type signature modes and the
   POST to /wp-json/dolphin/v1/intake (X-WP-Nonce from the localized
   window.dolphinPortal config). On success it announces dap:wizard-submitted
   over the shared event bus and asks portal-shared.js to refresh the
   dashboard widgets. Depends on shared.js for window.dap (toast / announce /
   trapFocus / emit / on). */

class PortalIntakeWizard {
	constructor(element) {
		this.element = element;
		this.wiz = { step: 1, drawn: false, typed: '', dirty: false, sigMode: 'draw', data: { programs: [] } };
		this.submitting = false;
		this.readonly = element.getAttribute('data-readonly') === '1';
		this.init();
	}

	init() {
		if (!this.element.querySelector('[data-wiz-next]')) return;

		this.element.querySelectorAll('[data-wiz-close], [data-close-wiz]').forEach(btn => {
			btn.addEventListener('click', () => this.attemptClose());
		});
		this.element.querySelector('[data-wiz-back]').addEventListener('click', () => {
			if (this.wiz.step > 1 && this.wiz.step < 5) { this.wiz.step--; this.showStep(); }
		});
		this.element.querySelector('[data-wiz-next]').addEventListener('click', () => this.submitStep());
		this.element.querySelector('[data-wiz-done]').addEventListener('click', () => {
			this.element.hidden = true;
		});

		// Signature tabs.
		this.element.querySelectorAll('[data-wiz-sig-tab]').forEach(tab => {
			tab.addEventListener('click', () => this.setSigMode(tab.dataset.wizSigTab));
		});
		const sigClear = this.element.querySelector('[data-wiz-sig-clear]');
		if (sigClear) sigClear.addEventListener('click', () => { this.wiz.drawn = false; this.initSigPad(); });
		const typed = this.element.querySelector('[data-wiz-sig-typed]');
		typed.addEventListener('input', () => { this.wiz.typed = typed.value; });

		// Program checkboxes → clear the error on change.
		this.element.querySelectorAll('[data-wiz-program]').forEach(box => {
			box.addEventListener('change', () => {
				this.wiz.dirty = true;
				const err = this.element.querySelector('[data-wiz-error="programs"]');
				if (err) err.textContent = '';
			});
		});

		// Consent → clear the error on change.
		const consent = this.element.querySelector('[data-wiz-consent]');
		consent.addEventListener('change', () => {
			this.wiz.dirty = true;
			const err = this.element.querySelector('[data-wiz-error="consent"]');
			if (err) err.textContent = '';
		});

		// Keyboard: Escape closes, Tab is trapped inside the dialog.
		document.addEventListener('keydown', e => {
			if (e.key === 'Escape' && !this.element.hidden) this.attemptClose();
			if (e.key === 'Tab' && !this.element.hidden && window.dap && window.dap.trapFocus) {
				window.dap.trapFocus(e, this.element.querySelector('.wiz-dialog'));
			}
		});

		// CROSS-COMPONENT: dashboard header + widgets open the wizard on
		// dap:wizard-open over the shared event bus.
		window.dap.on('wizard-open', () => this.open());
	}

	/* ── Open / close ────────────────────────────────────────────────── */

	open() {
		this.wiz = { step: 1, drawn: false, typed: '', dirty: false, sigMode: 'draw', data: { programs: [] } };
		this.resetInputs();
		this.element.hidden = false;
		this.showStep();
		this.element.querySelector('[data-wiz-close]').focus();
	}

	attemptClose() {
		if (this.wiz.step === 5 || !this.wiz.dirty || this.submitting) { this.element.hidden = true; return; }
		if (window.confirm('Close without submitting? Your progress will be lost.')) this.element.hidden = true;
	}

	resetInputs() {
		this.element.querySelectorAll('.inp').forEach(inp => { inp.value = ''; });
		this.element.querySelectorAll('[data-wiz-program]').forEach(box => { box.checked = false; });
		this.element.querySelector('[data-wiz-consent]').checked = false;
		this.element.querySelectorAll('.ferr').forEach(err => { err.textContent = ''; });
		this.element.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
		this.element.querySelectorAll('[data-wiz-review]').forEach(dd => { dd.textContent = ''; });
		this.setSigMode('draw');
		this.wiz.drawn = false;
	}

	/* ── Step rendering ──────────────────────────────────────────────── */

	showStep() {
		const wiz = this.wiz;
		this.element.querySelectorAll('[data-wiz-panel]').forEach(panel => {
			panel.hidden = +panel.dataset.wizPanel !== wiz.step;
		});
		this.paintSteps();

		const back = this.element.querySelector('[data-wiz-back]');
		const next = this.element.querySelector('[data-wiz-next]');
		const foot = this.element.querySelector('[data-wiz-foot]');
		back.style.visibility = (wiz.step === 1 || wiz.step === 5) ? 'hidden' : 'visible';
		foot.hidden = wiz.step === 5;
		if (this.readonly && wiz.step === 4) {
			next.disabled = true;
			next.innerHTML = 'Read-only — submit disabled';
		} else {
			next.disabled = false;
			next.innerHTML = wiz.step === 4
				? 'Submit intake <span class="arr" aria-hidden="true">→</span>'
				: 'Continue <span class="arr" aria-hidden="true">→</span>';
		}

		if (wiz.step === 1) {
			this.element.querySelector('#wName').focus();
		} else if (wiz.step === 3) {
			if (wiz.sigMode === 'draw') requestAnimationFrame(() => this.initSigPad());
			else this.element.querySelector('[data-wiz-sig-typed]').focus();
		} else if (wiz.step === 4) {
			this.fillReview();
		}
	}

	paintSteps() {
		this.element.querySelectorAll('[data-wiz-steps] .wiz-step').forEach((s, i) => {
			s.classList.toggle('cur', i === this.wiz.step - 1);
			s.classList.toggle('done', i < this.wiz.step - 1);
		});
		const now = this.element.querySelector('[data-wiz-step-now]');
		if (now) now.textContent = Math.min(this.wiz.step, 4);
	}

	/* ── Validation (per step) ───────────────────────────────────────── */

	fail(field, message) {
		const err = field.closest('.field') ? field.closest('.field').querySelector('.ferr') : null;
		if (field.closest('.field')) field.closest('.field').classList.add('invalid');
		field.setAttribute('aria-invalid', 'true');
		if (err) err.textContent = message;
		return false;
	}

	validateStep() {
		const wiz = this.wiz;
		const get = sel => this.element.querySelector(sel);
		const err = name => this.element.querySelector('[data-wiz-error="' + name + '"]');

		if (wiz.step === 1) {
			const name = get('#wName');
			const email = get('#wEmail');
			const phone = get('#wPhone');
			const concern = get('#wConcern');
			let ok = true, first = null;

			[ [name, v => v.trim().length >= 2 || 'Enter the student’s full name.'],
			  [email, v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Enter a valid email.'],
			  [phone, v => v.replace(/\D/g, '').length >= 10 || 'Enter a 10-digit phone number.'],
			  [concern, v => !!v || 'Choose a primary focus.'],
			].forEach(pair => {
				const field = pair[0], rule = pair[1];
				const wrap = field.closest('.field');
				wrap.classList.remove('invalid');
				field.removeAttribute('aria-invalid');
				const ferr = wrap.querySelector('.ferr');
				if (ferr) ferr.textContent = '';
				const result = rule(field.value);
				if (result !== true) {
					wrap.classList.add('invalid');
					field.setAttribute('aria-invalid', 'true');
					if (ferr) ferr.textContent = result;
					ok = false;
					if (!first) first = field;
				}
			});

			wiz.data.name = name.value.trim();
			wiz.data.email = email.value.trim();
			wiz.data.phone = phone.value.trim();
			wiz.data.concern = concern.value;
			if (first) first.focus();
			return ok;
		}

		if (wiz.step === 2) {
			wiz.data.programs = Array.from(this.element.querySelectorAll('[data-wiz-program]'))
				.filter(box => box.checked)
				.map(box => +box.dataset.wizProgram);
			if (!wiz.data.programs.length) {
				if (err('programs')) err('programs').textContent = 'Select at least one program to continue.';
				return false;
			}
			wiz.data.when = get('#wWhen').value;
			return true;
		}

		if (wiz.step === 3) {
			let ok = true;
			if (!get('[data-wiz-consent]').checked) {
				if (err('consent')) err('consent').textContent = 'Consent is required for sensitive student forms.';
				ok = false;
			}
			if (wiz.sigMode === 'draw') {
				if (!wiz.drawn) {
					if (err('signature')) err('signature').textContent = 'Please draw your signature above the line — or switch to “Type it.”';
					ok = false;
				}
			} else {
				wiz.typed = get('[data-wiz-sig-typed]').value.trim();
				if (wiz.typed.length < 3) {
					if (err('signature')) err('signature').textContent = 'Type your full legal name as your signature.';
					ok = false;
				}
			}
			return ok;
		}

		return true;
	}

	/* ── Review step ─────────────────────────────────────────────────── */

	fillReview() {
		const wiz = this.wiz;
		const labels = Array.from(this.element.querySelectorAll('[data-wiz-program]'))
			.filter(box => box.checked)
			.map(box => box.nextElementSibling.textContent.trim());
		const set = (key, value) => {
			const dd = this.element.querySelector('[data-wiz-review="' + key + '"]');
			if (dd) dd.textContent = value;
		};
		set('name', wiz.data.name);
		set('email', wiz.data.email);
		set('success-email', wiz.data.email);
		set('phone', wiz.data.phone);
		set('concern', wiz.data.concern);
		set('programs', labels.join(', '));
		set('when', wiz.data.when ? wiz.data.when.replace('T', ' · ') : 'Coordinator will suggest times');
		set('signature', wiz.sigMode === 'draw' ? '✎ Hand-drawn signature on file' : wiz.typed);
	}

	/* ── Step / submit flow ──────────────────────────────────────────── */

	submitStep() {
		const wiz = this.wiz;
		wiz.dirty = true;
		if (!this.validateStep()) {
			this.toast('Please fix the highlighted fields.', 'err');
			return;
		}
		if (wiz.step < 4) { wiz.step++; this.showStep(); return; }
		if (this.readonly) return;
		if (this.submitting) return;
		this.submit(wiz);
	}

	async submit(wiz) {
		const next = this.element.querySelector('[data-wiz-next]');
		const back = this.element.querySelector('[data-wiz-back]');
		this.submitting = true;
		next.disabled = true;
		back.disabled = true;
		next.innerHTML = '<span class="spin" aria-hidden="true"></span> Encrypting & sending…';

		const signature = wiz.sigMode === 'draw'
			? this.canvasDataUrl()
			: wiz.typed;

		try {
			const response = await window.dapPortal.api('intake', {
				method: 'POST',
				body: {
					student_name: wiz.data.name,
					student_email: wiz.data.email,
					student_phone: wiz.data.phone,
					primary_concern: wiz.data.concern,
					programs: wiz.data.programs,
					appointment_preference: wiz.data.when || '',
					signature_mode: wiz.sigMode,
					signature_data: signature,
				},
			});

			const ref = response.ref;
			const refEl = this.element.querySelector('[data-wiz-ref]');
			if (refEl) refEl.textContent = 'REF ' + ref;
			this.wiz.step = 5;
			this.showStep();
			this.announce('Intake form submitted. Reference ' + ref);
			this.toast('Intake submitted — ' + ref + '. Confirmation emailed to you.');
			// CROSS-COMPONENT: my-forms/notifications widgets refresh over the
			// shared event bus; portal-shared.js refetches the server-rendered
			// widget fragments.
			window.dap.emit('wizard-submitted', { ref, name: 'Intake — ' + wiz.data.name });
			if (window.dapPortal && typeof window.dapPortal.refreshDashboard === 'function') {
				window.dapPortal.refreshDashboard();
			}
		} catch (error) {
			this.toast(error && error.message ? error.message : 'The submission failed — please try again.', 'err');
		} finally {
			this.submitting = false;
			next.disabled = false;
			back.disabled = false;
			if (this.wiz.step < 5) next.innerHTML = 'Submit intake <span class="arr" aria-hidden="true">→</span>';
		}
	}

	canvasDataUrl() {
		const canvas = this.element.querySelector('[data-wiz-canvas]');
		if (!canvas || !this.wiz.drawn) return '';
		try { return canvas.toDataURL('image/png'); } catch (err) { return ''; }
	}

	/* ── Signature pad ───────────────────────────────────────────────── */

	setSigMode(mode) {
		this.wiz.sigMode = mode;
		this.element.querySelectorAll('[data-wiz-sig-tab]').forEach(tab => {
			tab.setAttribute('aria-selected', String(tab.dataset.wizSigTab === mode));
		});
		this.element.querySelector('[data-wiz-sig-pane="draw"]').hidden = mode !== 'draw';
		this.element.querySelector('[data-wiz-sig-pane="type"]').hidden = mode !== 'type';
		const sigErr = this.element.querySelector('[data-wiz-error="signature"]');
		if (sigErr) sigErr.textContent = '';
		if (mode === 'draw') requestAnimationFrame(() => this.initSigPad());
	}

	initSigPad() {
		const canvas = this.element.querySelector('[data-wiz-canvas]');
		if (!canvas) return;
		const wrap = canvas.parentElement, dpr = window.devicePixelRatio || 1;
		const w = Math.max(200, wrap.clientWidth - 4), h = 170;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		canvas.style.width = w + 'px';
		canvas.style.height = h + 'px';
		const ctx = canvas.getContext('2d');
		ctx.scale(dpr, dpr);
		ctx.lineWidth = 2.4;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#0B2233';
		let drawing = false;
		const pos = e => {
			const r = canvas.getBoundingClientRect();
			return { x: e.clientX - r.left, y: e.clientY - r.top };
		};
		canvas.onpointerdown = e => {
			drawing = true;
			canvas.setPointerCapture(e.pointerId);
			const p = pos(e);
			ctx.beginPath();
			ctx.moveTo(p.x, p.y);
			this.wiz.dirty = true;
		};
		canvas.onpointermove = e => {
			if (!drawing) return;
			const p = pos(e);
			ctx.lineTo(p.x, p.y);
			ctx.stroke();
			this.wiz.drawn = true;
			const hint = this.element.querySelector('[data-wiz-sig-hint]');
			if (hint) hint.style.opacity = '0';
			const sigErr = this.element.querySelector('[data-wiz-error="signature"]');
			if (sigErr) sigErr.textContent = '';
		};
		canvas.onpointerup = () => { drawing = false; };
		canvas.onpointercancel = () => { drawing = false; };
	}

	toast(msg, type) {
		if (window.dap && window.dap.toast) window.dap.toast(msg, type);
	}

	announce(msg) {
		if (window.dap && window.dap.announce) window.dap.announce(msg);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('[data-component="portal-intake-wizard"]').forEach(el => new PortalIntakeWizard(el));
});
