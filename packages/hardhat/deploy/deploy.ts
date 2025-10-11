import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Deploy FHETimeCapsule contract
  const deployedFHETimeCapsule = await deploy("FHETimeCapsule", {
    from: deployer,
    log: true,
  });

  console.log(`FHETimeCapsule contract: `, deployedFHETimeCapsule.address);
};

export default func;
func.id = "deploy_contracts"; // id required to prevent reexecution
func.tags = ["FHETimeCapsule"];
