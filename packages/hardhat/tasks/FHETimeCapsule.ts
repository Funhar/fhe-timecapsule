import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

/**
 * FHETimeCapsule Hardhat Tasks
 * =============================
 *
 * Tutorial: Deploy and Interact Locally (--network localhost)
 * ===========================================================
 *
 * 1. From a separate terminal window:
 *   npx hardhat node
 *
 * 2. Deploy the FHETimeCapsule contract
 *   npx hardhat --network localhost deploy
 *
 * 3. Interact with the FHETimeCapsule contract
 *   npx hardhat --network localhost task:timecapsule-address
 *   npx hardhat --network localhost task:create-capsule --message "Hello Future!" --unlocktime 1735689600
 *   npx hardhat --network localhost task:get-capsule --id 1
 *   npx hardhat --network localhost task:list-user-capsules --user 0x...
 *
 *
 * Tutorial: Deploy and Interact on Sepolia (--network sepolia)
 * ===========================================================
 *
 * 1. Deploy the FHETimeCapsule contract
 *   npx hardhat --network sepolia deploy
 *
 * 2. Interact with the FHETimeCapsule contract
 *   npx hardhat --network sepolia task:timecapsule-address
 *   npx hardhat --network sepolia task:create-capsule --message "Hello Future!" --unlocktime 1735689600
 *   npx hardhat --network sepolia task:get-capsule --id 1
 */

/**
 * Get FHETimeCapsule contract address
 * Example:
 *   - npx hardhat --network localhost task:timecapsule-address
 *   - npx hardhat --network sepolia task:timecapsule-address
 */
task("task:timecapsule-address", "Prints the FHETimeCapsule contract address")
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    const { deployments } = hre;
    const timeCapsule = await deployments.get("FHETimeCapsule");
    console.log("FHETimeCapsule address is " + timeCapsule.address);
  });

/**
 * Create a new time capsule
 * Example:
 *   - npx hardhat --network localhost task:create-capsule --message "Hello Future!" --unlocktime 1735689600
 *   - npx hardhat --network sepolia task:create-capsule --message "Hello Future!" --unlocktime 1735689600
 */
task("task:create-capsule", "Creates a new time capsule")
  .addParam("message", "The message to encrypt and store")
  .addParam("unlocktime", "Unix timestamp for when to unlock the capsule")
  .addOptionalParam("address", "Optionally specify the FHETimeCapsule contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const message = taskArguments.message;
    const unlockTime = parseInt(taskArguments.unlocktime);

    if (!message || message.trim() === "") {
      throw new Error("Message cannot be empty");
    }

    if (!Number.isInteger(unlockTime) || unlockTime <= Date.now() / 1000) {
      throw new Error("Unlock time must be a future timestamp");
    }

    const FHETimeCapsuleDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("FHETimeCapsule");

    console.log(`FHETimeCapsule: ${FHETimeCapsuleDeployment.address}`);

    const signers = await ethers.getSigners();
    const timeCapsuleContract = await ethers.getContractAt("FHETimeCapsule", FHETimeCapsuleDeployment.address);

    // Convert message to bytes
    const messageBytes = ethers.toUtf8Bytes(message);

    console.log(`Creating time capsule...`);
    console.log(`Message: "${message}"`);
    console.log(`Message (hex): ${ethers.hexlify(messageBytes)}`);
    console.log(`Unlock time: ${new Date(unlockTime * 1000).toISOString()}`);

    const tx = await timeCapsuleContract.connect(signers[0]).createTimeCapsule(messageBytes, unlockTime);
    console.log(`Transaction hash: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt?.blockNumber}`);

    // Get the capsule ID from events
    const event = receipt?.logs.find(log => {
      try {
        const parsedLog = timeCapsuleContract.interface.parseLog(log);
        return parsedLog?.name === "CapsuleCreated";
      } catch {
        return false;
      }
    });

    if (event) {
      const parsedEvent = timeCapsuleContract.interface.parseLog(event);
      console.log(`✅ Time capsule created successfully!`);
      console.log(`Capsule ID: ${parsedEvent.args[0]}`);
    }
  });

/**
 * Cancel a time capsule
 * Example:
 *   - npx hardhat --network localhost task:cancel-capsule --id 1
 *   - npx hardhat --network sepolia task:cancel-capsule --id 1
 */
task("task:cancel-capsule", "Cancels a time capsule (only creator can cancel)")
  .addParam("id", "The capsule ID to cancel")
  .addOptionalParam("address", "Optionally specify the FHETimeCapsule contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const capsuleId = parseInt(taskArguments.id);
    if (!Number.isInteger(capsuleId) || capsuleId <= 0) {
      throw new Error("Capsule ID must be a positive integer");
    }

    const FHETimeCapsuleDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("FHETimeCapsule");

    console.log(`FHETimeCapsule: ${FHETimeCapsuleDeployment.address}`);

    const signers = await ethers.getSigners();
    const timeCapsuleContract = await ethers.getContractAt("FHETimeCapsule", FHETimeCapsuleDeployment.address);

    console.log(`Cancelling capsule ID: ${capsuleId}`);

    const tx = await timeCapsuleContract.connect(signers[0]).cancelTimeCapsule(capsuleId);
    console.log(`Transaction hash: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt?.blockNumber}`);

    console.log(`✅ Capsule ${capsuleId} cancelled successfully!`);
  });

/**
 * Manually open a time capsule
 * Example:
 *   - npx hardhat --network localhost task:open-capsule --id 1
 *   - npx hardhat --network sepolia task:open-capsule --id 1
 */
task("task:open-capsule", "Manually opens a time capsule")
  .addParam("id", "The capsule ID to open")
  .addOptionalParam("address", "Optionally specify the FHETimeCapsule contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const capsuleId = parseInt(taskArguments.id);
    if (!Number.isInteger(capsuleId) || capsuleId <= 0) {
      throw new Error("Capsule ID must be a positive integer");
    }

    const FHETimeCapsuleDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("FHETimeCapsule");

    console.log(`FHETimeCapsule: ${FHETimeCapsuleDeployment.address}`);

    const signers = await ethers.getSigners();
    const timeCapsuleContract = await ethers.getContractAt("FHETimeCapsule", FHETimeCapsuleDeployment.address);

    console.log(`Opening capsule ID: ${capsuleId}`);

    const tx = await timeCapsuleContract.connect(signers[0]).openTimeCapsule(capsuleId);
    console.log(`Transaction hash: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt?.blockNumber}`);

    console.log(`✅ Capsule ${capsuleId} opened successfully!`);
  });

/**
 * Get time capsule information
 * Example:
 *   - npx hardhat --network localhost task:get-capsule --id 1
 *   - npx hardhat --network sepolia task:get-capsule --id 1
 */
task("task:get-capsule", "Gets information about a specific time capsule")
  .addParam("id", "The capsule ID to query")
  .addOptionalParam("address", "Optionally specify the FHETimeCapsule contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const capsuleId = parseInt(taskArguments.id);
    if (!Number.isInteger(capsuleId) || capsuleId <= 0) {
      throw new Error("Capsule ID must be a positive integer");
    }

    const FHETimeCapsuleDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("FHETimeCapsule");

    console.log(`FHETimeCapsule: ${FHETimeCapsuleDeployment.address}`);

    const timeCapsuleContract = await ethers.getContractAt("FHETimeCapsule", FHETimeCapsuleDeployment.address);

    const capsuleInfo = await timeCapsuleContract.getTimeCapsule(capsuleId);

    console.log(`\n=== Capsule ${capsuleId} Information ===`);
    console.log(`Creator: ${capsuleInfo[0]}`);
    console.log(`Unlock Time: ${new Date(Number(capsuleInfo[1]) * 1000).toISOString()}`);
    console.log(`Is Active: ${capsuleInfo[2]}`);
    console.log(`Is Unlocked: ${capsuleInfo[3]}`);
    console.log(`Encrypted Message: ${ethers.hexlify(capsuleInfo[4])}`);

    const currentTime = Math.floor(Date.now() / 1000);
    const unlockTime = Number(capsuleInfo[1]);
    const isExpired = currentTime >= unlockTime;

    console.log(`Current Time: ${new Date(currentTime * 1000).toISOString()}`);
    console.log(`Status: ${isExpired ? "EXPIRED" : "WAITING"}`);
  });

/**
 * List all capsules for a specific user
 * Example:
 *   - npx hardhat --network localhost task:list-user-capsules --user 0x...
 *   - npx hardhat --network sepolia task:list-user-capsules --user 0x...
 */
task("task:list-user-capsules", "Lists all capsules for a specific user")
  .addParam("user", "The user's address")
  .addOptionalParam("address", "Optionally specify the FHETimeCapsule contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const userAddress = taskArguments.user;
    if (!ethers.isAddress(userAddress)) {
      throw new Error("Invalid user address");
    }

    const FHETimeCapsuleDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("FHETimeCapsule");

    console.log(`FHETimeCapsule: ${FHETimeCapsuleDeployment.address}`);

    const timeCapsuleContract = await ethers.getContractAt("FHETimeCapsule", FHETimeCapsuleDeployment.address);

    const userCapsules = await timeCapsuleContract.getUserCapsules(userAddress);

    console.log(`\n=== Capsules for ${userAddress} ===`);
    console.log(`Total capsules: ${userCapsules.length}`);

    if (userCapsules.length === 0) {
      console.log("No capsules found for this user.");
      return;
    }

    for (let i = 0; i < userCapsules.length; i++) {
      const capsuleId = Number(userCapsules[i]);
      const capsuleInfo = await timeCapsuleContract.getTimeCapsule(capsuleId);

      const unlockTime = new Date(Number(capsuleInfo[1]) * 1000);
      const currentTime = new Date();
      const isExpired = currentTime >= unlockTime;

      console.log(`\n[${i + 1}] Capsule ID: ${capsuleId}`);
      console.log(`   Unlock Time: ${unlockTime.toISOString()}`);
      console.log(`   Status: ${capsuleInfo[2] ? (isExpired ? "EXPIRED" : "ACTIVE") : "CANCELLED"}`);
      console.log(`   Unlocked: ${capsuleInfo[3] ? "YES" : "NO"}`);
    }
  });

/**
 * Open expired capsules (for testing purposes)
 * Example:
 *   - npx hardhat --network localhost task:open-expired-capsules
 *   - npx hardhat --network sepolia task:open-expired-capsules
 */
task("task:open-expired-capsules", "Opens all expired time capsules")
  .addOptionalParam("address", "Optionally specify the FHETimeCapsule contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const FHETimeCapsuleDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("FHETimeCapsule");

    console.log(`FHETimeCapsule: ${FHETimeCapsuleDeployment.address}`);

    const signers = await ethers.getSigners();
    const timeCapsuleContract = await ethers.getContractAt("FHETimeCapsule", FHETimeCapsuleDeployment.address);

    // Get expired capsules count
    const expiredCount = await timeCapsuleContract.getExpiredCapsulesCount();
    console.log(`Found ${expiredCount} expired capsules`);

    if (expiredCount === 0) {
      console.log("No expired capsules to open.");
      return;
    }

    console.log(`Opening expired capsules...`);

    const tx = await timeCapsuleContract.connect(signers[0]).performUpkeep("0x");
    console.log(`Transaction hash: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt?.blockNumber}`);

    console.log(`✅ Expired capsules opened successfully!`);
  });

/**
 * Get total statistics
 * Example:
 *   - npx hardhat --network localhost task:stats
 *   - npx hardhat --network sepolia task:stats
 */
task("task:stats", "Shows FHETimeCapsule statistics")
  .addOptionalParam("address", "Optionally specify the FHETimeCapsule contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const FHETimeCapsuleDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("FHETimeCapsule");

    console.log(`FHETimeCapsule: ${FHETimeCapsuleDeployment.address}`);

    const timeCapsuleContract = await ethers.getContractAt("FHETimeCapsule", FHETimeCapsuleDeployment.address);

    const totalCapsules = await timeCapsuleContract.getTotalCapsules();
    const expiredCount = await timeCapsuleContract.getExpiredCapsulesCount();

    console.log(`\n=== FHETimeCapsule Statistics ===`);
    console.log(`Total Capsules Created: ${totalCapsules}`);
    console.log(`Expired Capsules: ${expiredCount}`);
    console.log(`Active Capsules: ${totalCapsules - expiredCount}`);
  });
