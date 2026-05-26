// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AerisReports} from "../src/AerisReports.sol";

/// @notice Deploys AerisReports to the active SKALE-Base network.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url skale_base_testnet \
///     --private-key $AERIS_DEPLOYER_PK \
///     --broadcast
contract Deploy is Script {
    function run() external returns (AerisReports deployed) {
        address admin = vm.envOr("AERIS_ADMIN", msg.sender);
        vm.startBroadcast();
        deployed = new AerisReports(admin);
        vm.stopBroadcast();

        console2.log("AerisReports deployed at:", address(deployed));
        console2.log("Admin / initial MINTER_ROLE:", admin);
    }
}
