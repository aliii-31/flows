// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlowPool} from "../src/FlowPool.sol";

/**
 * Deploy FlowPool to Base Sepolia.
 *
 *   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast \
 *     --private-key $DEPLOYER_KEY
 *
 * Env:
 *   USDC          - testnet USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e)
 *   TERMS_SIGNER  - address of FLOWPOOL_SIGNER_KEY (backend term authorizer)
 *   TREASURY      - protocol fee recipient
 *   FEE_BPS       - fee on interest (e.g. 1000 = 10%)
 */
contract Deploy is Script {
    function run() external {
        address usdc = vm.envAddress("USDC");
        address termsSigner = vm.envAddress("TERMS_SIGNER");
        address treasury = vm.envAddress("TREASURY");
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(1000)));

        vm.startBroadcast();
        FlowPool pool = new FlowPool(usdc, termsSigner, treasury, feeBps);
        vm.stopBroadcast();

        console.log("FlowPool deployed:", address(pool));
    }
}
