# Scripts — AutoLenis Admin Operational Tools

Scripts in this directory are **run locally** against the database. They are never deployed as HTTP routes, never callable from application code, and are excluded from the Next.js build by `tsconfig.json`'s `exclude` configuration.

---

## `reset-admin-mfa.ts` — Admin MFA Total Lockout Recovery

### When to run

Run this script when an admin is in **total MFA lockout**:

- The authenticator device is **gone** (lost, stolen, or wiped), AND
- All backup recovery codes have been **consumed**

The admin's email and password are unchanged and functional — the only problem is the missing second factor.

Self-service recovery from inside the app is impossible in this situation because there is no second factor available to pass the existing MFA gates.

### How to run

```bash
# From the frontend/ directory:
pnpm tsx scripts/reset-admin-mfa.ts --email admin@autolenis.com
```

The script will:
1. Look up the admin by email and display their current MFA state
2. **Ask for `y` confirmation on stdin** before making any changes
3. Apply the reset inside a database transaction
4. Print next steps

### What it changes

| Field | Before | After |
|---|---|---|
| `totpSecret` | encrypted secret | `null` |
| `totpEnabled` | `true` | `false` |
| `recoveryCodes` | hashed codes array | `[]` |
| `mfaVerifiedAt` | timestamp | `null` |
| `failedMfaAttempts` | ≥ 0 | `0` |
| `mfaLockedUntil` | timestamp or null | `null` |
| `lastRecoveryCodeUsedAt` | timestamp or null | `null` |
| `mfaResetAt` | any | `now()` |
| Pending MFA email tokens | unused | invalidated |
| AdminAuditLog | — | `ADMIN_MFA_RESET_VIA_SCRIPT` entry |

### What it does NOT change

- `passwordHash` — password is preserved exactly
- `role` — admin role and permissions are unchanged
- `userId` / `email` — account identity is unchanged
- Any other admin or user fields
- Other admin accounts

### Why a script, not a route

An HTTP endpoint for MFA reset would create a permanent attack surface: any attacker who obtains the admin password could use it to bind their own authenticator and take over the account.

A script has no network exposure. It requires:
- **Physical or SSH access** to a machine with database credentials
- **Interactive confirmation** before any change is committed

This is the security boundary that makes the operation safe.

### After running

The admin signs in at `/admin/auth/signin` with their unchanged password. Because `totpEnabled` is now `false`, the sign-in flow redirects to `/admin/auth/setup-mfa` rather than the TOTP challenge.

The setup flow requires a **one-time email confirmation** before revealing the QR code, ensuring the admin who enrolls the new authenticator controls the on-record email address.
