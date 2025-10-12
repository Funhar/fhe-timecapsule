import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

import type { FHETimeCapsule } from "../types/contracts/FHETimeCapsule";

// Reusable bundle for encrypted message and unlock time parameters needed by createTimeCapsule.
type CapsuleEncryptionArgs = {
  encryptedMessage: string[];
  messageProofs: string[];
  unlockHandle: string;
  unlockProof: string;
};

// Common actors used across fixtures so we can re-share signer state.
type DeployedFixture = {
  contract: FHETimeCapsule;
  contractAddress: string;
  creator: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  charlie: HardhatEthersSigner;
};

// Encrypt a uint256 chunk and surface both handle/proof pairs required by the contract.
async function encryptUint256(
  value: bigint,
  contractAddress: string,
  signer: HardhatEthersSigner,
): Promise<{ handle: string; proof: string }> {
  const input = hre.fhevm.createEncryptedInput(contractAddress, signer.address);
  input.add256(value);
  const { handles, inputProof } = await input.encrypt();
  return {
    handle: ethers.hexlify(handles[0]),
    proof: ethers.hexlify(inputProof),
  };
}

// Encrypt a uint64 unlock timestamp, mirroring the helper above for message chunks.
async function encryptUint64(
  value: number | bigint,
  contractAddress: string,
  signer: HardhatEthersSigner,
): Promise<{ handle: string; proof: string }> {
  const input = hre.fhevm.createEncryptedInput(contractAddress, signer.address);
  input.add64(value);
  const { handles, inputProof } = await input.encrypt();
  return {
    handle: ethers.hexlify(handles[0]),
    proof: ethers.hexlify(inputProof),
  };
}

// Collect encrypted payload plus proofs for both the message chunks and unlock time in one call.
async function prepareCapsuleEncryptionArgs(
  contractAddress: string,
  signer: HardhatEthersSigner,
  messageChunks: bigint[],
  unlockTime: number,
): Promise<CapsuleEncryptionArgs> {
  const encryptedMessage: string[] = [];
  const messageProofs: string[] = [];

  for (const chunk of messageChunks) {
    const { handle, proof } = await encryptUint256(chunk, contractAddress, signer);
    encryptedMessage.push(handle);
    messageProofs.push(proof);
  }

  const unlockEncryption = await encryptUint64(unlockTime, contractAddress, signer);

  return {
    encryptedMessage,
    messageProofs,
    unlockHandle: unlockEncryption.handle,
    unlockProof: unlockEncryption.proof,
  };
}

// Base fixture: deploy contract and ensure the FHE coprocessor is ready for subsequent calls.
async function deployFixture(): Promise<DeployedFixture> {
  const [creator, bob, charlie] = await hre.ethers.getSigners();
  const factory = await hre.ethers.getContractFactory("FHETimeCapsule");
  const contract = (await factory.connect(creator).deploy()) as unknown as FHETimeCapsule;
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  await hre.fhevm.assertCoprocessorInitialized(contract, "FHETimeCapsule");

  return { contract, contractAddress, creator, bob, charlie };
}

// Fixture: deploy and create a capsule that remains active (not yet unlocked or cancelled).
async function createdCapsuleFixture() {
  const base = await deployFixture();
  const unlockTime = (await time.latest()) + 3600;
  const messageChunks = [101n, 202n, 303n];
  const args = await prepareCapsuleEncryptionArgs(base.contractAddress, base.creator, messageChunks, unlockTime);
  const capsuleId = await base.contract.nextCapsuleId();

  await base.contract
    .connect(base.creator)
    .createTimeCapsule(args.encryptedMessage, args.messageProofs, args.unlockHandle, args.unlockProof, unlockTime);

  return { ...base, capsuleId, messageChunks, unlockTime };
}

// Fixture: deploy, create, and fast-forward to a capsule that has already been opened.
async function openedCapsuleFixture() {
  const { contract, contractAddress, creator, bob, charlie } = await deployFixture();
  const unlockTime = (await time.latest()) + 180;
  const messageChunks = [42n, 1337n];
  const args = await prepareCapsuleEncryptionArgs(contractAddress, creator, messageChunks, unlockTime);
  const capsuleId = await contract.nextCapsuleId();

  await contract
    .connect(creator)
    .createTimeCapsule(args.encryptedMessage, args.messageProofs, args.unlockHandle, args.unlockProof, unlockTime);

  await time.increaseTo(unlockTime);
  await contract.connect(bob).openTimeCapsule(capsuleId);

  return { contract, contractAddress, creator, bob, charlie, capsuleId, messageChunks, unlockTime };
}

describe("FHETimeCapsule", function () {
  // Validates the happy path: capsule creation exposes expected plaintext + encrypted metadata helpers.
  it("creates a capsule with encrypted payload and exposes metadata helpers", async function () {
    const { contract, creator, capsuleId, messageChunks, unlockTime } = await loadFixture(createdCapsuleFixture);

    const info = await contract.getTimeCapsule(capsuleId);
    expect(info.creator).to.equal(creator.address);
    expect(info.unlockTimestamp).to.equal(BigInt(unlockTime));
    expect(info.isActive).to.equal(true);
    expect(info.isUnlocked).to.equal(false);
    expect(info.messageLength).to.equal(BigInt(messageChunks.length));

    expect(await contract.nextCapsuleId()).to.equal(capsuleId + 1n);
    expect(await contract.getTotalCapsules()).to.equal(capsuleId);

    const userCapsules = await contract.getUserCapsules(creator.address);
    expect(userCapsules).to.deep.equal([capsuleId]);

    const activeCapsules = await contract.getActiveCapsulesByUser(creator.address);
    expect(activeCapsules).to.deep.equal([capsuleId]);

    const encryptedMessage = await contract.getEncryptedMessage(capsuleId);
    expect(encryptedMessage).to.have.lengthOf(messageChunks.length);
    encryptedMessage.forEach(handle => expect(handle).to.match(/^0x[0-9a-f]{64}$/i));

    const metadata = await contract.getEncryptedCapsuleMetadata(capsuleId);
    expect(metadata.encryptedCreator).to.match(/^0x[0-9a-f]{64}$/i);
    expect(metadata.encryptedUnlockTime).to.match(/^0x[0-9a-f]{64}$/i);
    expect(metadata.encryptedIsActive).to.match(/^0x[0-9a-f]{64}$/i);
    expect(metadata.encryptedIsUnlocked).to.match(/^0x[0-9a-f]{64}$/i);
  });

  // Ensure the contract enforces the critical create-time validation checks.
  it("rejects capsule creation for invalid inputs", async function () {
    const { contract, contractAddress, creator } = await loadFixture(deployFixture);
    const unlockTime = (await time.latest()) + 120;

    const withEmptyMessage = await prepareCapsuleEncryptionArgs(contractAddress, creator, [], unlockTime);
    await expect(
      contract
        .connect(creator)
        .createTimeCapsule(
          withEmptyMessage.encryptedMessage,
          withEmptyMessage.messageProofs,
          withEmptyMessage.unlockHandle,
          withEmptyMessage.unlockProof,
          unlockTime,
        ),
    ).to.be.revertedWith("Encrypted message required");

    const messageChunks = [555n];
    const args = await prepareCapsuleEncryptionArgs(contractAddress, creator, messageChunks, unlockTime);
    args.messageProofs.pop();
    await expect(
      contract
        .connect(creator)
        .createTimeCapsule(args.encryptedMessage, args.messageProofs, args.unlockHandle, args.unlockProof, unlockTime),
    ).to.be.revertedWith("Message proof mismatch");

    const pastUnlockTime = await time.latest();
    const pastArgs = await prepareCapsuleEncryptionArgs(contractAddress, creator, messageChunks, pastUnlockTime);
    await expect(
      contract
        .connect(creator)
        .createTimeCapsule(
          pastArgs.encryptedMessage,
          pastArgs.messageProofs,
          pastArgs.unlockHandle,
          pastArgs.unlockProof,
          pastUnlockTime,
        ),
    ).to.be.revertedWith("Unlock time must be in the future");
  });

  // Only the creator should cancel, and cancellation must be a single-shot operation.
  it("allows only the creator to cancel an active capsule", async function () {
    const { contract, creator, bob, capsuleId } = await loadFixture(createdCapsuleFixture);

    await expect(contract.connect(bob).cancelTimeCapsule(capsuleId)).to.be.revertedWith("Only creator can cancel");

    await expect(contract.connect(creator).cancelTimeCapsule(capsuleId))
      .to.emit(contract, "CapsuleCancelled")
      .withArgs(capsuleId, creator.address);

    const info = await contract.getTimeCapsule(capsuleId);
    expect(info.isActive).to.equal(false);

    await expect(contract.connect(creator).cancelTimeCapsule(capsuleId)).to.be.revertedWith("Capsule is not active");
  });

  // Opening the capsule toggles its flags, removes it from expired count, and grants decryption access.
  it("opens a capsule once the unlock time arrives and updates bookkeeping", async function () {
    const { contract, contractAddress, creator, bob } = await loadFixture(deployFixture);
    const unlockTime = (await time.latest()) + 240;
    const messageChunks = [88n, 99n];
    const args = await prepareCapsuleEncryptionArgs(contractAddress, creator, messageChunks, unlockTime);
    const capsuleId = await contract.nextCapsuleId();

    await contract
      .connect(creator)
      .createTimeCapsule(args.encryptedMessage, args.messageProofs, args.unlockHandle, args.unlockProof, unlockTime);

    await expect(contract.connect(bob).openTimeCapsule(capsuleId)).to.be.revertedWith("Unlock time has not arrived");

    await time.increaseTo(unlockTime);
    expect(await contract.getExpiredCapsulesCount()).to.equal(1n);

    await expect(contract.connect(bob).openTimeCapsule(capsuleId))
      .to.emit(contract, "CapsuleUnlocked")
      .withArgs(capsuleId, creator.address);

    const info = await contract.getTimeCapsule(capsuleId);
    expect(info.isActive).to.equal(false);
    expect(info.isUnlocked).to.equal(true);
    expect(await contract.getExpiredCapsulesCount()).to.equal(0n);

    const encryptedMessage = await contract.getEncryptedMessage(capsuleId);
    await hre.fhevm.awaitDecryptionOracle();
    const decrypted = await hre.fhevm.userDecryptEuint(
      FhevmType.euint256,
      encryptedMessage[0],
      contractAddress,
      bob,
    );
    expect(decrypted).to.equal(messageChunks[0]);
  });

  // After unlocking, the creator can extend FHE permissions to new recipients and they can decrypt.
  it("only allows sharing decryption rights after unlocking", async function () {
    const { contract, contractAddress, creator, bob, charlie, capsuleId, messageChunks } =
      await loadFixture(openedCapsuleFixture);

    await expect(contract.connect(bob).grantDecryptionAccess(capsuleId, charlie.address)).to.be.revertedWith(
      "Only creator can share",
    );

    await expect(
      contract.connect(creator).grantDecryptionAccess(capsuleId, ethers.ZeroAddress),
    ).to.be.revertedWith("Invalid recipient");

    await expect(contract.connect(creator).grantDecryptionAccess(capsuleId, charlie.address))
      .to.emit(contract, "CapsuleEncryptionGranted")
      .withArgs(capsuleId, charlie.address, anyValue, anyValue, anyValue, anyValue, anyValue);

    await hre.fhevm.awaitDecryptionOracle();
    const encryptedMessage = await contract.getEncryptedMessage(capsuleId);
    const decrypted = await hre.fhevm.userDecryptEuint(
      FhevmType.euint256,
      encryptedMessage[0],
      contractAddress,
      charlie,
    );
    expect(decrypted).to.equal(messageChunks[0]);
  });

  // Before unlock, attempts to grant permissions should be rejected to protect confidentiality.
  it("blocks decryption sharing before unlock", async function () {
    const { contract, contractAddress, creator, bob } = await loadFixture(deployFixture);
    const unlockTime = (await time.latest()) + 720;
    const messageChunks = [77n];
    const args = await prepareCapsuleEncryptionArgs(contractAddress, creator, messageChunks, unlockTime);
    const capsuleId = await contract.nextCapsuleId();

    await contract
      .connect(creator)
      .createTimeCapsule(args.encryptedMessage, args.messageProofs, args.unlockHandle, args.unlockProof, unlockTime);

    await expect(contract.connect(creator).grantDecryptionAccess(capsuleId, bob.address)).to.be.revertedWith(
      "Capsule not unlocked",
    );
  });
});
