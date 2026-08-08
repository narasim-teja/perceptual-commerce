// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Policy} from "../src/Policy.sol";

/// Deploy the mint gate to Monad testnet and seed the demo allowlist.
///
///   forge script script/Deploy.s.sol:Deploy \
///     --root packages/policy/contract \
///     --rpc-url "$MONAD_RPC_URL" \
///     --private-key "$DEPLOYER_PRIVATE_KEY" \
///     --broadcast
///
/// Then put the printed address in POLICY_CONTRACT_ADDRESS.
contract Deploy is Script {
    function run() external {
        uint256 maxAmountCents = vm.envOr("POLICY_MAX_AMOUNT_CENTS", uint256(10_000)); // $100
        uint256 windowSeconds = vm.envOr("POLICY_WINDOW_SECONDS", uint256(3600));
        uint256 maxMints = vm.envOr("POLICY_MAX_MINTS_PER_WINDOW", uint256(3));
        uint256 maxCents = vm.envOr("POLICY_MAX_CENTS_PER_WINDOW", uint256(20_000)); // $200

        string memory payeeId = vm.envOr("DEMO_PAYEE_ID", string("restaurant-depot"));
        uint256 mcc = vm.envOr("DEMO_MCC", uint256(5411));

        vm.startBroadcast();
        Policy policy = new Policy(maxAmountCents, windowSeconds, maxMints, maxCents);
        policy.setPayee(keccak256(bytes(payeeId)), true);
        policy.setMcc(uint16(mcc), true);
        vm.stopBroadcast();

        console.log("Policy deployed at:", address(policy));
        console.log("  payee allowed:", payeeId);
        console.log("  mcc allowed:", mcc);
        console.log("Set POLICY_CONTRACT_ADDRESS to the address above.");
    }
}
