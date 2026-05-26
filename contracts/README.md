# AERIS Reports Contract

ERC-1155 (`AerisReports.sol`) for tamper-evident receipts of verified AERIS
disaster reports. Deployed on SKALE-Base for gasless transactions.

## Layout

```
contracts/
  foundry.toml
  src/AerisReports.sol
  script/Deploy.s.sol
```

## Install Foundry deps (one-off)

```bash
# from contracts/
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit
```

## Build

```bash
cd contracts
forge build
```

## Deploy to SKALE Base Sepolia testnet

```bash
export AERIS_DEPLOYER_PK=0x...                # private key of a funded deployer
export AERIS_ADMIN=0x...                      # address that should hold MINTER_ROLE

forge script script/Deploy.s.sol:Deploy \
  --rpc-url skale_base_testnet \
  --private-key $AERIS_DEPLOYER_PK \
  --broadcast
```

Faucet for the testnet:
https://base-sepolia-faucet.skale.space

After deploy, set the contract address in the dashboard `.env`:

```
AERIS_REPORTS_CONTRACT_ADDRESS=0x...
AERIS_ONCHAIN_NETWORK=skale-base-testnet
```

## Mainnet

Use `--rpc-url skale_base_mainnet` once SKALE-Base mainnet onboarding is
complete and the deployer wallet has CREDIT gas allocated.
