# Make.com Scenario Blueprints

Exported blueprints for the AutoLenis CRM automation scenarios running in Make
(team `2374031`). These files are the source-of-truth backups of what is
deployed; the live scenarios are managed in the Make UI/API.

| File | Scenario ID | Schedule | Purpose |
|---|---|---|---|
| `nurture-processor-keeper.blueprint.json` | 5410176 | every 15 min | Processes due nurture records, dispatches marketing email, advances/completes the record |
| `reconciliation-daily-nllb-sweep.blueprint.json` | 5412069 | daily | Runs the CRM reconciliation sweep |

## Fix recorded here: `BundleValidationError`

Both scenarios were failing every run with
`BundleValidationError: "Validation failed for 1 parameter(s)."` because their
modules were missing required schema fields. The fix added the missing fields
(no behavioral change to URLs, payloads, filters, or routing):

- **HTTP modules** (`http:ActionSendData`): added `serializeUrl`, `shareCookies`,
  `rejectUnauthorized`, `followRedirect`, `followAllRedirects`, `useQuerystring`,
  `gzip`, `useMtls`.
- **`datastore:GetRecord`**: added `returnWrapped`.
- **`datastore:UpdateRecord`**: added `upsert`, `overwriteArrays`.

Verified: the first scheduled run after the fix completed with status `success`,
where all prior runs returned `BundleValidationError`.

## ⚠️ Secrets

The `x-dispatch-key` / `X-Dispatch-Key` header values in these files are
**placeholders** (`__REPLACE_WITH_CRM_DISPATCH_KEY__` /
`REPLACE_WITH_CRM_DISPATCH_KEY`). The real CRM dispatch key must be injected in
the Make UI and is intentionally **not** stored in this repository. Until the
real key is set, the dispatch endpoint returns `401`, which (with
`handleErrors: false`) is swallowed as success and will advance nurture records
without sending email.
