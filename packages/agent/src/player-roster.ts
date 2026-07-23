import type { KnownPlayer, PdPlayerSummary } from "@palserver/shared";

const identityKey = (userId: string): string => {
  const value = userId.trim().toLowerCase();
  return value.startsWith("steam_") ? value.slice("steam_".length) : value;
};

const nameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

function mergePlayer(player: PdPlayerSummary, previous?: KnownPlayer): KnownPlayer {
  return {
    userId: previous?.userId ?? player.userId.trim(),
    name: player.name.trim() || previous?.name || "",
    accountName: previous?.accountName ?? "",
    online: player.online,
    firstSeen: previous?.firstSeen ?? "",
    lastSeen: previous?.lastSeen ?? "",
    sessions: previous?.sessions ?? 0,
    playtimeSeconds: previous?.playtimeSeconds ?? 0,
    lastLevel: previous?.lastLevel ?? 0,
    ...(player.guildName.trim() ? { guildName: player.guildName.trim() } : {}),
  };
}

/**
 * Merge PalDefender's save-backed roster with the agent's presence history.
 *
 * PalDefender documents UserId as optional for offline save entries. Those
 * entries cannot be keyed directly, so use a unique player name as a guarded
 * fallback. Ambiguous or unknown nameless-ID entries are omitted because a
 * KnownPlayer without a UserId cannot be targeted by any player action.
 */
export function mergeKnownPlayers(
  ownPlayers: KnownPlayer[],
  pdPlayers: PdPlayerSummary[],
): KnownPlayer[] {
  const remaining = [...ownPlayers];
  const merged: KnownPlayer[] = [];
  const seenIds = new Set<string>();
  const missingId = pdPlayers.filter((player) => !identityKey(player.userId));

  for (const player of pdPlayers) {
    const id = identityKey(player.userId);
    if (!id || seenIds.has(id)) continue;
    const previousIndex = remaining.findIndex((candidate) => identityKey(candidate.userId) === id);
    const previous = previousIndex >= 0 ? remaining.splice(previousIndex, 1)[0] : undefined;
    merged.push(mergePlayer(player, previous));
    seenIds.add(id);
  }

  const pdNameCounts = new Map<string, number>();
  for (const player of missingId) {
    const name = nameKey(player.name);
    if (name) pdNameCounts.set(name, (pdNameCounts.get(name) ?? 0) + 1);
  }

  for (const player of missingId) {
    const name = nameKey(player.name);
    if (!name || pdNameCounts.get(name) !== 1) continue;
    const matches = remaining
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => nameKey(candidate.name) === name);
    if (matches.length !== 1) continue;
    const [{ candidate, index }] = matches;
    const id = identityKey(candidate.userId);
    if (!id || seenIds.has(id)) continue;
    remaining.splice(index, 1);
    merged.push(mergePlayer(player, candidate));
    seenIds.add(id);
  }

  for (const player of remaining) {
    const id = identityKey(player.userId);
    if (!id || seenIds.has(id)) continue;
    merged.push(player);
    seenIds.add(id);
  }
  return merged;
}
