export type LastFourSuggestion = {
  kind: "disabled" | "unavailable" | "mismatch" | "collision" | "suggestion";
  accountIds: string[];
};
/** Pass only server-authorized accounts. Hints do not prove identity; every result still requires explicit mapping confirmation. */
export function suggestStatementAccounts(
  optIn: boolean,
  lastFour: string | null,
  accounts: readonly { id: string; lastFour?: string | null }[]
): LastFourSuggestion {
  if (!optIn) return { kind: "disabled", accountIds: [] };
  if (!lastFour || !/^\d{4}$/.test(lastFour)) return { kind: "unavailable", accountIds: [] };
  const accountIds = [...new Set(accounts.filter((a) => a.lastFour === lastFour).map((a) => a.id))];
  return {
    kind: accountIds.length > 1 ? "collision" : accountIds.length === 1 ? "suggestion" : "mismatch",
    accountIds,
  };
}
