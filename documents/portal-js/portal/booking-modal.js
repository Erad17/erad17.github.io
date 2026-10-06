/* Booking Modal (portal) — 5-step session booking + confirmation (Part 7).
   Root: .overlay[data-component="portal-booking-modal"] (booking-modal.twig).
   Server-rendered student/program/coach lists (the embedded data-booking
   JSON carries the filtering attributes); this class handles step
   navigation, per-step validation, grade-based program filtering, the
   14-day date strip + slot buttons (GET /dolphin/v1/availability-slots),
   the "Add a student" inline form (POST /dolphin/v1/students) and the
   final POST /dolphin/v1/booking. On success the modal switches to the
   confirmation panel (Part 9): .ics download + Google/Outlook links +
   the disabled messaging teaser. Reuses the intake wizard's overlay /
   focus-trap pattern (window.dap.trapFocus) and window.dapPortal.api.
   Read-only while spoofing: the Book button is disabled. */

class PortalBookingModal {
	constructor(element) {
		this.element = element;
		this.dialog = element.querySelector('.bk-dialog');
		this.readonly = element.getAttribute('data-readonly') === '1';
		try {
			this.data = JSON.parse(element.dataset.booking || '{}');
		} catch (parseError) {
			this.data = { students: [], services: [], coaches: [] };
		}
		this.data.students = this.data.students || [];
		this.data.services = this.data.services || [];
		this.data.coaches = this.data.coaches || [];

		this.step = 1;           // 1-5 + 6 = confirmation panel
		this.submitting = false;
		this.selection = { student: null, service: null, coach: null, mode: 'in-person', date: null, slot: null };
		this.slotCache = {};     // date → { slots, unavailable_reason }
		this.datesLoaded = false;

		this.init();
	}

	/* ── Wiring ─────────────────────────────────────────────────────── */

	init() {
		this.element.querySelectorAll('[data-bk-close]').forEach(btn => {
			btn.addEventListener('click', () => this.close());
		});
		const back = this.element.querySelector('[data-bk-back]');
		const next = this.element.querySelector('[data-bk-next]');
		const done = this.element.querySelector('[data-bk-done]');
		if (back) back.addEventListener('click', () => this.goBack());
		if (next) next.addEventListener('click', () => this.next());
		if (done) done.addEventListener('click', () => {
			this.close();
			if (window.dapPortal && window.dapPortal.refreshDashboard) {
				window.dapPortal.refreshDashboard();
			}
		});

		// Student cards.
		this.element.addEventListener('click', e => {
			const card = e.target.closest('[data-bk-student]');
			if (card) {
				this.selectStudent(+card.dataset.bkStudent, card);
				return;
			}
			const coachCard = e.target.closest('[data-bk-coach]');
			if (coachCard) {
				this.selectCoach(+coachCard.dataset.bkCoach, coachCard);
				return;
			}
			const modeBtn = e.target.closest('[data-bk-mode-btn]');
			if (modeBtn) {
				this.setMode(modeBtn.dataset.bkModeBtn);
				return;
			}
			const slotBtn = e.target.closest('[data-bk-slot]');
			if (slotBtn) {
				this.selectSlot(slotBtn);
				return;
			}
			const dateBtn = e.target.closest('[data-bk-date]');
			if (dateBtn && !dateBtn.disabled) {
				this.selectDate(dateBtn.dataset.bkDate, dateBtn);
				return;
			}
			const addToggle = e.target.closest('[data-bk-add-toggle]');
			if (addToggle) {
				const form = this.element.querySelector('[data-bk-add-form]');
				if (form) {
					form.hidden = !form.hidden;
					if (!form.hidden) form.querySelector('[name="name"]').focus();
				}
			}
		});

		// Program select → clear the error on change.
		const service = this.element.querySelector('[data-bk-service]');
		if (service) service.addEventListener('change', () => this.clearError('service'));

		// Add-a-student inline form.
		const addForm = this.element.querySelector('[data-bk-add-form]');
		if (addForm) addForm.addEventListener('submit', e => this.submitStudent(e));

		// Keyboard: Escape closes, Tab is trapped inside the dialog.
		document.addEventListener('keydown', e => {
			if (e.key === 'Escape' && !this.element.hidden) {
				this.close();
				return;
			}
			if (e.key === 'Tab' && !this.element.hidden && window.dap && window.dap.trapFocus) {
				window.dap.trapFocus(e, this.dialog);
			}
		});
	}

	/* ── Open / close ────────────────────────────────────────────────── */

	open() {
		this.selection = { student: null, service: null, coach: null, mode: 'in-person', date: null, slot: null };
		this.slotCache = {};
		this.datesLoaded = false;
		this.step = 1;
		this.clearAllErrors();
		this.resetTransientInputs();

		// Pre-select a single-student family (the step still shows).
		const cards = this.element.querySelectorAll('[data-bk-student]');
		if (cards.length === 1) {
			this.selectStudent(+cards[0].dataset.bkStudent, cards[0]);
		} else {
			cards.forEach(c => this.paintStudent(c, false));
		}
		// Restore the previously chosen program when it still fits.
		this.filterPrograms();

		this.element.hidden = false;
		this.showStep();
		this.element.querySelector('[data-bk-close]').focus();
	}

	close() {
		if (this.submitting) return; // Don't abandon an in-flight booking.
		if (this.step === 6) {
			this.element.hidden = true;
			return;
		}
		this.element.hidden = true;
	}

	resetTransientInputs() {
		const notes = this.element.querySelector('[data-bk-notes]');
		const location = this.element.querySelector('[data-bk-location]');
		if (notes) notes.value = '';
		if (location) location.value = '';
		this.element.querySelectorAll('.ferr').forEach(err => { err.textContent = ''; });
		this.element.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
	}

	/* ── Step rendering ──────────────────────────────────────────────── */

	showStep() {
		this.element.querySelectorAll('[data-bk-panel]').forEach(panel => {
			panel.hidden = +panel.dataset.bkPanel !== this.step;
		});
		this.element.querySelectorAll('[data-bk-steps] .wiz-step').forEach((s, i) => {
			s.classList.toggle('cur', i === Math.min(this.step, 5) - 1);
			s.classList.toggle('done', i < Math.min(this.step, 5) - 1);
		});
		const now = this.element.querySelector('[data-bk-step-now]');
		if (now) now.textContent = Math.min(this.step, 5);

		const back = this.element.querySelector('[data-bk-back]');
		const next = this.element.querySelector('[data-bk-next]');
		const foot = this.element.querySelector('[data-bk-foot]');
		if (back) back.style.visibility = (this.step === 1 || this.step === 6) ? 'hidden' : 'visible';
		if (foot) foot.hidden = this.step === 6;

		if (next) {
			if (this.step === 5) {
				next.innerHTML = this.readonly
					? 'Read-only — booking disabled'
					: 'Book session <span class="arr" aria-hidden="true">→</span>';
				next.disabled = this.readonly;
			} else {
				next.innerHTML = 'Continue <span class="arr" aria-hidden="true">→</span>';
				next.disabled = false;
			}
		}

		if (this.step === 2) this.renderStep2();
		if (this.step === 4) this.enterTimeStep();
		if (this.step === 5) this.renderReview();
	}

	goBack() {
		if (this.step > 1 && this.step < 6) {
			this.step--;
			this.showStep();
		}
	}

	next() {
		if (this.step === 5) {
			this.submitBooking();
			return;
		}
		if (!this.validateStep()) return;
		this.step++;
		this.showStep();
	}

	/* ── Selection handlers ──────────────────────────────────────────── */

	paintStudent(card, selected) {
		card.setAttribute('aria-selected', String(selected));
		card.classList.toggle('is-selected', selected);
	}

	selectStudent(id, card) {
		this.selection.student = id;
		this.element.querySelectorAll('[data-bk-student]').forEach(c => this.paintStudent(c, +c.dataset.bkStudent === id));
		this.clearError('student');
		this.filterPrograms();
		const name = this.element.querySelector('[data-bk-student-name]');
		if (name) name.textContent = this.studentLabel(id);
	}

	studentLabel(id) {
		const st = this.data.students.find(s => +s.id === +id);
		return st ? st.name : 'the student';
	}

	selectCoach(id, card) {
		this.selection.coach = id;
		this.element.querySelectorAll('[data-bk-coach]').forEach(c => {
			c.classList.toggle('is-selected', c === card);
			c.setAttribute('aria-selected', String(c === card));
		});
		this.clearError('coach');
		this.datesLoaded = false; // Different coach → refetch the strip.
		this.slotCache = {};
	}

	setMode(mode) {
		this.selection.mode = mode;
		this.element.querySelectorAll('[data-bk-mode-btn]').forEach(btn => {
			btn.setAttribute('aria-checked', String(btn.dataset.bkModeBtn === mode));
		});
		this.datesLoaded = false; // Mode affects which blocks offer slots.
		this.slotCache = {};
		if (this.step === 4) this.enterTimeStep();
	}

	/* ── Step 2: program dropdown, grade-filtered ────────────────────── */

	renderStep2() {
		this.filterPrograms();
	}

	filterPrograms() {
		const select = this.element.querySelector('[data-bk-service]');
		if (!select) return;
		const student = this.data.students.find(s => +s.id === +this.selection.student);
		const gradeIndex = student ? +student.grade_index : 0;
		let selectedFits = false;
		select.querySelectorAll('option').forEach(option => {
			const min = +(option.dataset.minGrade || 0);
			const fits = min <= gradeIndex;
			option.hidden = option.value !== '' && !fits;
			if (option.selected && fits) selectedFits = true;
		});
		if (select.value !== '' && !selectedFits) {
			select.value = '';
		}
		this.selection.service = select.value ? +select.value : null;
	}

	/* ── Step 4: date strip + slots ──────────────────────────────────── */

	async enterTimeStep() {
		this.renderReview(); // Keep later-step review fresh.
		const strip = this.element.querySelector('[data-bk-dates]');
		const slots = this.element.querySelector('[data-bk-slots]');
		if (slots) slots.innerHTML = '';
		if (!strip) return;

		if (this.datesLoaded) {
			this.paintDateStrip();
			return;
		}
		strip.innerHTML = '<div class="bk-dates-loading"><span class="spin" aria-hidden="true"></span> Checking the next 14 days…</div>';
		this.clearError('time');

		const dates = [];
		const today = new Date();
		for (let i = 0; i < 14; i++) {
			const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
			dates.push(d.toISOString().slice(0, 10));
		}

		const requests = dates.map(date => this.fetchSlots(date).then(result => ({ date, result })));
		const settled = await Promise.all(requests.map(p => p.catch(() => null)));
		const counts = {};
		settled.forEach(row => {
			if (!row) return;
			counts[row.date] = row.result;
			this.slotCache[row.date] = row.result;
		});
		this.datesLoaded = true;
		this.paintDateStrip();
	}

	async fetchSlots(date) {
		const params = new URLSearchParams({ coach_id: this.selection.coach, date, service_id: this.selection.service || 0 });
		if (this.selection.mode) params.set('mode', this.selection.mode);
		const payload = await window.dapPortal.api('availability-slots?' + params.toString());
		return payload || { slots: [], unavailable_reason: 'unknown' };
	}

	reasonLabel(reason) {
		const map = {
			blocked: 'Unavailable',
			out_of_range: 'Too far ahead',
			no_hours: 'No hours',
			no_slots: 'Fully booked',
			unknown: 'Unavailable',
		};
		return map[reason] || 'Unavailable';
	}

	paintDateStrip() {
		const strip = this.element.querySelector('[data-bk-dates]');
		if (!strip) return;
		const fragment = document.createDocumentFragment();
		for (let i = 0; i < 14; i++) {
			const d = new Date();
			d.setDate(d.getDate() + i);
			const iso = d.toISOString().slice(0, 10);
			const result = this.slotCache[iso] || { slots: [], unavailable_reason: 'unknown' };
			const count = result.slots ? result.slots.length : 0;
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'bk-day' + (i === 0 ? ' is-today' : '');
			btn.dataset.bkDate = iso;
			btn.disabled = count === 0;
			const dayNum = d.toLocaleDateString(undefined, { weekday: 'narrow' });
			const dayDate = d.getDate();
			const month = d.toLocaleDateString(undefined, { month: 'short' });
			let label;
			if (count > 0) {
				label = count + (count === 1 ? ' slot' : ' slots');
			} else {
				const reason = result.unavailable_reason || 'no_slots';
				label = this.reasonLabel(reason);
				btn.title = i === 0 ? 'Today — ' + label : label + ' (' + reason + ')';
				btn.dataset.reason = reason;
			}
			btn.innerHTML = '<span class="bk-day-dow">' + esc(dayNum) + '</span>'
				+ '<span class="bk-day-num">' + esc(String(dayDate)) + '</span>'
				+ '<span class="bk-day-meta">' + esc(month) + ' · ' + esc(label) + '</span>';
			fragment.appendChild(btn);
		}
		strip.innerHTML = '';
		strip.appendChild(fragment);
		// Keep the current date selected when the strip re-renders.
		if (this.selection.date) {
			const current = strip.querySelector('[data-bk-date="' + this.selection.date + '"]');
			if (current && !current.disabled) {
				this.selectDate(this.selection.date, current);
			} else {
				this.selection.date = null;
				this.selection.slot = null;
			}
		}
	}

	selectDate(date, button) {
		this.selection.date = date;
		this.selection.slot = null;
		const strip = this.element.querySelector('[data-bk-dates]');
		if (strip) {
			strip.querySelectorAll('.bk-day').forEach(b => b.classList.toggle('is-selected', b === button));
		}
		this.clearError('time');
		this.renderSlots();
	}

	renderSlots() {
		const container = this.element.querySelector('[data-bk-slots]');
		if (!container) return;
		const result = this.slotCache[this.selection.date] || { slots: [] };
		if (!result.slots || !result.slots.length) {
			container.innerHTML = '<p class="widget-empty">No bookable times that day — pick another date.</p>';
			return;
		}
		const label = new Date(this.selection.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
		const wrap = document.createElement('div');
		wrap.className = 'bk-slot-wrap';
		const head = document.createElement('p');
		head.className = 'bk-slots-label';
		head.textContent = label + ' — pick a start time';
		wrap.appendChild(head);
		const grid = document.createElement('div');
		grid.className = 'bk-slot-grid';
		result.slots.forEach(slot => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'btn btn-ghost bk-slot';
			btn.dataset.bkSlot = slot.start;
			btn.dataset.startUtc = slot.start_utc || '';
			btn.dataset.end = slot.end || '';
			btn.innerHTML = esc(fmt12(slot.start)) + ' – ' + esc(fmt12(slot.end));
			grid.appendChild(btn);
		});
		wrap.appendChild(grid);
		container.innerHTML = '';
		container.appendChild(wrap);
	}

	selectSlot(button) {
		this.selection.slot = {
			start: button.dataset.bkSlot,
			end: button.dataset.end,
			start_utc: button.dataset.startUtc,
		};
		this.element.querySelectorAll('.bk-slot').forEach(b => b.classList.toggle('is-selected', b === button));
		this.clearError('time');
	}

	/* ── Step 5: review + submit ─────────────────────────────────────── */

	renderReview() {
		if (this.step !== 5) return;
		const sel = this.selection;
		const service = this.data.services.find(s => +s.id === +sel.service);
		const locationInput = this.element.querySelector('[data-bk-location]');
		const set = (key, value) => {
			const dd = this.element.querySelector('[data-bk-review="' + key + '"]');
			if (dd) dd.textContent = value;
		};
		set('student', this.studentLabel(sel.student));
		set('service', service ? service.title + ' · ' + service.duration + ' min' : '—');
		set('coach', this.coachLabel());
		set('date', sel.date ? new Date(sel.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : '—');
		set('time', sel.slot ? fmt12(sel.slot.start) + ' – ' + fmt12(sel.slot.end) : '—');
		set('duration', service ? service.duration + ' minutes' : '—');
		set('mode', sel.mode === 'video' ? 'Live video' : 'In-home');
		set('location', sel.mode === 'video'
			? 'Video link to follow'
			: ((locationInput && locationInput.value.trim()) || 'Your home — add a room below'));

		const locationField = this.element.querySelector('[data-bk-location-field]');
		const videoNote = this.element.querySelector('[data-bk-video-note]');
		if (locationField) locationField.hidden = sel.mode === 'video';
		if (videoNote) videoNote.hidden = sel.mode !== 'video';
	}

	coachLabel() {
		const card = this.element.querySelector('[data-bk-coach="' + this.selection.coach + '"]');
		return card ? (card.dataset.bkCoachName || 'Coach') : '—';
	}

	async submitBooking() {
		if (this.readonly || this.submitting) return;
		if (!this.validateStep()) return;

		const next = this.element.querySelector('[data-bk-next]');
		const sel = this.selection;
		const notes = this.element.querySelector('[data-bk-notes]');
		const locationInput = this.element.querySelector('[data-bk-location]');
		this.submitting = true;
		if (next) {
			next.disabled = true;
			next.innerHTML = '<span class="spin" aria-hidden="true"></span> Booking…';
		}

		try {
			const payload = await window.dapPortal.api('booking', {
				method: 'POST',
				body: {
					student_id: sel.student,
					service_id: sel.service,
					coach_id: sel.coach,
					date: sel.date,
					start: sel.slot ? sel.slot.start : '',
					start_utc: sel.slot ? sel.slot.start_utc : '',
					mode: sel.mode,
					location: sel.mode === 'video' ? '' : (locationInput ? locationInput.value.trim() : ''),
					family_notes: notes ? notes.value.trim() : '',
				},
			});
			this.renderConfirmation(payload);
			this.step = 6;
			this.showStep();
			if (window.dap) {
				window.dap.toast('Session booked — ' + (payload.confirmation ? payload.confirmation.date_label : ''), 'ok');
				window.dap.announce('Session booked.');
			}
		} catch (error) {
			const code = error.code || '';
			// Slot taken / conflict / buffer: jump back to the time step and
			// refresh that day's slots (Part 7, Step 4).
			if (code.indexOf('dolphin_booking_') === 0 && ['conflict', 'buffer', 'too_soon', 'no_hours', 'blocked', 'out_of_range', 'locked'].indexOf(code.replace('dolphin_booking_', '')) > -1) {
				this.showError('confirm', error.message);
				if (window.dap) window.dap.toast(error.message, 'err');
				this.step = 4;
				this.datesLoaded = false;
				this.slotCache = {};
				this.showStep();
				await this.enterTimeStep();
			} else {
				this.showError('confirm', error.message);
				if (window.dap) window.dap.toast(error.message, 'err');
			}
		} finally {
			this.submitting = false;
			if (next) {
				next.disabled = false;
				next.innerHTML = 'Book session <span class="arr" aria-hidden="true">→</span>';
			}
		}
	}

	renderConfirmation(payload) {
		const confirm = payload.confirmation || {};
		const set = (key, value) => {
			const dd = this.element.querySelector('[data-bk-confirm="' + key + '"]');
			if (dd) dd.textContent = value;
		};
		set('student', confirm.student_name || '');
		set('service', confirm.service_title || '');
		set('coach', confirm.coach_name || '');
		set('when', (confirm.date_label || '') + ' · ' + (confirm.time_label || ''));
		set('mode', confirm.mode_label || '');
		set('location', confirm.location || 'Video link to follow');

		const ics = this.element.querySelector('[data-bk-ics]');
		if (ics && payload.ics_url) ics.href = payload.ics_url;
		const google = this.element.querySelector('[data-bk-google]');
		if (google && confirm.google_url) google.href = confirm.google_url;
		const outlook = this.element.querySelector('[data-bk-outlook]');
		if (outlook && confirm.outlook_url) outlook.href = confirm.outlook_url;
	}

	/* ── Add a student (inline form) ─────────────────────────────────── */

	async submitStudent(event) {
		event.preventDefault();
		const form = event.target;
		const nameInput = form.querySelector('[name="name"]');
		const gradeSelect = form.querySelector('[name="grade"]');
		const name = nameInput.value.trim();
		const grade = gradeSelect.value;
		const field = nameInput.closest('.field');
		const err = field.querySelector('.ferr');
		field.classList.remove('invalid');
		if (err) err.textContent = '';

		if (name.length < 2) {
			field.classList.add('invalid');
			if (err) err.textContent = 'Enter the student’s full name.';
			return;
		}
		if (!grade) {
			field.classList.add('invalid');
			if (err) err.textContent = 'Choose a grade.';
			return;
		}

		const btn = form.querySelector('button[type="submit"]');
		const label = btn.querySelector('.btn-label');
		const spin = btn.querySelector('.spin');
		btn.disabled = true;
		if (label) label.textContent = 'Adding…';
		if (spin) spin.hidden = false;

		try {
			const payload = await window.dapPortal.api('students', {
				method: 'POST',
				body: { name, grade },
			});
			const student = payload.student;
			this.data.students.push(student);
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'bk-card';
			card.dataset.bkStudent = student.id;
			card.dataset.gradeIndex = student.grade_index;
			card.innerHTML = '<span class="bk-ic" aria-hidden="true">' + esc(student.initials) + '</span>'
				+ '<span class="bk-card-copy"><b>' + esc(student.name) + '</b>'
				+ '<span>' + esc(student.grade) + '</span></span>';
			const list = this.element.querySelector('[data-bk-students]');
			list.appendChild(card);
			form.reset();
			form.hidden = true;
			this.selectStudent(+student.id, card);
			if (window.dap) window.dap.toast(student.name + ' added to your account.', 'ok');
			// The switcher re-renders via the dashboard refresh.
			if (window.dapPortal && window.dapPortal.refreshDashboard) window.dapPortal.refreshDashboard();
		} catch (error) {
			field.classList.add('invalid');
			if (err) err.textContent = error.message;
			if (window.dap) window.dap.toast(error.message, 'err');
		} finally {
			btn.disabled = false;
			if (label) label.textContent = 'Add student';
			if (spin) spin.hidden = true;
		}
	}

	/* ── Validation + errors ─────────────────────────────────────────── */

	validateStep() {
		if (this.step === 1) {
			if (!this.selection.student) {
				this.showError('student', 'Choose a student for this session.');
				return false;
			}
		}
		if (this.step === 2) {
			const select = this.element.querySelector('[data-bk-service]');
			if (!select.value) {
				const field = select.closest('.field');
				field.classList.add('invalid');
				const ferr = field.querySelector('.ferr');
				if (ferr) ferr.textContent = 'Choose a program for this session.';
				return false;
			}
			this.selection.service = +select.value;
		}
		if (this.step === 3) {
			if (!this.selection.coach) {
				this.showError('coach', 'Choose a coach for this session.');
				return false;
			}
		}
		if (this.step === 4) {
			if (!this.selection.date || !this.selection.slot) {
				this.showError('time', 'Pick a date and a start time.');
				return false;
			}
		}
		return true;
	}

	showError(key, message) {
		const err = this.element.querySelector('[data-bk-error="' + key + '"]');
		if (err) err.textContent = message;
	}

	clearError(key) {
		const err = this.element.querySelector('[data-bk-error="' + key + '"]');
		if (err) err.textContent = '';
	}

	clearAllErrors() {
		this.element.querySelectorAll('[data-bk-error]').forEach(err => { err.textContent = ''; });
	}

	/* ── Opening from anywhere: shared bus ───────────────────────────── */

	static boot() {
		const modals = document.querySelectorAll('[data-component="portal-booking-modal"]');
		if (!modals.length) return null;
		const modal = new PortalBookingModal(modals[0]);
		document.addEventListener('click', e => {
			const trigger = e.target.closest('[data-booking-open]');
			if (trigger && !trigger.disabled) {
				modal.open();
			}
		});
		window.dap.on('booking-open', () => modal.open());
		return modal;
	}
}

function fmt12(hhmm) {
	const parts = String(hhmm).split(':');
	let hours = +parts[0];
	const minutes = +parts[1] || 0;
	const suffix = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12 || 12;
	return hours + ':' + String(minutes).padStart(2, '0') + ' ' + suffix;
}

function esc(s) {
	return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
	PortalBookingModal.boot();
});
