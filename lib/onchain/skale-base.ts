/**
 * Phase 6.2 - SKALE on Base network configuration.
 *
 * SKALE-Base is a SKALE Chain anchored to the Base ecosystem with
 * pre-paid CREDIT gas, giving us zero-fee user-side transactions for
 * minting AERIS report Hypercerts.
 *
 * Mainnet:
 *   chainId 1187947933 (0x46cea59d)
 *   RPC     https://skale-base.skalenodes.com/v1/base
 *   Explorer https://skale-base-explorer.skalenodes.com/
 *
 * Testnet (SKALE Base Sepolia - default for dev):
 *   chainId 324705682 (0x135A9D92)
 *   RPC     https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha
 *   Explorer https://base-sepolia-testnet-explorer.skalenodes.com/
 *   Faucet  https://base-sepolia-faucet.skale.space
 */

export type SkaleNetworkKey = "skale-base-mainnet" | "skale-base-testnet";

export type SkaleNetworkConfig = {
  key: SkaleNetworkKey;
  chainId: number;
  chainIdHex: `0x${string}`;
  rpcUrl: string;
  wsUrl?: string;
  explorerUrl: string;
  faucetUrl?: string;
  nativeToken: { symbol: string; decimals: number };
};

export const SKALE_BASE_MAINNET: SkaleNetworkConfig = {
  key: "skale-base-mainnet",
  chainId: 1187947933,
  chainIdHex: "0x46cea59d",
  rpcUrl: "https://skale-base.skalenodes.com/v1/base",
  wsUrl: "wss://skale-base.skalenodes.com/v1/ws/base",
  explorerUrl: "https://skale-base-explorer.skalenodes.com",
  nativeToken: { symbol: "CREDIT", decimals: 18 },
};

export const SKALE_BASE_TESTNET: SkaleNetworkConfig = {
  key: "skale-base-testnet",
  chainId: 324705682,
  chainIdHex: "0x135A9D92",
  rpcUrl:
    "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
  explorerUrl: "https://base-sepolia-testnet-explorer.skalenodes.com",
  faucetUrl: "https://base-sepolia-faucet.skale.space",
  nativeToken: { symbol: "CREDIT", decimals: 18 },
};

export const SKALE_NETWORKS: Record<SkaleNetworkKey, SkaleNetworkConfig> = {
  "skale-base-mainnet": SKALE_BASE_MAINNET,
  "skale-base-testnet": SKALE_BASE_TESTNET,
};

export function getActiveSkaleNetwork(): SkaleNetworkConfig {
  const key = (process.env.AERIS_ONCHAIN_NETWORK ?? "skale-base-testnet") as SkaleNetworkKey;
  return SKALE_NETWORKS[key] ?? SKALE_BASE_TESTNET;
}

export function explorerTxUrl(network: SkaleNetworkConfig, txHash: string): string {
  return `${network.explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
}

export function explorerAddressUrl(
  network: SkaleNetworkConfig,
  address: string,
): string {
  return `${network.explorerUrl.replace(/\/$/, "")}/address/${address}`;
}
