// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.8.17;

import {IERC20, SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {MerkleProof} from '@openzeppelin/contracts/utils/cryptography/MerkleProof.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';

error AlreadyClaimed();
error InvalidProof();

contract ColtMerkleDistributor is Ownable {
    using SafeERC20 for IERC20;

    // This event is triggered whenever a call to #claim succeeds.
    event Claimed(address account, uint256 amount);

    struct Claim {
        uint256 amount;
        uint256 lastClaim;
        uint256 claimRound;
    }

    bool public isClaimingOpen = false;
    address public token;
    bytes32 public merkleRoot;
    uint256 public claimTimelock = 30 days; // 30 days timelock for claiming

    // This is a packed array of booleans.
    mapping(address => Claim) public claimedAmount;

    constructor(address token_, bytes32 merkleRoot_) {
        token = token_;
        merkleRoot = merkleRoot_;
    }

    //function claim with timelock
    function claim(uint256 amount, bytes32[] calldata merkleProof) public {
        if (claimedAmount[msg.sender].amount == amount) revert AlreadyClaimed();
        require(
            claimedAmount[msg.sender].lastClaim + claimTimelock < block.timestamp,
            'MerkleDistributor: Claim not available yet'
        );
        require(isClaimingOpen, 'MerkleDistributor: Claiming is not open yet');
        // Verify the merkle proof.
        bytes32 node = keccak256(abi.encodePacked(msg.sender, amount));
        if (!MerkleProof.verify(merkleProof, merkleRoot, node)) revert InvalidProof();

        // Mark it claimed and send the token.
        uint256 amountToSend = (amount * 33) / 100;
        if (claimedAmount[msg.sender].claimRound == 2) amountToSend = ((amount * 34) / 100);

        claimedAmount[msg.sender].amount += amountToSend;
        claimedAmount[msg.sender].lastClaim = block.timestamp;
        claimedAmount[msg.sender].claimRound += 1;
        IERC20(token).safeTransfer(msg.sender, amountToSend);

        emit Claimed(msg.sender, amountToSend);
    }

    //function to set timelock
    function setClaimTimelock(uint256 _timelockInSeconds) external onlyOwner {
        claimTimelock = _timelockInSeconds;
    }

    //function to set merkle root
    function setMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        merkleRoot = _merkleRoot;
    }

    //function to toggle claiming
    function toggleClaiming() external onlyOwner {
        isClaimingOpen = !isClaimingOpen;
    }
}
