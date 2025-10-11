// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    FHE,
    ebool,
    eaddress,
    euint64,
    euint256,
    externalEuint64,
    externalEuint256
} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title FHETimeCapsule
 * @notice Encrypted time capsule contract that stores every critical field with Fully Homomorphic Encryption (FHE).
 * Users upload ciphertext handles for their message and unlock time; the contract only ever manipulates ciphertexts.
 * When a capsule unlocks, the encrypted payload is explicitly shared through FHE permissions instead of hashes.
 */
contract FHETimeCapsule is SepoliaConfig {
    /// @notice Structure representing a time capsule with both plaintext control flags and encrypted mirrors.
    struct TimeCapsule {
        euint256[] encryptedMessage; // Message chunks as encrypted uint256 values
        euint64 encryptedUnlockTime; // Unlock timestamp (encrypted)
        ebool encryptedIsActive; // Active state mirrored as encrypted boolean
        ebool encryptedIsUnlocked; // Unlock state mirrored as encrypted boolean
        eaddress encryptedCreator; // Creator address (encrypted)

        address creator; // Creator's wallet address (plaintext for bookkeeping)
        uint256 unlockTime; // Unlock timestamp (plaintext for scheduling)
        bool isActive; // Capsule activity flag (plaintext for require checks)
        bool isUnlocked; // Capsule unlock flag (plaintext for require checks)
    }

    /// @notice Mapping of capsule ID to TimeCapsule struct
    mapping(uint256 => TimeCapsule) private timeCapsules;

    /// @notice Mapping of user address to their capsule IDs
    mapping(address => uint256[]) private userCapsules;

    /// @notice Next available capsule ID
    uint256 public nextCapsuleId = 1;

    /// @notice Events
    event CapsuleCreated(uint256 indexed capsuleId, address indexed creator, uint256 unlockTime);
    event CapsuleUnlocked(uint256 indexed capsuleId, address indexed creator);
    event CapsuleCancelled(uint256 indexed capsuleId, address indexed creator);
    event CapsuleEncryptionGranted(
        uint256 indexed capsuleId,
        address indexed recipient,
        bytes32 creatorHandle,
        bytes32 unlockTimeHandle,
        bytes32 isActiveHandle,
        bytes32 isUnlockedHandle,
        bytes32[] messageHandles
    );

    /// @notice Create a new time capsule with encrypted payload
    /// @param encryptedMessageChunks Ciphertext handles representing the message (each chunk is encrypted off-chain)
    /// @param messageProofs Groth16 proofs accompanying each encrypted chunk
    /// @param encryptedUnlockTimeHandle Ciphertext handle for the unlock timestamp
    /// @param unlockTimeProof Groth16 proof that authorises the unlock timestamp ciphertext
    /// @param unlockTime Plain unlock timestamp for scheduling (must match the encrypted value used off-chain)
    /// @return capsuleId The ID of the created capsule
    function createTimeCapsule(
        externalEuint256[] calldata encryptedMessageChunks,
        bytes[] calldata messageProofs,
        externalEuint64 encryptedUnlockTimeHandle,
        bytes calldata unlockTimeProof,
        uint256 unlockTime
    ) external returns (uint256 capsuleId) {
        require(encryptedMessageChunks.length > 0, "Encrypted message required");
        require(encryptedMessageChunks.length == messageProofs.length, "Message proof mismatch");
        require(unlockTime > block.timestamp, "Unlock time must be in the future");

        capsuleId = nextCapsuleId++;

        TimeCapsule storage capsule = timeCapsules[capsuleId];
        capsule.creator = msg.sender;
        capsule.encryptedCreator = FHE.asEaddress(msg.sender);
        FHE.allowThis(capsule.encryptedCreator);
        capsule.unlockTime = unlockTime;
        capsule.encryptedUnlockTime = FHE.fromExternal(encryptedUnlockTimeHandle, unlockTimeProof);
        FHE.allowThis(capsule.encryptedUnlockTime);
        capsule.isActive = true;
        capsule.isUnlocked = false;
        capsule.encryptedIsActive = FHE.asEbool(true);
        capsule.encryptedIsUnlocked = FHE.asEbool(false);
        FHE.allowThis(capsule.encryptedIsActive);
        FHE.allowThis(capsule.encryptedIsUnlocked);

        for (uint256 i = 0; i < encryptedMessageChunks.length; i++) {
            euint256 chunk = FHE.fromExternal(encryptedMessageChunks[i], messageProofs[i]);
            FHE.allowThis(chunk);
            capsule.encryptedMessage.push(chunk);
        }

        userCapsules[msg.sender].push(capsuleId);

        emit CapsuleCreated(capsuleId, msg.sender, unlockTime);
    }

    /// @notice Cancel a time capsule (only creator can cancel)
    /// @param capsuleId The ID of the capsule to cancel
    function cancelTimeCapsule(uint256 capsuleId) external {
        TimeCapsule storage capsule = timeCapsules[capsuleId];
        require(capsule.creator == msg.sender, "Only creator can cancel");
        require(capsule.isActive, "Capsule is not active");
        require(!capsule.isUnlocked, "Capsule is already unlocked");

        capsule.isActive = false;
        capsule.encryptedIsActive = FHE.asEbool(false);

        emit CapsuleCancelled(capsuleId, msg.sender);
    }

    /// @notice Manually open a time capsule once the unlock time has arrived
    /// @param capsuleId The ID of the capsule to open
    function openTimeCapsule(uint256 capsuleId) external {
        TimeCapsule storage capsule = timeCapsules[capsuleId];
        require(capsule.isActive, "Capsule is not active");
        require(!capsule.isUnlocked, "Capsule is already unlocked");
        require(block.timestamp >= capsule.unlockTime, "Unlock time has not arrived");

        _openCapsule(capsuleId, msg.sender);
    }

    /// @notice Allow another address to decrypt an unlocked capsule through FHE permissions
    /// @param capsuleId The ID of the capsule
    /// @param recipient Address that should gain decryption rights
    function grantDecryptionAccess(uint256 capsuleId, address recipient) external {
        require(recipient != address(0), "Invalid recipient");

        TimeCapsule storage capsule = timeCapsules[capsuleId];
        require(capsule.isUnlocked, "Capsule not unlocked");
        require(capsule.creator == msg.sender, "Only creator can share");

        _allowCapsuleTo(capsuleId, recipient);
    }

    /// @notice Get capsule information (plaintext view)
    /// @param capsuleId The ID of the capsule
    /// @return creator The creator's address
    /// @return unlockTimestamp The unlock timestamp (plaintext)
    /// @return isActive Whether the capsule is active
    /// @return isUnlocked Whether the capsule is unlocked
    /// @return messageLength Number of encrypted message chunks
    function getTimeCapsule(
        uint256 capsuleId
    )
        external
        view
        returns (
            address creator,
            uint256 unlockTimestamp,
            bool isActive,
            bool isUnlocked,
            uint256 messageLength
        )
    {
        TimeCapsule storage capsule = timeCapsules[capsuleId];
        return (capsule.creator, capsule.unlockTime, capsule.isActive, capsule.isUnlocked, capsule.encryptedMessage.length);
    }

    /// @notice Fetch encrypted metadata for a capsule
    /// @param capsuleId The ID of the capsule
    /// @return encryptedCreator Creator address in encrypted form
    /// @return encryptedUnlockTime Unlock timestamp in encrypted form
    /// @return encryptedIsActive Encrypted active flag
    /// @return encryptedIsUnlocked Encrypted unlocked flag
    function getEncryptedCapsuleMetadata(
        uint256 capsuleId
    )
        external
        view
        returns (eaddress encryptedCreator, euint64 encryptedUnlockTime, ebool encryptedIsActive, ebool encryptedIsUnlocked)
    {
        TimeCapsule storage capsule = timeCapsules[capsuleId];
        return (
            capsule.encryptedCreator,
            capsule.encryptedUnlockTime,
            capsule.encryptedIsActive,
            capsule.encryptedIsUnlocked
        );
    }

    /// @notice Get encrypted message chunks for a capsule
    /// @param capsuleId The capsule identifier
    /// @return Array of encrypted message chunks
    function getEncryptedMessage(uint256 capsuleId) external view returns (euint256[] memory) {
        TimeCapsule storage capsule = timeCapsules[capsuleId];
        uint256 length = capsule.encryptedMessage.length;

        euint256[] memory chunks = new euint256[](length);
        for (uint256 i = 0; i < length; i++) {
            chunks[i] = capsule.encryptedMessage[i];
        }

        return chunks;
    }

    /// @notice Get all capsule IDs for a specific user
    /// @param user The user's address
    /// @return Array of capsule IDs belonging to the user
    function getUserCapsules(address user) external view returns (uint256[] memory) {
        return userCapsules[user];
    }

    /// @notice Get active capsules for a specific user
    /// @param user The user's address
    /// @return Array of active capsule IDs belonging to the user
    function getActiveCapsulesByUser(address user) external view returns (uint256[] memory) {
        uint256[] storage userCapsuleIds = userCapsules[user];
        uint256 activeCount = 0;

        for (uint256 i = 0; i < userCapsuleIds.length; i++) {
            if (timeCapsules[userCapsuleIds[i]].isActive) {
                activeCount++;
            }
        }

        uint256[] memory activeCapsules = new uint256[](activeCount);
        uint256 index = 0;

        for (uint256 i = 0; i < userCapsuleIds.length && index < activeCount; i++) {
            if (timeCapsules[userCapsuleIds[i]].isActive) {
                activeCapsules[index] = userCapsuleIds[i];
                index++;
            }
        }

        return activeCapsules;
    }

    /// @notice Get total number of capsules created
    /// @return The total count of capsules
    function getTotalCapsules() external view returns (uint256) {
        return nextCapsuleId - 1;
    }

    /// @notice Get expired but unopened capsules count based on plaintext timestamps
    /// @return The count of expired capsules
    function getExpiredCapsulesCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextCapsuleId; i++) {
            TimeCapsule storage capsule = timeCapsules[i];
            if (capsule.isActive && !capsule.isUnlocked && block.timestamp >= capsule.unlockTime) {
                count++;
            }
        }
        return count;
    }

    /// @notice Internal function to open a capsule and propagate FHE permissions
    /// @param capsuleId The ID of the capsule to open
    /// @param requestor Address that triggered the unlock
    function _openCapsule(uint256 capsuleId, address requestor) internal {
        TimeCapsule storage capsule = timeCapsules[capsuleId];

        capsule.isActive = false;
        capsule.isUnlocked = true;
        capsule.encryptedIsActive = FHE.asEbool(false);
        capsule.encryptedIsUnlocked = FHE.asEbool(true);

        _allowCapsuleTo(capsuleId, capsule.creator);

        if (requestor != capsule.creator) {
            _allowCapsuleTo(capsuleId, requestor);
        }

        emit CapsuleUnlocked(capsuleId, capsule.creator);
    }

    /// @notice Internal helper that grants FHE decryption permission for a capsule to a recipient
    /// @param capsuleId Capsule identifier
    /// @param recipient Address receiving decryption rights
    function _allowCapsuleTo(uint256 capsuleId, address recipient) internal {
        TimeCapsule storage capsule = timeCapsules[capsuleId];

        bytes32[] memory messageHandles = new bytes32[](capsule.encryptedMessage.length);

        FHE.allow(capsule.encryptedCreator, recipient);
        FHE.allow(capsule.encryptedUnlockTime, recipient);
        FHE.allow(capsule.encryptedIsActive, recipient);
        FHE.allow(capsule.encryptedIsUnlocked, recipient);
        for (uint256 i = 0; i < capsule.encryptedMessage.length; i++) {
            FHE.allow(capsule.encryptedMessage[i], recipient);
            messageHandles[i] = euint256.unwrap(capsule.encryptedMessage[i]);
        }

        emit CapsuleEncryptionGranted(
            capsuleId,
            recipient,
            eaddress.unwrap(capsule.encryptedCreator),
            euint64.unwrap(capsule.encryptedUnlockTime),
            ebool.unwrap(capsule.encryptedIsActive),
            ebool.unwrap(capsule.encryptedIsUnlocked),
            messageHandles
        );
    }
}
