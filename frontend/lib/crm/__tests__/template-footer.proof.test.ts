// Proof tests for the email footer-stamping invariant (TemplateService.render).
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/template-footer.proof.test.ts
//
// CAN-SPAM invariant: every rendered email carries a physical mailing address
// AND an unsubscribe link. The footer is appended at render time from
// AUTOLENIS_PHYSICAL_ADDRESS so legal can change the address without a deploy.
//
// Regression guard for the seed defect where 05/08 templates carried a bare
// `<!-- autolenis:footer:v1 -->` marker (08) — which SUPPRESSED the auto-footer,
// shipping welcome emails with no address and no unsubscribe — or a hardcoded
// placeholder address baked into the body (05). After fixing the seeds to omit a
// self-footer, these templates must fall through to the env-driven auto-footer.

import test from "node:test";
import assert from "node:assert/strict";

// Address is read at module load → set it BEFORE the service is first imported.
// Top-level statements run before any test body, so the dynamic import inside
// each test (cached after the first call) sees this value.
const TEST_ADDRESS = "AutoLenis LLC, 500 Test Ave, Austin TX 78701";
process.env.AUTOLENIS_PHYSICAL_ADDRESS = TEST_ADDRESS;

async function loadService() {
  return (await import("../../services/template.service")).TemplateService;
}

const UNSUB = "https://app.autolenis.com/u/abc123";
const MARKER = "<!-- autolenis:footer:v1 -->";

// Mirrors a de-markered welcome/abandonment seed body (no self-footer).
const NO_FOOTER_TEMPLATE = {
  subject: "Your request is waiting, {{firstName}}",
  html_body:
    "<!doctype html><html><body><p>Hi {{firstName}}, finish your request.</p></body></html>",
  text_body: "Hi {{firstName}}, finish your request: {{resumeUrl}}",
};

test("COMPLIANT: a body with no self-footer gets the env-driven footer (html)", async () => {
  const TemplateService = await loadService();
  const r = TemplateService.renderInline(NO_FOOTER_TEMPLATE, {
    firstName: "Sam",
    resumeUrl: "https://x/resume",
    unsubscribeUrl: UNSUB,
  });
  assert.ok(r.html.includes(TEST_ADDRESS), "html must carry the physical address");
  assert.ok(r.html.includes(UNSUB), "html must carry the unsubscribe link");
  assert.ok(r.html.includes(MARKER), "auto-footer stamps the signature marker");
});

test("COMPLIANT: the same body gets address + unsubscribe in the text part", async () => {
  const TemplateService = await loadService();
  const r = TemplateService.renderInline(NO_FOOTER_TEMPLATE, {
    firstName: "Sam",
    unsubscribeUrl: UNSUB,
  });
  assert.ok(r.text.includes(TEST_ADDRESS), "text must carry the physical address");
  assert.ok(r.text.includes(`Unsubscribe: ${UNSUB}`), "text must carry the unsubscribe line");
});

test("NO DOUBLE FOOTER: a body that already ships its own footer is not re-stamped", async () => {
  const TemplateService = await loadService();
  const withOwnFooter = {
    subject: "x",
    html_body: `<body><p>hi</p><div ${MARKER}>AutoLenis · somewhere<a href="{{unsubscribeUrl}}">Unsubscribe</a></div></body>`,
    text_body: `hi\n—\nAutoLenis · somewhere\nUnsubscribe: ${UNSUB}`,
  };
  const r = TemplateService.renderInline(withOwnFooter, { unsubscribeUrl: UNSUB });
  const markerCount = r.html.split(MARKER).length - 1;
  assert.equal(markerCount, 1, "must not append a second footer when one exists");
});
