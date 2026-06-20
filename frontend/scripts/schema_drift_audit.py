#!/usr/bin/env python3
"""Parse schema.prisma -> expected (table, column) pairs.

Distinguishes scalar/enum fields (real DB columns) from relation fields
(which are not columns). Emits a JSON with table->columns and a SQL VALUES
list usable to diff against the live DB.
"""
import re, json, sys

SCALARS = {
    "String", "Boolean", "Int", "BigInt", "Float", "Decimal",
    "DateTime", "Json", "Bytes",
}

src = open("prisma/schema.prisma").read()
lines = src.splitlines()

# First pass: collect model and enum names
model_names = set()
enum_names = set()
for ln in lines:
    m = re.match(r"^\s*model\s+(\w+)\s*\{", ln)
    if m:
        model_names.add(m.group(1))
    m = re.match(r"^\s*enum\s+(\w+)\s*\{", ln)
    if m:
        enum_names.add(m.group(1))

scalar_types = SCALARS | enum_names

tables = {}  # model -> {"table": name, "columns": [..]}
current = None
in_enum = False
brace = 0

for ln in lines:
    stripped = ln.strip()
    m = re.match(r"^\s*model\s+(\w+)\s*\{", ln)
    if m:
        current = m.group(1)
        tables[current] = {"table": current, "columns": [], "ignored": False}
        continue
    m = re.match(r"^\s*enum\s+(\w+)\s*\{", ln)
    if m:
        in_enum = True
        continue
    if in_enum:
        if stripped == "}":
            in_enum = False
        continue
    if current is None:
        continue
    if stripped == "}":
        current = None
        continue
    if not stripped or stripped.startswith("//"):
        continue
    # block-level attributes
    if stripped.startswith("@@"):
        mm = re.search(r'@@map\("([^"]+)"\)', stripped)
        if mm:
            tables[current]["table"] = mm.group(1)
        if stripped.startswith("@@ignore"):
            tables[current]["ignored"] = True
        continue
    # field line: name Type ...
    fm = re.match(r"^\s*(\w+)\s+([A-Za-z0-9_\[\]\?\.]+)(.*)$", ln)
    if not fm:
        continue
    fname, ftype, rest = fm.group(1), fm.group(2), fm.group(3)
    base = ftype.replace("[]", "").replace("?", "")
    # relation fields are not columns
    if base in model_names:
        continue
    if "@relation" in rest:
        continue
    if "@ignore" in rest:
        continue
    # list of scalars/enums is not a real column in postgres unless it's a scalar list
    # Prisma scalar lists DO create columns (text[] etc). Keep them.
    if base not in scalar_types:
        # unknown type -> skip (composite types etc.)
        continue
    col = fname
    cm = re.search(r'@map\("([^"]+)"\)', rest)
    if cm:
        col = cm.group(1)
    tables[current]["columns"].append(col)

# Build expected pairs (skip ignored models)
expected = {}
for model, info in tables.items():
    if info["ignored"]:
        continue
    expected[info["table"]] = sorted(set(info["columns"]))

json.dump(expected, open("scripts/expected_schema.json", "w"), indent=0)

# Emit SQL VALUES for diff
pairs = []
for t, cols in expected.items():
    for c in cols:
        pairs.append(f"('{t}','{c}')")
values = ",".join(pairs)
sql = (
    "WITH expected(t,c) AS (VALUES " + values + ") "
    "SELECT e.t AS table_name, e.c AS column_name FROM expected e "
    "WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic "
    "WHERE ic.table_schema='public' AND ic.table_name=e.t AND ic.column_name=e.c) "
    "ORDER BY e.t, e.c;"
)
open("scripts/drift_check.sql", "w").write(sql)

print(f"models parsed: {len(tables)}")
print(f"expected tables: {len(expected)}")
print(f"expected columns: {sum(len(c) for c in expected.values())}")
print(f"enums: {len(enum_names)}")
