// NHTSA-backed make/model dropdowns for the public Vehicle Request form.
// The list of "popular makes" is curated for U.S.-market relevance; the model
// dropdown is fetched live from NHTSA per make and aggressively cached because
// the data only changes a few times a year.

export const POPULAR_MAKES = [
  "Acura", "Alfa Romeo", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet",
  "Chrysler", "Dodge", "Ford", "Genesis", "GMC", "Honda", "Hyundai",
  "Infiniti", "Jaguar", "Jeep", "Kia", "Land Rover", "Lexus", "Lincoln",
  "Lucid", "Mazda", "Mercedes-Benz", "MINI", "Mitsubishi", "Nissan",
  "Polestar", "Porsche", "Ram", "Rivian", "Subaru", "Tesla", "Toyota",
  "Volkswagen", "Volvo", "Other",
];

export async function fetchModelsForMake(make: string): Promise<string[]> {
  if (!make || make === "Other") return [];
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(make)}?format=json`,
      { cache: "force-cache" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { Results: Array<{ Model_Name: string }> };
    const unique = Array.from(new Set(data.Results.map((r) => r.Model_Name).filter(Boolean)));
    return unique.sort();
  } catch {
    return [];
  }
}
