const EXPLORER_BASES: Record<string, string> = {
  "skale-base-mainnet": "https://skale-base-explorer.skalenodes.com",
  "skale-base-testnet": "https://base-sepolia-testnet-explorer.skalenodes.com",
  "base-mainnet": "https://basescan.org",
  "base-sepolia": "https://sepolia.basescan.org",
};

export function isValidTxHash(tx: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(tx);
}

export function mintExplorerTxUrl(
  network: string | undefined | null,
  txHash: string,
): string | null {
  if (!isValidTxHash(txHash)) return null;
  const base = network ? EXPLORER_BASES[network] : undefined;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/tx/${txHash}`;
}

export function shortTxHash(tx: string, head = 10, tail = 6): string {
  if (tx.length <= head + tail + 1) return tx;
  return `${tx.slice(0, head)}…${tx.slice(-tail)}`;
}
