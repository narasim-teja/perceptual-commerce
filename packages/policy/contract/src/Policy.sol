// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Policy — the fail-closed mint gate for perceptual-commerce
/// @notice This contract decides whether an agent may bring a *spending instrument*
///         into existence. It is deliberately NOT in the live card-authorization
///         path: Rain enforces a scoped card's own bounds (amount / MCC / expiry)
///         at authorization time, natively. What lives here is the question that
///         comes first — "may a card be minted for this intent at all?" — and the
///         answer is denied by default in every ambiguous case.
/// @dev    Everything is denied unless an explicit allow is configured. A fresh
///         deployment with no payees and no MCCs on the allowlist denies 100% of
///         mints. That is the intended initial state, not a misconfiguration.
contract Policy {
    // ─── reasons ──────────────────────────────────────────────────────────────

    enum Reason {
        None, // 0 — only ever paired with allowed == true
        KillSwitch, // 1
        PayeeNotAllowed, // 2
        MccNotAllowed, // 3
        AmountOverCap, // 4
        VelocityExceeded, // 5
        AlreadyRuled // 6 — onchain idempotency: this intent was already ruled on
    }

    // ─── state ────────────────────────────────────────────────────────────────

    address public owner;

    /// @notice Global stop. When true every mint is denied, no exceptions.
    bool public killSwitch;

    /// @notice Hard per-mint ceiling, in USD cents.
    uint256 public maxAmountCents;

    /// @notice Rolling velocity window, in seconds.
    uint256 public velocityWindowSeconds;
    uint256 public maxMintsPerWindow;
    uint256 public maxCentsPerWindow;

    /// @dev Fixed-bucket window. Cheap, deterministic, and readable from a view.
    uint256 public windowStart;
    uint256 public mintsInWindow;
    uint256 public centsInWindow;

    /// @dev keccak256(bytes(payeeId)) => allowed
    mapping(bytes32 => bool) public allowedPayee;
    /// @dev four-digit MCC as a number (5411) => allowed
    mapping(uint16 => bool) public allowedMcc;
    /// @dev intent hash => already ruled. One intent, one ruling, forever.
    mapping(bytes32 => bool) public ruled;

    // ─── events ───────────────────────────────────────────────────────────────

    /// @notice Emitted on every ruling — allow *and* deny. The deny events are the
    ///         demo: an auditable onchain record of a refusal to spend.
    event MintRuling(
        bytes32 indexed intentHash,
        bytes32 indexed payee,
        uint16 mcc,
        uint256 amountCents,
        bool allowed,
        Reason reason,
        uint256 rulingAt
    );

    event KillSwitchSet(bool active);
    event PayeeSet(bytes32 indexed payee, bool allowed);
    event MccSet(uint16 indexed mcc, bool allowed);
    event LimitsSet(uint256 maxAmountCents, uint256 windowSeconds, uint256 maxMints, uint256 maxCents);
    event OwnerSet(address indexed owner);

    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 _maxAmountCents, uint256 _velocityWindowSeconds, uint256 _maxMintsPerWindow, uint256 _maxCentsPerWindow) {
        owner = msg.sender;
        maxAmountCents = _maxAmountCents;
        velocityWindowSeconds = _velocityWindowSeconds;
        maxMintsPerWindow = _maxMintsPerWindow;
        maxCentsPerWindow = _maxCentsPerWindow;
        windowStart = block.timestamp;
        emit OwnerSet(msg.sender);
        emit LimitsSet(_maxAmountCents, _velocityWindowSeconds, _maxMintsPerWindow, _maxCentsPerWindow);
    }

    // ─── the gate ─────────────────────────────────────────────────────────────

    /// @notice Pure read of the current ruling. Free to call; the agent uses this
    ///         to know the answer before spending gas.
    function evaluateMint(bytes32 intentHash, bytes32 payee, uint16 mcc, uint256 amountCents)
        public
        view
        returns (bool allowed, Reason reason)
    {
        if (killSwitch) return (false, Reason.KillSwitch);
        if (ruled[intentHash]) return (false, Reason.AlreadyRuled);
        if (!allowedPayee[payee]) return (false, Reason.PayeeNotAllowed);
        if (!allowedMcc[mcc]) return (false, Reason.MccNotAllowed);
        if (amountCents == 0 || amountCents > maxAmountCents) return (false, Reason.AmountOverCap);

        (uint256 mints, uint256 cents) = currentWindowUsage();
        if (mints + 1 > maxMintsPerWindow) return (false, Reason.VelocityExceeded);
        if (cents + amountCents > maxCentsPerWindow) return (false, Reason.VelocityExceeded);

        return (true, Reason.None);
    }

    /// @notice The ruling of record. Writes the decision onchain and returns it.
    ///         The tx hash becomes the `onchainRef` on our Authorization, so every
    ///         card that exists can be traced back to the block that permitted it.
    /// @dev    Callable by anyone: the contract is the authority, not the caller.
    ///         A denied ruling still costs a tx and still emits — refusals are
    ///         evidence and we want them on chain.
    function ruleMint(bytes32 intentHash, bytes32 payee, uint16 mcc, uint256 amountCents)
        external
        returns (bool allowed, Reason reason)
    {
        (allowed, reason) = evaluateMint(intentHash, payee, mcc, amountCents);

        if (allowed) {
            _rollWindow();
            mintsInWindow += 1;
            centsInWindow += amountCents;
            ruled[intentHash] = true;
        }

        emit MintRuling(intentHash, payee, mcc, amountCents, allowed, reason, block.timestamp);
    }

    /// @notice Window counters as of *now*, accounting for an expired bucket.
    function currentWindowUsage() public view returns (uint256 mints, uint256 cents) {
        if (block.timestamp >= windowStart + velocityWindowSeconds) return (0, 0);
        return (mintsInWindow, centsInWindow);
    }

    function _rollWindow() internal {
        if (block.timestamp >= windowStart + velocityWindowSeconds) {
            windowStart = block.timestamp;
            mintsInWindow = 0;
            centsInWindow = 0;
        }
    }

    // ─── admin ────────────────────────────────────────────────────────────────

    function setKillSwitch(bool active) external onlyOwner {
        killSwitch = active;
        emit KillSwitchSet(active);
    }

    function setPayee(bytes32 payee, bool allowed) external onlyOwner {
        allowedPayee[payee] = allowed;
        emit PayeeSet(payee, allowed);
    }

    function setMcc(uint16 mcc, bool allowed) external onlyOwner {
        allowedMcc[mcc] = allowed;
        emit MccSet(mcc, allowed);
    }

    function setLimits(uint256 _maxAmountCents, uint256 _windowSeconds, uint256 _maxMints, uint256 _maxCents)
        external
        onlyOwner
    {
        maxAmountCents = _maxAmountCents;
        velocityWindowSeconds = _windowSeconds;
        maxMintsPerWindow = _maxMints;
        maxCentsPerWindow = _maxCents;
        emit LimitsSet(_maxAmountCents, _windowSeconds, _maxMints, _maxCents);
    }

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
        emit OwnerSet(newOwner);
    }

    /// @notice Convenience for off-chain callers: the exact hashing we use for
    ///         payee ids, so TypeScript and Solidity can never drift apart.
    function payeeKey(string calldata payeeId) external pure returns (bytes32) {
        return keccak256(bytes(payeeId));
    }
}
