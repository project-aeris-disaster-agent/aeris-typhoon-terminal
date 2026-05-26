/**
 * Compile + deploy AerisReports.sol via solc + viem.
 *
 * Avoids the Foundry toolchain so this works on a stock Node install.
 *
 * Run:
 *   npm run deploy:contract
 *
 * Required env (loaded from .env.local then .env):
 *   AERIS_ONCHAIN_NETWORK              skale-base-testnet | skale-base-mainnet
 *   AERIS_SERVICE_PRIVATE_KEY          0x... (or bare 64-hex)
 *
 * Optional:
 *   AERIS_ADMIN                        admin address (defaults to deployer)
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

// solc has no first-party TS types; we treat it as a minimal opaque module.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getActiveSkaleNetwork } from "@/lib/onchain/skale-base";

type SolcSources = Record<string, { content: string }>;

const CONTRACT_NAME = "AerisReports";
const ENTRY_SOURCE = "src/AerisReports.sol";

const CONTRACTS_ROOT = resolve(process.cwd(), "contracts");
const NODE_MODULES = resolve(process.cwd(), "node_modules");

// Resolve a Solidity import to a canonical absolute path on disk.
// Supports:
//   - bare npm specifiers like `@openzeppelin/contracts/...` (-> node_modules)
//   - local entry sources like `src/AerisReports.sol`        (-> contracts/...)
//   - relative imports like `./IERC1155.sol`                  (relative to parent)
function resolveImport(importPath: string, parentAbs?: string): string {
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    if (!parentAbs) {
      throw new Error(`Relative import ${importPath} requires a parent context`);
    }
    return resolve(dirname(parentAbs), importPath);
  }
  // npm specifier
  const candidateNpm = resolve(NODE_MODULES, importPath);
  if (existsSync(candidateNpm)) return candidateNpm;
  // local entry source
  const candidateLocal = resolve(CONTRACTS_ROOT, importPath);
  if (existsSync(candidateLocal)) return candidateLocal;
  throw new Error(`Cannot resolve Solidity import: ${importPath}`);
}

function toSolcKey(absPath: string): string {
  // Prefer paths relative to CONTRACTS_ROOT when local, or to node_modules
  // when in a package, so solc's source map / error reporting stays readable.
  const rel = absPath.replace(/\\/g, "/");
  if (rel.startsWith(CONTRACTS_ROOT.replace(/\\/g, "/") + "/")) {
    return rel.slice(CONTRACTS_ROOT.replace(/\\/g, "/").length + 1);
  }
  if (rel.startsWith(NODE_MODULES.replace(/\\/g, "/") + "/")) {
    return rel.slice(NODE_MODULES.replace(/\\/g, "/").length + 1);
  }
  return rel;
}

function buildSources(): SolcSources {
  const seenAbs = new Set<string>();
  const sources: SolcSources = {};

  // Each queue entry tracks the absolute path so relative imports resolve.
  const entryAbs = resolveImport(ENTRY_SOURCE);
  const queue: string[] = [entryAbs];

  while (queue.length > 0) {
    const abs = queue.shift()!;
    if (seenAbs.has(abs)) continue;
    seenAbs.add(abs);

    if (!existsSync(abs)) {
      throw new Error(`Cannot read Solidity source: ${abs}`);
    }
    const content = readFileSync(abs, "utf8");
    sources[toSolcKey(abs)] = { content };

    const importRegex = /^\s*import\s+(?:[^"']*\s+from\s+)?["']([^"']+)["']/gm;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(content)) !== null) {
      const childAbs = resolveImport(m[1], abs);
      if (!seenAbs.has(childAbs)) queue.push(childAbs);
    }
  }
  return sources;
}

function compileContract(): { abi: unknown[]; bytecode: Hex } {
  const sources = buildSources();
  console.log(`[solc] compiling ${Object.keys(sources).length} sources`);

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (importPath: string) => {
        try {
          // solc's import callback does not know the parent path, so it only
          // handles absolute/non-relative imports here. Relative imports are
          // already inlined into `sources` above.
          const abs = resolveImport(importPath);
          return { contents: readFileSync(abs, "utf8") };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    }),
  ) as {
    contracts?: Record<
      string,
      Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>
    >;
    errors?: Array<{ severity: string; formattedMessage: string }>;
  };

  const hardErrors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (hardErrors.length > 0) {
    for (const err of hardErrors) console.error(err.formattedMessage);
    throw new Error("Solidity compilation failed");
  }
  for (const warn of (output.errors ?? []).filter(
    (e) => e.severity !== "error",
  )) {
    console.warn(warn.formattedMessage);
  }

  const fileContracts = output.contracts?.[ENTRY_SOURCE];
  if (!fileContracts || !fileContracts[CONTRACT_NAME]) {
    throw new Error(`Contract ${CONTRACT_NAME} not found in output.`);
  }
  const target = fileContracts[CONTRACT_NAME];
  return {
    abi: target.abi,
    bytecode: (`0x${target.evm.bytecode.object}`) as Hex,
  };
}

function normalisePrivateKey(): Hex {
  const raw = process.env.AERIS_SERVICE_PRIVATE_KEY;
  if (!raw) throw new Error("AERIS_SERVICE_PRIVATE_KEY is not set");
  const cleaned = raw.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error("AERIS_SERVICE_PRIVATE_KEY must be a 32-byte hex string");
  }
  return (`0x${cleaned}`) as Hex;
}

async function main() {
  console.log("== AerisReports deploy ==");

  const network = getActiveSkaleNetwork();
  console.log("Network :", network.key);
  console.log("RPC     :", network.rpcUrl);
  console.log("ChainId :", network.chainId);

  const { abi, bytecode } = compileContract();
  const artifactPath = resolve(
    process.cwd(),
    "contracts",
    "out",
    `${CONTRACT_NAME}.json`,
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({ abi, bytecode }, null, 2),
  );
  console.log("Artifact:", artifactPath);

  const privateKey = normalisePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const admin = (process.env.AERIS_ADMIN as Hex | undefined) ?? account.address;
  console.log("Deployer:", account.address);
  console.log("Admin   :", admin);

  const chain = defineChain({
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

  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const walletClient = createWalletClient({
    chain,
    account,
    transport: http(network.rpcUrl),
  });

  console.log("\nDeploying...");
  // SKALE chains do not support EIP-1559 raw txs; force legacy and let viem
  // pull the live gasPrice from the node (chain enforces a non-zero minimum).
  const gasPrice = await publicClient.getGasPrice();
  console.log("GasPrice:", gasPrice.toString(), "wei");
  const txHash = await walletClient.deployContract({
    abi: abi as never,
    bytecode,
    args: [admin],
    type: "legacy",
    gasPrice,
  });
  console.log("Tx hash :", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Deploy reverted in tx ${txHash}`);
  }
  if (!receipt.contractAddress) {
    throw new Error("No contractAddress in receipt");
  }
  console.log("\n[OK] Deployed at:", receipt.contractAddress);
  console.log(`Explorer: ${network.explorerUrl.replace(/\/$/, "")}/address/${receipt.contractAddress}`);
  console.log(
    "\nAdd to .env:\nAERIS_REPORTS_CONTRACT_ADDRESS=" + receipt.contractAddress,
  );
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});

// Quiet "imported but unused" warnings for helpers kept for clarity:
void fileURLToPath;
