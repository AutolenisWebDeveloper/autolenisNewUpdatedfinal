// lib/services/contract/contract-comparison.service.ts — System 8 ENH diff
export interface ContractDiff { field: string; v1: string; v2: string; changed: boolean }

export function compareContracts(textV1: string, textV2: string): ContractDiff[] {
  const extractField = (text: string, label: string): string => {
    const match = text.match(new RegExp(`${label}[:\\s]+([^\\n]+)`, "i"));
    return match ? match[1].trim() : "N/A";
  };
  const fields = ["Documentation Fee", "APR", "Total Price", "Monthly Payment", "Trade-In Value"];
  return fields.map(field => {
    const v1 = extractField(textV1, field);
    const v2 = extractField(textV2, field);
    return { field, v1, v2, changed: v1 !== v2 };
  });
}
