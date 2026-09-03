// Answers "what does the CI DATABASE_URL secret actually point at?" without revealing it.
//
// WHY THIS EXISTS. GitHub never discloses a stored secret's value — not through the API, not in a
// log, not to a workflow author. So "read the secret and tell me" is not an instruction anyone can
// follow. The only party that can see the value is the job it is injected into, and the only safe
// thing that job can emit is a classification. This script is that: it parses the DSN in-process
// and prints four non-secret facts.
//
// It NEVER prints, returns or logs the user, the password, or the connection string. It opens no
// connection — a DSN is classified from its own text, so running this against a production secret
// touches nothing.
//
// Exit code is 0 whatever the classification: this reports, it does not gate. The gate is
// resolveDestructiveTarget() inside the destructive suite itself.

import { classifyDatabaseTarget } from "../lib/testing/isolated-database";

const label = process.argv[2] ?? "DATABASE_URL";
const raw = process.env[label];
const c = classifyDatabaseTarget(raw);

const lines = [
  `database target report — ${label}`,
  `  configured:      ${raw === undefined || raw === "" ? "no" : "yes"}`,
  `  host:            ${c.host ?? "(unresolvable)"}`,
  `  database:        ${c.database ?? "(unresolvable)"}`,
  `  project ref:     ${c.projectRef ?? "(none)"}`,
  `  classification:  ${c.classification}`,
  `  basis:           ${c.detail}`,
];
if (c.classification === "PRODUCTION") {
  lines.push(
    "",
    "  *** This secret resolves to PRODUCTION. No destructive suite may run against it. ***",
    "  The destructive concurrency suite is pointed at the job's own ephemeral postgres service",
    "  (database autolenis_e2e on localhost) and refuses anything else, so this classification is",
    "  informational — but a production DATABASE_URL in a test job is still worth removing.",
  );
}
console.log(lines.join("\n"));
