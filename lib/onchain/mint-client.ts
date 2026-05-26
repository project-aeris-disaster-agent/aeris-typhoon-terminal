/**
 * Phase 6.3 - viem-based mint client for AerisReports on SKALE-Base.
 *
 * Requires:
 *   AERIS_ONCHAIN_NETWORK            "skale-base-mainnet" | "skale-base-testnet"
 *   AERIS_REPORTS_CONTRACT_ADDRESS   0x... deployed contract
 *   AERIS_SERVICE_PRIVATE_KEY        0x... private key with MINTER_ROLE
 *
 * If any of these are missing, callers can detect via `mintClientAvailable()`
 * and either skip or fall back to dry-run mode.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getActiveSkaleNetwork, type SkaleNetworkConfig } from "./skale-base";

const AERIS_REPORTS_ABI = [
  {
    type: "function",
    name: "mintReport",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "tokenURI", type: "string" },
      { name: "reportId", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "minted",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "ReportMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "uri", type: "string", indexed: false },
      { name: "reportId", type: "string", indexed: false },
    ],
  },
] as const;

export type MintClient = {
  network: SkaleNetworkConfig;
  contractAddress: Address;
  serviceAddress: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

export function mintClientAvailable(): boolean {
  return Boolean(
    process.env.AERIS_REPORTS_CONTRACT_ADDRESS &&
      process.env.AERIS_SERVICE_PRIVATE_KEY,
  );
}

function buildChain(network: SkaleNetworkConfig) {
  return defineChain({
    id: network.chainId,
    name: network.key,
    nativeCurrency: {
      name: network.nativeToken.symbol,
      symbol: network.nativeToken.symbol,
      decimals: network.nativeToken.decimals,
    },
    rpcUrls: {
      default: { http: [network.rpcUrl] },
      public: { http: [network.rpcUrl] },
    },
    blockExplorers: {
      default: { name: "SKALE Explorer", url: network.explorerUrl },
    },
  });
}

let cachedClient: MintClient | null = null;

export function getMintClient(): MintClient {
  if (cachedClient) return cachedClient;
  const contractAddress = process.env.AERIS_REPORTS_CONTRACT_ADDRESS as Address | undefined;
  const rawPrivateKey = process.env.AERIS_SERVICE_PRIVATE_KEY;
  if (!contractAddress || !rawPrivateKey) {
    throw new Error(
      "Mint client not configured: set AERIS_REPORTS_CONTRACT_ADDRESS and AERIS_SERVICE_PRIVATE_KEY.",
    );
  }
  const cleaned = rawPrivateKey.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error(
      "AERIS_SERVICE_PRIVATE_KEY must be a 32-byte hex string (64 hex chars, with or without 0x prefix).",
    );
  }
  const privateKey = (`0x${cleaned}`) as Hex;
  const network = getActiveSkaleNetwork();
  const chain = buildChain(network);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const walletClient = createWalletClient({
    chain,
    account,
    transport: http(network.rpcUrl),
  });
  cachedClient = {
    network,
    contractAddress,
    serviceAddress: account.address,
    publicClient,
    walletClient,
  };
  return cachedClient;
}

export type MintReportArgs = {
  to: Address;
  tokenId: bigint;
  tokenUri: string;
  reportId: string;
};

export type MintReportResult = {
  txHash: Hex;
  tokenId: string;
  network: string;
  chainId: number;
  to: Address;
  alreadyMinted: boolean;
};

export async function isAlreadyMinted(
  client: MintClient,
  tokenId: bigint,
): Promise<boolean> {
  const result = (await client.publicClient.readContract({
    address: client.contractAddress,
    abi: AERIS_REPORTS_ABI,
    functionName: "minted",
    args: [tokenId],
  })) as boolean;
  return result;
}

export async function mintReport(
  client: MintClient,
  args: MintReportArgs,
): Promise<MintReportResult> {
  const alreadyMinted = await isAlreadyMinted(client, args.tokenId);
  if (alreadyMinted) {
    return {
      txHash: "0x" as Hex,
      tokenId: args.tokenId.toString(10),
      network: client.network.key,
      chainId: client.network.chainId,
      to: args.to,
      alreadyMinted: true,
    };
  }

  const { request } = await client.publicClient.simulateContract({
    address: client.contractAddress,
    abi: AERIS_REPORTS_ABI,
    functionName: "mintReport",
    args: [args.to, args.tokenId, args.tokenUri, args.reportId],
    account: client.serviceAddress,
  });

  // SKALE chains reject EIP-1559 raw txs; force legacy and use the live
  // chain-reported gas price (must be >= eth_gasPrice; chain is not zero-gas).
  // The walletClient's typed Account must be passed explicitly when spreading
  // a simulated request, otherwise viem falls back to eth_sendTransaction.
  const gasPrice = await client.publicClient.getGasPrice();
  // viem's WriteContract discriminated union rejects { type: "legacy" } when
  // the simulated `request` carries an `accessList: undefined` slot from the
  // EIP-2930 branch. Runtime is happy; we cast to bypass the narrowing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writeParams: any = {
    ...request,
    account: client.walletClient.account!,
    chain: client.walletClient.chain,
    type: "legacy",
    gasPrice,
  };
  delete writeParams.accessList;
  const txHash = await client.walletClient.writeContract(writeParams);
  const receipt = await client.publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success") {
    throw new Error(`Mint reverted (tx ${txHash}).`);
  }

  // Confirm via the event log; tokenId is already known but this verifies
  // the chain actually emitted ReportMinted as expected.
  parseEventLogs({
    abi: AERIS_REPORTS_ABI,
    eventName: "ReportMinted",
    logs: receipt.logs,
  });

  return {
    txHash,
    tokenId: args.tokenId.toString(10),
    network: client.network.key,
    chainId: client.network.chainId,
    to: args.to,
    alreadyMinted: false,
  };
}
