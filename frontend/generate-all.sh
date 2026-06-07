#!/bin/bash
set -e

metros=(
  "Houston"
  "Los Angeles"
  "Chicago"
  "Miami"
  "Atlanta"
  "Washington DC"
  "Phoenix"
  "Philadelphia"
  "Detroit"
  "Boston"
  "San Antonio"
  "Austin"
  "Seattle"
  "Denver"
  "Minneapolis"
  "Tampa"
  "Charlotte"
  "San Diego"
  "Portland"
  "Las Vegas"
  "Nashville"
  "Baltimore"
  "Sacramento"
  "New York"
)

for metro in "${metros[@]}"; do
  echo "Generating: $metro"
  pnpm content:generate --metro "$metro" --limit 25
  echo "Done: $metro"
  sleep 5
done

echo "All metros complete!"
