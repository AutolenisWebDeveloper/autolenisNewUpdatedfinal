// @deprecated — RETIRED. The sitewide Organization entity is now defined once,
// with an @id, inside `entityGraphSchema` (lib/seo/entity-graph.ts) and rendered
// in the root layout. This component previously mounted a SECOND, conflicting
// Organization node (no @id, different description, areaServed:"US"), which
// fragmented the knowledge graph. It is intentionally a no-op and must NOT be
// re-mounted. Use the entity graph instead.
export default function OrganizationSchema(): null {
  return null;
}
