# Admin RBAC Role → Permission Matrix (DRAFT — for owner approval)

**Status:** Gate artifact for the RBAC workstream (RBAC-1). Enforcement is NOT implemented; this document is the approval input for shadow-mode rollout (RBAC-2) and later hard enforcement (RBAC-3).
**Scope:** `frontend/app/api/admin/**` — 298 route files, all accounted for (directory counts reconcile to 298; sub-domain rows marked "subset" are non-additive splits of their parent directory).
**Method:** direct code inspection of every guard call site.

## 1. Roles (prisma/schema.prisma:1184)

`SUPER_ADMIN` (SU) · `OPERATIONS_ADMIN` (OP) · `COMPLIANCE_ADMIN` (CO) · `FINANCE_ADMIN` (FI) · `SUPPORT_ADMIN` (SP)

## 2. Current enforcement reality

| Guard | Route files | Semantics |
|---|---|---|
| `getAdminFromRequest` | 224 | Any authenticated admin (MFA + active). **No role check.** |
| `getAdminActor` / `getAdminActorId` | 39 (CRM, ops, search) | **Also no role check** — same privilege as any-admin. |
| `getAdminWithRole(request, roles[])` | 25 | The only real RBAC today. |
| `requireContentCapability` | 3 | Capability→roles map — **the pattern to replicate.** |

**Net: ~263 of 298 route files are effectively any-admin**, including affiliate-commission clawback/mark-paid, dealer termination, impersonation, CRM bulk sends, e-sign void, and buyer hard-delete.

`OPERATIONAL_ROLES` (`lib/auth/admin-api.ts:92`) = all roles except SUPPORT_ADMIN.

### Existing role gates (keep as-is unless noted)
- `OPERATIONAL_ROLES` (14): comms send-email/send-notification, seo/keywords ×2, buyer prequal manual-override/resend-email, inventory/bulk-lane, dealers [id] tier/compliance-flag/reactivate/approve/suspend.
- `[SUPER, FINANCE]` (7): payments deposit & concierge-fee mark-paid/refund/create-intent, referral-milestones pay.
- `[SUPER]` (3): admins create/deactivate, buyer privacy-purge.
- `[SUPER, OPERATIONS]` (1): users/create. `[SUPER, COMPLIANCE, OPERATIONS]` (1): prequal decide. `[SUPER, COMPLIANCE]` (1): prequal run-ipredict.
- Content capabilities (3 files): view = all roles; generate/manage = [SUPER, OPS]; override_validation = [SUPER, COMPLIANCE]; delete = [SUPER].

## 3. Draft matrix

Legend: **A**llow · **D**eny · ⚠️ needs-owner-decision. "Guard today" = current state. R/M = read/mutating handlers present.

### Finance (highest priority)
| Domain | Files | R/M | Examples | Guard today | SU | OP | CO | FI | SP |
|---|---|---|---|---|---|---|---|---|---|
| finance.payments (`payments/`) | 10 | R+M | deposit/concierge-fee create-intent, mark-paid; commissions (GET) | mutations SUPER+FI ✓; **GETs any-admin** ⚠️ | A | ⚠️ | D | A | D ⚠️read |
| finance.refunds (subset) | 2 | M | deposit/[id]/refund, concierge-fee/[dealId]/refund | SUPER+FI ✓ | A | D | D | A | D |
| finance.commissions (`affiliates/commissions/*`) | 6 | M | approve, mark-paid, reject, **clawback, reverse** | **any-admin** ⚠️ | A | D ⚠️ | D | A | D |
| finance.referrals (`referral-milestones/`) | 2 | R+M | [id]/pay (SUPER+FI ✓), list (any-admin) | mixed | A | D | D | A | D ⚠️read |
| finance.reports (`reports/`) | 5 | R | financial-summary, funnel, pipeline, risk, affiliate | any-admin | A | A | A | A | ⚠️ |

### Buyers (45 files)
| Domain | Files | R/M | Examples | Guard today | SU | OP | CO | FI | SP |
|---|---|---|---|---|---|---|---|---|---|
| buyers.read | ~9 | R | list, [id] GET, payment-history, journey GET, prequal GET | any-admin | A | A | A | A | A |
| buyers.manage | ~28 | M | suspend/unsuspend, disable, assign, journey/*, plan, launch-auction, archive/restore | **any-admin** ⚠️ | A | A | ⚠️ | D ⚠️ | ⚠️ subset |
| buyers.support | ~2 | M | reset-password, preview-token | any-admin | A | A | D | D | A |
| buyers.compliance | 3 | M | prequal manual-override, resend-email, run-ipredict | role-gated ✓ | A | A ⚠️ | A | partial | D |
| buyers.finance | 1 | M | [id]/deposit/override | **any-admin** ⚠️ | A | D | D | A | D |
| buyers.purge 🔴 | 2 | M | privacy-purge (SUPER ✓); **[id] DELETE (any-admin)** ⚠️ | mixed | A | D | D | D | D |

### Dealers / Deals / Auctions / Requests
| Domain | Files | R/M | Examples | Guard today | SU | OP | CO | FI | SP |
|---|---|---|---|---|---|---|---|---|---|
| dealers.manage (`dealers/`) | 21 | R+M | approve/suspend/tier ✓ role-gated; **terminate 🔴, applications approve/reject, invite (any-admin)** ⚠️ | mixed | A | A | A compl. | ⚠️ | D ⚠️read |
| deals.manage (`deals/`) | 12 | R+M | [id]/action, esign, **esign/void 🔴**, pickup/* | **any-admin** ⚠️ | A | A | ⚠️ | ⚠️read | D ⚠️read |
| auctions.manage (`auctions/`) | 4 | R+M | [id]/action, best-price/run | **any-admin** ⚠️ | A | A | D | D | D ⚠️read |
| requests.manage (`requests/`) | 5 | R+M | [id] PATCH, offer, checkpoints | any-admin ⚠️ | A | A | ⚠️ | D | ⚠️ |
| offers / vehicle-offers / vehicle-requests / insurance-requests | 10 | R+M | submit-offer, send-to-buyer, respond | any-admin ⚠️ | A | A | D | D | D |
| external-preapprovals | 2 | M | approve/reject | any-admin ⚠️ | A | A | A | A | D |
| refinance (`refinance/`) | 2 | R | leads | any-admin | A | A | ⚠️ | A | ⚠️ |

### Compliance
| Domain | Files | R/M | Examples | Guard today | SU | OP | CO | FI | SP |
|---|---|---|---|---|---|---|---|---|---|
| compliance.prequal | 1 | M | [id]/decide | SU+CO+OP ✓ | A | A | A | D | D |
| compliance.ofac | 1 | M | ofac/[prequalId] | any-admin ⚠️ | A | ⚠️ | A | D | D |
| contract-shield | 3 | R+M | rules CRUD (DELETE 🔴) | any-admin ⚠️ | A | ⚠️ | A | D | D |

### CRM (38 files — all `getAdminActor`, ungated today)
| Domain | Files | R/M | Examples | Guard today | SU | OP | CO | FI | SP |
|---|---|---|---|---|---|---|---|---|---|
| crm.read | ~11 | R | contacts GET, conversations, campaigns, segments | actor (any-admin) | A | A | ⚠️ | ⚠️ | A |
| crm.manage | ~22 | M | contacts CRUD (**DELETE 🔴**), automations, templates, conversations reply/escalate | actor ⚠️ | A | A | D | D | ⚠️ subset |
| crm.send 🔴 | ~5 | M | **campaigns/bulk-send**, send-email, send-sms, copilot/approve, import | actor ⚠️ | A | A | D | D | D |

### Social / Content / SEO / Comms
| Domain | Files | R/M | Examples | Guard today | SU | OP | CO | FI | SP |
|---|---|---|---|---|---|---|---|---|---|
| social.manage (`social/`) | 37 | R+M | compose, posts, ab-tests, analytics; buffer DELETE 🔴 | **any-admin** ⚠️ | A | A | D | D | D |
| social.publish 🔴 (subset) | ~4 | M | publish, **publish-all**, bulk-create | any-admin ⚠️ | A | A | D | D | D |
| content.* (`content/`) | 9 | R+M | 3 capability-gated ✓, 6 any-admin ⚠️ | mixed | A | A | ⚠️ override | D | D ⚠️view |
| seo (`seo/`) | 2 | R+M | keywords CRUD (DELETE 🔴) | OPERATIONAL_ROLES ✓ | A | A | A | A | D |
| comms.send 🔴 (`comms/`) | 2 | M | send-email, send-notification | OPERATIONAL_ROLES ✓ | A | A | A | A | D |
| testimonials / faith | 6 | R+M | CRUD | any-admin ⚠️ | A | A | D | D | D |

### Outreach / Inventory / Intelligence
| Domain | Files | R/M | Examples | Guard today | SU | OP | CO | FI | SP |
|---|---|---|---|---|---|---|---|---|---|
| dealer-outreach | 14 | R+M | send, **send-batch 🔴**, run-followups | **any-admin** ⚠️ | A | A | D | D | D |
| inventory.manage | 14 | R+M | bulk-upload, [id] DELETE 🔴, markets DELETE 🔴; bulk-lane ✓ | mostly any-admin ⚠️ | A | A | D | D | D ⚠️read |
| amips | 5 | R+M | executive-summary, compute-market-scores | any-admin ⚠️ | A | A | A | A | ⚠️ |
| analytics / best-price | 2 | R+M | analytics (R), weights PATCH | any-admin ⚠️weights | A | A | A read | A read | ⚠️ |

### System / Security / Support / Ops
| Domain | Files | R/M | Examples | Guard today | SU | OP | CO | FI | SP |
|---|---|---|---|---|---|---|---|---|---|
| system.admins 🔴 (`admins/`, `users/`) | 3 | M | create/deactivate admin (SUPER ✓), users/create (SU+OP ✓) | role-gated ✓ | A | ⚠️users | D | D | D |
| support.impersonation 🔴 (`support/`) | 2 | M | **impersonate, end** | **any-admin** ⚠️ | A | ⚠️ | D | D | A ⚠️ |
| security.mfa | 1 | R+M | mfa self-service | any-admin | A | A | A | A | A self |
| auth.session (`auth/`) | 5 | M | signin/signout/MFA — pre-RBAC by design | correct | A | A | A | A | A |
| queues / operations / pickups / messages / ai / search / activity / health | 15 | R+M | queue assign/resolve, dlq retry ⚠️, pickups, threads, ai chat | any-admin ⚠️partial | A | A | ⚠️ | ⚠️ | ⚠️ subset |

## 4. Destructive-endpoint priority list (gate FIRST; bold = ungated today)

1. Refunds (already SUPER+FI ✓ — keep).
2. **Affiliate commission clawback / reverse / mark-paid / approve** — money out, any-admin today.
3. **Buyer hard DELETE** (privacy-purge is SUPER ✓; the plain DELETE is not).
4. **Dealer terminate** (siblings are role-gated — inconsistent).
5. Admin account management (SUPER ✓ — keep).
6. **Impersonation start/end** — full account takeover, any-admin today.
7. **Bulk sends**: crm/campaigns/bulk-send, dealer-outreach/send-batch, social/publish-all, social/posts/bulk-create (comms/* already gated ✓).
8. **E-sign void** — voids legal contracts.
9. **Hard deletes**: inventory item/market, seo keyword, buffer post, crm contact/automation, contract-shield rule.
10. **Deposit override** — waives payment.
11. **DLQ retry / analytics refresh** — replays failed jobs.

## 5. Implementation plan (approved shape: matrix → shadow → enforce)

- **`lib/auth/permissions.ts`**: `PERMISSION_ROLES: Record<Permission, AdminRole[]>` mirroring `CONTENT_CAPABILITY_ROLES`; `requirePermission(request, "domain.action")` = thin wrapper over `getAdminWithRole`. One-line insertion per handler (every route already starts with the guard call).
- **Method-aware**: files exporting GET + mutating handlers call `requirePermission` per method (`.read` vs `.manage`/`.delete`) — the R/M column marks where.
- **Shadow mode (RBAC-2)**: `SHADOW_RBAC` flag — on would-be denial, write `createAuditLog(action: "rbac.shadow_deny", metadata {permission, role, path})` and allow. Zero behavior change. Soak period set by owner; denial report delivered before enforcement.
- **Close the `getAdminActor` gap**: migrate its 39 routes to `requirePermission` — otherwise CRM bulk-send and contact-delete stay ungated after the rollout.
- **Enforce (RBAC-3)**: flip per-domain after the shadow report is reviewed. Destructive list (§4) flips first.

## 6. Decisions needed from owner (the ⚠️ cells)

1. SUPPORT_ADMIN read access: finance reports / deals / payments GETs / analytics — read-all, or deny?
2. OPERATIONS_ADMIN on money endpoints: create-intent / commission approve — allow or FI-only?
3. COMPLIANCE_ADMIN on buyers.manage and deals: full manage, or compliance-actions only?
4. Impersonation: SUPER-only, or SUPER + SUPPORT (it is the support tool)?
5. AI chat/briefing: all roles or operational only?
