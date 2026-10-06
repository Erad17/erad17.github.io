/* Intake Wizard (shared) — RETIRED.
   The prototype wizard (client-side SERVICES / COVERAGE_AREAS / CONCERNS mock
   arrays, innerHTML step rendering, simulated submission) was replaced by the
   portal intake wizard: views/components/portal/intake-wizard.twig + .js,
   with programs populated from the dolphinv2_service CPT and AJAX submission
   to POST /wp-json/dolphin/v1/intake. This stub only prevents the old mock
   implementation from being enqueued (it bound to the legacy #wizBody /
   [data-component="intake-wizard"] markup, which no longer renders).
   The shared intake-wizard.css stays — the portal wizard reuses its
   .overlay/.wiz-* classes. Safe to delete this file. */
