// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The one function this contract reads from the Agent ID token (BEP-721).
interface IAgentId {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title FLASH Pass
/// @notice A free pass for wallets that hold an Agent ID. One pass per wallet.
///
/// What this contract does:
///   - A wallet asks for a pass. The contract checks that the wallet holds an
///     Agent ID, then records the wallet and the time. That is all.
///
/// What this contract cannot do:
///   - It has no owner and no admin. Nobody can pause it, change it, upgrade
///     it, or remove a pass.
///   - It cannot receive BNB: a call or transfer that carries BNB is refused.
///     It never asks for a token approval and never moves tokens.
///   - A pass cannot be transferred. It is a record for the wallet that asked.
contract FlashPass {
    /// @notice The Agent ID token contract. Set once at deployment.
    IAgentId public immutable agentId;

    /// @notice When each wallet's pass was issued (unix seconds). 0 means no pass.
    mapping(address => uint256) public issuedAt;

    /// @notice How many passes have been issued.
    uint256 public totalIssued;

    /// @notice A pass was issued to `wallet`. `number` counts passes from 1.
    event PassIssued(address indexed wallet, uint256 indexed number, uint256 time);

    constructor(address agentId_) {
        require(agentId_.code.length > 0, "FlashPass: Agent ID address has no code");
        agentId = IAgentId(agentId_);
    }

    /// @notice Issue a pass to the calling wallet. Free: only the network fee.
    function claim() external {
        _issue(msg.sender);
    }

    /// @notice True if `wallet` has a pass.
    function hasPass(address wallet) external view returns (bool) {
        return issuedAt[wallet] != 0;
    }

    /// @notice True if `wallet` has a pass and still holds an Agent ID.
    function isActive(address wallet) external view returns (bool) {
        return issuedAt[wallet] != 0 && agentId.balanceOf(wallet) > 0;
    }

    function _issue(address wallet) private {
        require(issuedAt[wallet] == 0, "FlashPass: this wallet already has a pass");
        require(agentId.balanceOf(wallet) > 0, "FlashPass: this wallet has no Agent ID");
        issuedAt[wallet] = block.timestamp;
        uint256 number = ++totalIssued;
        emit PassIssued(wallet, number, block.timestamp);
    }
}
