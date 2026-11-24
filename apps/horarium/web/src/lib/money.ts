import type { Service } from "./api.ts";

const PLN = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

/** "12 500,00 zł". */
export const formatMoney = (amount: number) => PLN.format(amount);

/** Price a closed visit starts from: the price list's amount, or its lower end for a range ("od–do"). */
export function suggestedPrice(service: Pick<Service, "priceMin" | "priceMax">): number {
  return service.priceMin ?? service.priceMax ?? 0;
}
