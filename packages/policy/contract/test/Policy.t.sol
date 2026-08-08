// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Policy} from "../src/Policy.sol";

/// The only tests that matter here are the ones where the contract says NO.
/// Anyone can demo an allow; the product is the deny.
contract PolicyTest is Test {
    Policy internal policy;

    bytes32 internal constant SUPPLIER = keccak256(bytes("restaurant-depot"));
    bytes32 internal constant STRANGER = keccak256(bytes("some-guy-on-the-internet"));
    uint16 internal constant GROCERY = 5411;
    uint16 internal constant BAR = 5813;

    uint256 internal constant CAP = 10_000; // $100.00 per mint
    uint256 internal constant WINDOW = 1 hours;
    uint256 internal constant MAX_MINTS = 2;
    uint256 internal constant MAX_CENTS = 15_000; // $150.00 per window

    function setUp() public {
        policy = new Policy(CAP, WINDOW, MAX_MINTS, MAX_CENTS);
        policy.setPayee(SUPPLIER, true);
        policy.setMcc(GROCERY, true);
    }

    function _intent(string memory tag) internal pure returns (bytes32) {
        return keccak256(bytes(tag));
    }

    // ─── the allow path ───────────────────────────────────────────────────────

    function test_allowsAConfiguredMint() public view {
        (bool allowed, Policy.Reason reason) = policy.evaluateMint(_intent("a"), SUPPLIER, GROCERY, 4299);
        assertTrue(allowed);
        assertEq(uint256(reason), uint256(Policy.Reason.None));
    }

    function test_ruleMintRecordsAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit Policy.MintRuling(_intent("a"), SUPPLIER, GROCERY, 4299, true, Policy.Reason.None, block.timestamp);
        policy.ruleMint(_intent("a"), SUPPLIER, GROCERY, 4299);

        assertTrue(policy.ruled(_intent("a")));
        (uint256 mints, uint256 cents) = policy.currentWindowUsage();
        assertEq(mints, 1);
        assertEq(cents, 4299);
    }

    // ─── every deny ───────────────────────────────────────────────────────────

    function test_freshDeploymentDeniesEverything() public {
        Policy fresh = new Policy(CAP, WINDOW, MAX_MINTS, MAX_CENTS);
        (bool allowed, Policy.Reason reason) = fresh.evaluateMint(_intent("a"), SUPPLIER, GROCERY, 4299);
        assertFalse(allowed);
        assertEq(uint256(reason), uint256(Policy.Reason.PayeeNotAllowed));
    }

    function test_killSwitchDeniesEverything() public {
        policy.setKillSwitch(true);
        (bool allowed, Policy.Reason reason) = policy.evaluateMint(_intent("a"), SUPPLIER, GROCERY, 4299);
        assertFalse(allowed);
        assertEq(uint256(reason), uint256(Policy.Reason.KillSwitch));
    }

    function test_unknownPayeeDenied() public view {
        (bool allowed, Policy.Reason reason) = policy.evaluateMint(_intent("a"), STRANGER, GROCERY, 4299);
        assertFalse(allowed);
        assertEq(uint256(reason), uint256(Policy.Reason.PayeeNotAllowed));
    }

    function test_wrongMccDenied() public view {
        (bool allowed, Policy.Reason reason) = policy.evaluateMint(_intent("a"), SUPPLIER, BAR, 4299);
        assertFalse(allowed);
        assertEq(uint256(reason), uint256(Policy.Reason.MccNotAllowed));
    }

    function test_overCapDenied() public view {
        (bool allowed, Policy.Reason reason) = policy.evaluateMint(_intent("a"), SUPPLIER, GROCERY, CAP + 1);
        assertFalse(allowed);
        assertEq(uint256(reason), uint256(Policy.Reason.AmountOverCap));
    }

    function test_zeroAmountDenied() public view {
        (bool allowed,) = policy.evaluateMint(_intent("a"), SUPPLIER, GROCERY, 0);
        assertFalse(allowed);
    }

    function test_replayOfTheSameIntentDenied() public {
        policy.ruleMint(_intent("a"), SUPPLIER, GROCERY, 4299);
        (bool allowed, Policy.Reason reason) = policy.evaluateMint(_intent("a"), SUPPLIER, GROCERY, 4299);
        assertFalse(allowed);
        assertEq(uint256(reason), uint256(Policy.Reason.AlreadyRuled));
    }

    function test_velocityMintCountDenied() public {
        policy.ruleMint(_intent("a"), SUPPLIER, GROCERY, 1000);
        policy.ruleMint(_intent("b"), SUPPLIER, GROCERY, 1000);
        (bool allowed, Policy.Reason reason) = policy.evaluateMint(_intent("c"), SUPPLIER, GROCERY, 1000);
        assertFalse(allowed);
        assertEq(uint256(reason), uint256(Policy.Reason.VelocityExceeded));
    }

    function test_velocityCentsDenied() public {
        policy.ruleMint(_intent("a"), SUPPLIER, GROCERY, 9000);
        (bool allowed, Policy.Reason reason) = policy.evaluateMint(_intent("b"), SUPPLIER, GROCERY, 7000);
        assertFalse(allowed);
        assertEq(uint256(reason), uint256(Policy.Reason.VelocityExceeded));
    }

    function test_windowResetsAfterItElapses() public {
        policy.ruleMint(_intent("a"), SUPPLIER, GROCERY, 1000);
        policy.ruleMint(_intent("b"), SUPPLIER, GROCERY, 1000);

        vm.warp(block.timestamp + WINDOW);

        (bool allowed,) = policy.evaluateMint(_intent("c"), SUPPLIER, GROCERY, 1000);
        assertTrue(allowed);

        policy.ruleMint(_intent("c"), SUPPLIER, GROCERY, 1000);
        (uint256 mints,) = policy.currentWindowUsage();
        assertEq(mints, 1, "counters roll, they do not accumulate across windows");
    }

    // ─── admin ────────────────────────────────────────────────────────────────

    function test_onlyOwnerCanFlipTheKillSwitch() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(Policy.NotOwner.selector);
        policy.setKillSwitch(true);
    }

    function test_payeeKeyMatchesOffchainHashing() public view {
        assertEq(policy.payeeKey("restaurant-depot"), SUPPLIER);
    }
}
