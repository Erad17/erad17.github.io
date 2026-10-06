/* Portal Shared (portal page) — dashboard data fetching + interactions.
   Loaded on views/pages/portal.twig (enqueued by the Dolphin Portal plugin
   with the window.dolphinPortal boot config: REST url, nonce, role, flags).

   Responsibilities:
   • window.dapPortal.api() — REST wrapper (X-WP-Nonce, JSON, error
     surfacing; errors carry .status/.code/.payload for field-level maps)
   • refreshDashboard() — GET /dolphin/v1/dashboard (with the persisted
     ?student_id= filter) and swap the server-rendered widget fragments
     ([data-portal-widget], all instances — including the student
     switcher, key "students"); the Twig partials stay the single source
     of markup.
   • Student switcher (Part 11) — [data-student-switcher] segments
     re-request the dashboard filtered by student; the selection
     persists in sessionStorage.
   • Dashboard shell nav ([data-dash-nav] → [data-dash-section]).
   • Admin session/form tables: the filter bars and status chips filter
     the server-rendered rows client-side ([data-portal-filter]) — the
     forms never submit, no page reload.
   • Delegated portal actions: file upload (XHR + progress), eSignature,
     notifications mark-read / dismiss, coach session notes and the
     availability editor (weekly blocks + blocked dates + 7-day preview
     with field-level save errors). All writes are REST calls; spoof
     (read-only) mode is enforced server-side and mirrored here.
   • Booking: the 5-step modal lives in
     views/components/portal/booking-modal.js (opened via
     [data-booking-open] triggers / the dap:booking-open bus event);
     this file only forwards the legacy [data-booking-open-bus] triggers.
   Depends on shared.js for the window.dap event bus / toast / announce /
   trapFocus. */

(function () {
	'use strict';

	const config = window.dolphinPortal || {};
	const page = document.querySelector('[data-portal-page]');

	/* ═══════════════ REST helper ═══════════════ */

	async function api(path, options) {
		options = options || {};
		const init = {
			method: options.method || 'GET',
			headers: { 'X-WP-Nonce': config.nonce || '' },
			credentials: 'same-origin',
		};
		if (options.body !== undefined) {
			init.headers['Content-Type'] = 'application/json';
			init.body = JSON.stringify(options.body);
		}

		let response;
		try {
			response = await fetch(config.restUrl + path, init);
		} catch (networkError) {
			throw new Error('Network error — check your connection and try again.');
		}

		let payload = null;
		try { payload = await response.json(); } catch (parseError) { /* empty body */ }

		if (!response.ok) {
			const message = payload && payload.message ? payload.message : 'Request failed (' + response.status + ').';
			const error = new Error(message);
			error.status = response.status;
			error.code = payload ? payload.code : '';
			error.payload = payload; // Full body — e.g. availability field errors.
			throw error;
		}
		return payload;
	}

	/* ═══════════════ Dashboard refresh ═══════════════ */

	function refreshWidgets(htmlMap) {
		Object.keys(htmlMap || {}).forEach(key => {
			document.querySelectorAll('[data-portal-widget="' + key + '"]').forEach(widget => {
				const template = document.createElement('template');
				template.innerHTML = htmlMap[key].trim();
				const next = template.content.firstElementChild;
				if (next) widget.replaceWith(next);
			});
		});
		if (window.dap && window.dap.initReveals) window.dap.initReveals(document);
		updateUnreadBadge();
	}

	function updateUnreadBadge() {
		const unread = document.querySelectorAll('.notif.is-unread').length;
		let badge = document.querySelector('[data-unread-count]');
		if (!badge && unread) {
			badge = document.createElement('b');
			badge.className = 'dashd-badge';
			badge.setAttribute('data-unread-count', '');
			const link = document.querySelector('[data-dash-nav="notifications"] span');
			if (link && link.parentElement) link.parentElement.appendChild(badge);
		}
		if (badge) {
			badge.textContent = unread;
			if (!unread) badge.remove();
		}
	}

	let refreshing = false;

	async function refreshDashboard(announce) {
		if (!config.loggedIn || refreshing) return;
		refreshing = true;
		try {
			const studentId = currentStudentFilter();
			const path = studentId ? 'dashboard?student_id=' + encodeURIComponent(studentId) : 'dashboard';
			const data = await api(path);
			if (data && data.html) {
				refreshWidgets(data.html);
				if (announce) window.dap.announce('Dashboard updated');
			}
		} catch (error) {
			/* Silent on background refreshes; toasts surface user actions. */
		} finally {
			refreshing = false;
		}
	}

	/* ═══════════════ Family: student switcher (Part 11) ═══════════════ */

	const STUDENT_KEY = 'dolphinPortalStudent';

	function currentStudentFilter() {
		try {
			return sessionStorage.getItem(STUDENT_KEY) || '';
		} catch (storageError) {
			return '';
		}
	}

	function setStudentFilter(id) {
		try {
			sessionStorage.setItem(STUDENT_KEY, String(id || ''));
		} catch (storageError) { /* private mode — selection just won't persist */ }
	}

	function paintSwitcher(switcher, id) {
		switcher.querySelectorAll('[data-student-id]').forEach(btn => {
			const matches = String(btn.dataset.studentId) === String(id);
			btn.classList.toggle('is-active', matches);
			btn.setAttribute('aria-pressed', String(matches));
		});
	}

	function applyStudentFilter(id, focus) {
		setStudentFilter(id);
		const switcher = document.querySelector('[data-student-switcher]');
		if (switcher) paintSwitcher(switcher, id);
		refreshing = true; // Guard against the boot call racing a click.
		api('dashboard' + (id ? '?student_id=' + encodeURIComponent(id) : ''))
			.then(data => {
				if (data && data.html) {
					refreshWidgets(data.html);
					if (focus) window.dap.announce('Dashboard filtered by student');
				}
			})
			.catch(() => { /* background fetch */ })
			.finally(() => { refreshing = false; });
	}

	function initStudentSwitcher() {
		document.addEventListener('click', e => {
			const seg = e.target.closest('[data-student-switcher] [data-student-id]');
			if (!seg || seg.disabled) return;
			applyStudentFilter(seg.dataset.studentId, true);
		});

		// Restore the persisted selection on load (the server renders
		// "All students"; sessionStorage refines it without a reload).
		const saved = currentStudentFilter();
		if (saved && saved !== '0') {
			const switcher = document.querySelector('[data-student-switcher]');
			if (switcher && switcher.querySelector('[data-student-id="' + saved + '"]')) {
				applyStudentFilter(saved, false);
			}
		}
	}

	/* ═══════════════ Dashboard shell navigation ═══════════════ */

	function activateSection(root, id) {
		root.querySelectorAll('[data-dash-section]').forEach(section => {
			section.hidden = section.dataset.dashSection !== id;
		});
		root.querySelectorAll('[data-dash-nav]').forEach(link => {
			if (link.dataset.dashNav === id) link.setAttribute('aria-current', 'true');
			else link.removeAttribute('aria-current');
		});
	}

	function initShellNav() {
		document.querySelectorAll('[data-dashd]').forEach(root => {
			const target = root.dataset.dashDefault || 'overview';
			activateSection(root, target);

			root.querySelectorAll('[data-dash-nav]').forEach(link => {
				link.addEventListener('click', () => activateSection(root, link.dataset.dashNav));
			});
		});
	}

	// Delegated so buttons inside refreshed widget HTML keep working.
	document.addEventListener('click', e => {
		const trigger = e.target.closest('[data-wizard-open]');
		if (trigger && !trigger.disabled) {
			// CROSS-COMPONENT: the portal intake wizard opens on dap:wizard-open.
			window.dap.emit('wizard-open');
		}
	});

	/* ═══════════════ Documents: upload with progress (XHR) ═══════════════ */

	function uploadDocument(file, widget) {
		const bar = widget.querySelector('[data-portal-progress]');
		const fill = widget.querySelector('[data-portal-progress-fill]');
		if (!bar || !fill) return;

		bar.hidden = false;
		fill.style.width = '0%';

		const form = new FormData();
		form.append('file', file, file.name);

		const xhr = new XMLHttpRequest();
		xhr.open('POST', config.restUrl + 'documents');
		xhr.setRequestHeader('X-WP-Nonce', config.nonce || '');
		xhr.upload.addEventListener('progress', e => {
			if (e.lengthComputable) fill.style.width = Math.round((e.loaded / e.total) * 100) + '%';
		});
		xhr.addEventListener('load', () => {
			bar.hidden = true;
			fill.style.width = '0%';
			let payload = null;
			try { payload = JSON.parse(xhr.responseText); } catch (parseError) { /* noop */ }
			if (xhr.status >= 200 && xhr.status < 300 && payload && payload.ok) {
				window.dap.toast('“' + file.name + '” uploaded to your encrypted vault.', 'ok');
				window.dap.emit('doc-uploaded', { name: file.name });
				refreshDashboard();
			} else {
				window.dap.toast(payload && payload.message ? payload.message : 'The upload failed — please try again.', 'err');
			}
		});
		xhr.addEventListener('error', () => {
			bar.hidden = true;
			fill.style.width = '0%';
			window.dap.toast('The upload failed — check your connection and try again.', 'err');
		});
		xhr.send(form);
	}

	function initUploads() {
		if (config.readonly) return;
		document.addEventListener('click', e => {
			const btn = e.target.closest('[data-portal-upload]');
			if (!btn) return;
			const widget = btn.closest('[data-portal-widget]');
			const input = widget && widget.querySelector('[data-portal-file-input]');
			if (input) input.click();
		});
		document.addEventListener('change', e => {
			if (!e.target.matches('[data-portal-file-input]')) return;
			const file = e.target.files && e.target.files[0];
			if (!file) return;
			const widget = e.target.closest('[data-portal-widget]');
			uploadDocument(file, widget);
			e.target.value = '';
		});
	}

	/* ═══════════════ Forms: inline eSignature ═══════════════ */

	function initSigning() {
		if (config.readonly) return;
		document.addEventListener('click', e => {
			const sign = e.target.closest('[data-portal-sign]');
			if (sign) {
				const row = sign.closest('[data-form-row]');
				const inline = row && row.querySelector('.sign-inline');
				if (inline) {
					inline.hidden = false;
					const nameInput = inline.querySelector('[data-sign-name]');
					if (nameInput) nameInput.focus();
					sign.hidden = true;
				}
				return;
			}
			const confirm = e.target.closest('[data-portal-sign-confirm]');
			if (!confirm) return;
			const row = confirm.closest('[data-form-row]');
			const nameInput = row && row.querySelector('[data-sign-name]');
			const typed = nameInput ? nameInput.value.trim() : '';
			if (typed.length < 3) {
				window.dap.toast('Type your full legal name to sign.', 'err');
				if (nameInput) nameInput.focus();
				return;
			}
			confirm.disabled = true;
			api('sign', { method: 'POST', body: { form_id: +confirm.dataset.formId, signature_data: typed } })
				.then(() => {
					window.dap.toast('Signed and delivered to admissions.', 'ok');
					return refreshDashboard();
				})
				.catch(error => window.dap.toast(error.message, 'err'))
				.finally(() => { confirm.disabled = false; });
		});
	}

	/* ═══════════════ Notifications: mark read + dismiss ═══════════════ */

	function dismissNotification(btn) {
		const row = btn.closest('.notif[data-notif-id]');
		if (!row || row.classList.contains('is-dismissing')) return;
		const id = row.dataset.notifId;
		const matches = document.querySelectorAll('.notif[data-notif-id="' + id + '"]');
		matches.forEach(r => r.classList.add('is-dismissing'));
		api('notifications-dismiss', { method: 'POST', body: { notification_id: +id } })
			.then(() => {
				setTimeout(() => {
					matches.forEach(r => r.remove());
					updateUnreadBadge();
					document.querySelectorAll('.notif-list').forEach(list => {
						if (list.isConnected && !list.querySelector('.notif')) {
							const empty = document.createElement('p');
							empty.className = 'widget-empty';
							empty.textContent = 'All caught up — no notifications left.';
							list.appendChild(empty);
						}
					});
				}, 350);
			})
			.catch(error => {
				matches.forEach(r => r.classList.remove('is-dismissing'));
				window.dap.toast(error.message, 'err');
			});
	}

	function initNotifications() {
		if (config.readonly) return;
		document.addEventListener('click', e => {
			const dismiss = e.target.closest('[data-portal-notif-dismiss]');
			if (dismiss) {
				dismissNotification(dismiss);
				return;
			}
			const markAll = e.target.closest('[data-portal-notifs-read]');
			if (markAll) {
				api('notifications-read', { method: 'POST', body: {} })
					.then(() => refreshDashboard())
					.catch(error => window.dap.toast(error.message, 'err'));
				return;
			}
			const row = e.target.closest('.notif.is-unread[data-notif-id]');
			if (row) {
				api('notifications-read', { method: 'POST', body: { notification_id: +row.dataset.notifId } })
					.then(() => refreshDashboard())
					.catch(error => window.dap.toast(error.message, 'err'));
			}
		});
	}

	/* ═══════════════ Family: booking modal trigger ═══════════════ */

	/* The booking modal (views/components/portal/booking-modal.js) owns
	   the full 5-step flow; this file only emits the shared bus event the
	   header/other components may use. [data-booking-open] triggers are
	   handled by booking-modal.js itself. */
	function initBooking() {
		document.addEventListener('click', e => {
			const trigger = e.target.closest('[data-booking-open-bus]');
			if (trigger && !trigger.disabled) {
				window.dap.emit('booking-open');
			}
		});
	}

	/* ═══════════════ Coach: session notes ═══════════════ */

	function initNotes() {
		if (config.readonly) return;
		document.addEventListener('submit', e => {
			const form = e.target.closest('[data-portal-note-form]');
			if (!form) return;
			e.preventDefault();
			const status = form.querySelector('[data-note-status]');
			const btn = form.querySelector('button[type="submit"]');
			const notes = form.querySelector('[name="notes"]').value;
			btn.disabled = true;
			if (status) status.textContent = 'Saving…';
			api('session-notes', {
				method: 'POST',
				body: { session_id: +form.dataset.sessionId, notes },
			})
				.then(() => {
					if (status) status.textContent = 'Saved ✓';
					window.dap.toast('Session notes saved.');
				})
				.catch(error => {
					if (status) status.textContent = '';
					window.dap.toast(error.message, 'err');
				})
				.finally(() => { btn.disabled = false; });
		});
	}

	/* ═══════════════ Coach: availability (weekly blocks, blocked dates,
	   7-day preview, capacity) — Part 4/5 ═══════════════ */

	const AVAIL_MODE_LABELS = { 'in-person': 'In-home', video: 'Video', either: 'Either' };
	const AVAIL_DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	function initAvailability() {
		const root = document.querySelector('[data-avail-root]');
		if (!root) return;
		const statusEl = root.querySelector('[data-avail-status]');
		const saveBtn = root.querySelector('[data-avail-save]');

		const readBlocks = () => {
			try { return JSON.parse(root.dataset.availBlocks || '[]'); } catch (parseError) { return []; }
		};
		const writeBlocks = blocks => { root.dataset.availBlocks = JSON.stringify(blocks); };
		const readBlocked = () => {
			try { return JSON.parse(root.dataset.availBlocked || '[]'); } catch (parseError) { return []; }
		};
		const writeBlocked = dates => { root.dataset.availBlocked = JSON.stringify(dates); };

		const bdList = () => root.querySelector('[data-avail-bd-list]');

		function render() {
			const blocks = readBlocks();
			root.querySelectorAll('.avail-day').forEach(day => {
				const num = +day.dataset.availDay;
				const list = day.querySelector('.avail-blocks');
				const dayBlocks = blocks
					.map((b, i) => ({ b, i }))
					.filter(x => +x.b.day === num)
					.sort((x, y) => String(x.b.start).localeCompare(String(y.b.start)));
				if (!dayBlocks.length) {
					list.innerHTML = '<p class="avail-empty">No blocks</p>';
					return;
				}
				list.innerHTML = dayBlocks.map(x => {
					const mode = x.b.mode && AVAIL_MODE_LABELS[x.b.mode] ? x.b.mode : 'either';
					return '<div class="avail-block" data-avail-index="' + x.i + '">'
						+ '<span class="avail-times">' + esc(x.b.start) + '–' + esc(x.b.end) + '</span>'
						+ '<span class="pill pill-teal">' + esc(AVAIL_MODE_LABELS[mode]) + '</span>'
						+ (config.readonly ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-avail-remove="' + x.i + '" aria-label="Remove ' + esc(x.b.start) + '–' + esc(x.b.end) + ' block">Remove</button>')
						+ '<span class="ferr avail-err"></span>'
						+ '</div>';
				}).join('');
			});
			renderBlocked();
		}

		function renderBlocked() {
			const list = bdList();
			if (!list) return;
			const dates = readBlocked();
			if (!dates.length) {
				list.innerHTML = '<li class="avail-bd-empty">No blocked dates — working weeks only.</li>';
				return;
			}
			list.innerHTML = dates.map((row, i) =>
				'<li class="avail-bd-row" data-avail-bd-index="' + i + '">'
				+ '<span class="avail-bd-date">' + esc(row.date) + '</span>'
				+ '<span class="avail-bd-reason">' + esc(row.reason || '—') + '</span>'
				+ (config.readonly ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-avail-bd-remove="' + i + '" aria-label="Unblock ' + esc(row.date) + '">Remove</button>')
				+ '<span class="ferr avail-err"></span>'
				+ '</li>'
			).join('');
		}

		function setStatus(message, state) {
			if (!statusEl) return;
			statusEl.textContent = message;
			statusEl.className = 'avail-status' + (state ? ' is-' + state : '');
		}

		function clearFieldErrors() {
			root.querySelectorAll('.avail-err').forEach(err => { err.textContent = ''; });
		}

		/** Paint the field-level error map from POST /availability. */
		function paintFieldErrors(errors) {
			clearFieldErrors();
			const blocks = readBlocks();
			const blockPositions = {};
			blocks.forEach((b, i) => { blockPositions[i] = b; });
			Object.keys(errors || {}).forEach(key => {
				if (key.indexOf('blocks_') === 0) {
					const index = +key.replace('blocks_', '');
					const slot = root.querySelector('[data-avail-remove="' + index + '"]');
					const errEl = slot ? slot.parentElement.querySelector('.avail-err') : null;
					if (errEl) errEl.textContent = errors[key];
				} else if (key.indexOf('blocked_dates_') === 0) {
					const index = +key.replace('blocked_dates_', '');
					const btn = root.querySelector('[data-avail-bd-remove="' + index + '"]');
					const errEl = btn ? btn.parentElement.querySelector('.avail-err') : null;
					if (errEl) errEl.textContent = errors[key];
				} else {
					setStatus(errors[key], 'err');
				}
			});
		}

		function markDirty() {
			if (saveBtn) saveBtn.disabled = false;
			setStatus('Unsaved changes — remember to save.');
			clearFieldErrors();
		}

		function swapPreview(html) {
			const preview = document.querySelector('[data-avail-preview]');
			if (!preview || !html) return;
			const template = document.createElement('template');
			template.innerHTML = html.trim();
			const next = template.content.firstElementChild;
			if (next) preview.replaceWith(next);
			if (window.dap && window.dap.initReveals) window.dap.initReveals(document);
		}

		function saveAvailability() {
			if (saveBtn) saveBtn.disabled = true;
			setStatus('Saving…');
			api('availability', {
				method: 'POST',
				body: { blocks: readBlocks(), blocked_dates: readBlocked() },
			})
				.then(payload => {
					setStatus('Saved ✓ — the preview below is up to date.', 'ok');
					swapPreview(payload.preview_html);
					window.dap.toast('Availability saved.');
				})
				.catch(error => {
					if (saveBtn) saveBtn.disabled = false;
					if (error.status === 400 && error.payload && error.payload.errors) {
						paintFieldErrors(error.payload.errors);
						setStatus('Some entries need fixing — see the highlighted rows.', 'err');
					} else {
						setStatus(error.message, 'err');
					}
				});
		}

		root.addEventListener('submit', e => {
			const addForm = e.target.closest('[data-avail-add]');
			if (addForm) {
				e.preventDefault();
				const day = +addForm.closest('.avail-day').dataset.availDay;
				const start = addForm.querySelector('[name="start"]').value;
				const end = addForm.querySelector('[name="end"]').value;
				const mode = addForm.querySelector('[name="mode"]').value || 'either';
				if (!start || !end || start >= end) {
					setStatus('Choose a valid time window — the end must come after the start.', 'err');
					return;
				}
				const blocks = readBlocks();
				const overlap = blocks.some(b => +b.day === day && start < b.end && b.start < end);
				if (overlap) {
					setStatus('That window overlaps an existing block on ' + AVAIL_DAY_LABELS[day] + ' — combine or adjust the times.', 'err');
					return;
				}
				blocks.push({ day: String(day), start, end, mode });
				writeBlocks(blocks);
				render();
				markDirty();
				addForm.reset();
				addForm.querySelector('[name="mode"]').value = 'either';
				return;
			}

			const bdForm = e.target.closest('[data-avail-bd-add]');
			if (bdForm) {
				e.preventDefault();
				const date = bdForm.querySelector('[name="date"]').value;
				const reason = bdForm.querySelector('[name="reason"]').value.trim();
				if (!date) {
					setStatus('Pick a date to block.', 'err');
					return;
				}
				const dates = readBlocked();
				if (dates.some(row => row.date === date)) {
					setStatus('That date is already blocked.', 'err');
					return;
				}
				dates.push({ date, reason });
				dates.sort((a, b) => String(a.date).localeCompare(String(b.date)));
				writeBlocked(dates);
				renderBlocked();
				markDirty();
				bdForm.reset();
			}
		});

		root.addEventListener('click', e => {
			if (config.readonly) return;
			const remove = e.target.closest('[data-avail-remove]');
			if (remove) {
				const blocks = readBlocks();
				blocks.splice(+remove.dataset.availRemove, 1);
				writeBlocks(blocks);
				render();
				markDirty();
				return;
			}
			const bdRemove = e.target.closest('[data-avail-bd-remove]');
			if (bdRemove) {
				const dates = readBlocked();
				dates.splice(+bdRemove.dataset.availBdRemove, 1);
				writeBlocked(dates);
				renderBlocked();
				markDirty();
				return;
			}
			if (saveBtn && e.target.closest('[data-avail-save]')) saveAvailability();
		});

		render();
	}

	/* ═══════════════ Admin tables: client-side filters ═══════════════ */

	function initClientFilters() {
		document.querySelectorAll('[data-portal-filter]').forEach(form => {
			const section = form.closest('[data-dash-section]');
			const tbody = section ? section.querySelector('.dashd-table tbody') : null;
			if (!section || !tbody) return;

			const selects = Array.from(form.querySelectorAll('select[data-filter-cell]'));
			const statusSelect = form.querySelector('[data-filter-status]');
			const chips = Array.from(section.querySelectorAll('[data-filter-chips] [data-status]'));
			const empty = section.querySelector('[data-filter-empty]');

			const selectedText = sel => (sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent : '');
			const cellText = (row, index) => (row.cells[index] ? row.cells[index].textContent : '');

			function apply() {
				let visible = 0;
				tbody.querySelectorAll('tr').forEach(row => {
					const match = selects.every(sel => {
						if (!sel.value) return true;
						return cellText(row, +sel.dataset.filterCell).toLowerCase().includes(selectedText(sel).toLowerCase());
					});
					row.hidden = !match;
					if (match) visible++;
				});
				if (empty) empty.hidden = visible !== 0;
			}

			function syncChips() {
				const value = statusSelect ? statusSelect.value : '';
				chips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.status === value)));
			}

			selects.forEach(sel => sel.addEventListener('change', () => { syncChips(); apply(); }));

			chips.forEach(chip => chip.addEventListener('click', () => {
				if (statusSelect) statusSelect.value = chip.dataset.status;
				syncChips();
				apply();
			}));

			// The filter form never submits — rows are filtered in place.
			form.addEventListener('submit', e => { e.preventDefault(); apply(); });

			syncChips();
		});
	}

	/* ═══════════════ Rich-text note editors (contenteditable) ═══════════════ */

	function updateRtStates(editor) {
		editor.querySelectorAll('[data-rt-cmd]').forEach(btn => {
			try {
				btn.setAttribute('aria-pressed', String(document.queryCommandState(btn.dataset.rtCmd)));
			} catch (queryError) { /* unsupported command state */ }
		});
	}

	function initRichEditors() {
		const editors = Array.from(document.querySelectorAll('[data-rt-editor]'));
		if (!editors.length) return;

		try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (setupError) { /* noop */ }

		editors.forEach(editor => {
			const area = editor.querySelector('[data-rt-area]');
			const input = editor.querySelector('input[name="notes"]');
			if (!area || !input) return;

			const sync = () => { input.value = area.innerHTML; };
			area.addEventListener('input', sync);

			editor.querySelectorAll('[data-rt-cmd]').forEach(btn => {
				// Prevent the click from stealing the selection from the editor.
				btn.addEventListener('mousedown', e => e.preventDefault());
				btn.addEventListener('click', () => {
					area.focus();
					try { document.execCommand(btn.dataset.rtCmd, false, null); } catch (cmdError) { /* noop */ }
					sync();
					updateRtStates(editor);
				});
			});

			editor.addEventListener('keyup', () => updateRtStates(editor));
			editor.addEventListener('focusin', () => updateRtStates(editor));
			editor.addEventListener('focusout', () => {
				editor.querySelectorAll('[data-rt-cmd]').forEach(btn => btn.setAttribute('aria-pressed', 'false'));
			});
		});

		document.addEventListener('selectionchange', () => {
			const sel = document.getSelection();
			if (!sel || !sel.anchorNode) return;
			let node = sel.anchorNode;
			if (node.nodeType === 3) node = node.parentElement;
			const editor = node && node.closest ? node.closest('[data-rt-editor]') : null;
			if (editor) updateRtStates(editor);
		});
	}

	/* ═══════════════ Coach: session status tabs ═══════════════ */

	function initCoachSessionTabs() {
		const tabsRoot = document.querySelector('[data-sess-tabs]');
		if (!tabsRoot) return;
		const section = tabsRoot.closest('[data-dash-section]');
		const tbody = section ? section.querySelector('.dashd-table tbody') : null;
		if (!tbody) return;

		const rows = Array.from(tbody.querySelectorAll('tr[data-sess-date]'));
		const originalOrder = rows.slice();
		const today = (tabsRoot.dataset.today || '').slice(0, 10);
		const empty = section.querySelector('[data-sess-empty]');
		const badges = {};
		section.querySelectorAll('[data-sess-count]').forEach(badge => { badges[badge.dataset.sessCount] = badge; });

		const matchers = {
			upcoming: row => ['confirmed', 'pending'].indexOf(row.dataset.sessStatus) > -1,
			today: row => (row.dataset.sessDate || '').slice(0, 10) === today,
			completed: row => row.dataset.sessStatus === 'completed',
			all: () => true,
		};

		function apply(tab) {
			const matcher = matchers[tab] || matchers.all;
			let visible = 0;
			rows.forEach(row => {
				const show = matcher(row);
				row.hidden = !show;
				if (show) visible++;
			});
			// Upcoming reads soonest-first; the other tabs keep server order.
			const ordered = tab === 'upcoming'
				? rows.slice().sort((a, b) => String(a.dataset.sessDate).localeCompare(String(b.dataset.sessDate)))
				: originalOrder;
			ordered.forEach(row => tbody.appendChild(row));
			if (empty) empty.hidden = visible !== 0;
		}

		Object.keys(matchers).forEach(tab => {
			if (badges[tab]) badges[tab].textContent = rows.filter(matchers[tab]).length;
		});

		tabsRoot.querySelectorAll('[data-sess-tab]').forEach(tab => {
			tab.addEventListener('click', () => {
				tabsRoot.querySelectorAll('[data-sess-tab]').forEach(t => {
					t.setAttribute('aria-selected', String(t === tab));
				});
				apply(tab.dataset.sessTab);
			});
		});

		apply('upcoming');
	}

	/* ═══════════════ Utilities ═══════════════ */

	function esc(s) {
		return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	/* ═══════════════ Namespace + boot ═══════════════ */

	window.dapPortal = {
		api,
		refreshDashboard,
		refreshWidgets,
		activateSection,
		config,
	};

	if (page) {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', boot);
		} else {
			boot();
		}
	}

	function boot() {
		if (!config.loggedIn) return;
		initShellNav();
		initStudentSwitcher();
		initUploads();
		initSigning();
		initNotifications();
		initBooking();
		initNotes();
		initAvailability();
		initClientFilters();
		initCoachSessionTabs();
		initRichEditors();
		updateUnreadBadge();
	}
})();
