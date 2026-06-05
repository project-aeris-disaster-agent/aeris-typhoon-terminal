import { isValidTxHash, mintExplorerTxUrl, shortTxHash } from "./explorer-links";

const TX =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

describe("explorer-links", () => {
  it("builds SKALE and Base explorer URLs for valid tx hashes", () => {
    expect(isValidTxHash(TX)).toBe(true);
    expect(mintExplorerTxUrl("skale-base-testnet", TX)).toBe(
      `https://base-sepolia-testnet-explorer.skalenodes.com/tx/${TX}`,
    );
    expect(mintExplorerTxUrl("base-mainnet", TX)).toBe(
      `https://basescan.org/tx/${TX}`,
    );
  });

  it("rejects invalid hashes and unknown networks", () => {
    expect(mintExplorerTxUrl("skale-base-testnet", "0xshort")).toBeNull();
    expect(mintExplorerTxUrl("unknown-network", TX)).toBeNull();
  });

  it("shortens long tx hashes for display", () => {
    expect(shortTxHash(TX)).toBe("0xabcdef12…567890");
  });
});
