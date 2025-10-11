import { wagmiConnectors } from "./wagmiConnectors";
import { Chain, createClient, fallback, http } from "viem";
import { hardhat } from "viem/chains";
import { createConfig } from "wagmi";
import scaffoldConfig, { ScaffoldConfig } from "~~/scaffold.config";
import { getAlchemyHttpUrl } from "~~/utils/helper";

const { targetNetworks } = scaffoldConfig;

export const enabledChains = targetNetworks;

export const wagmiConfig = createConfig({
  chains: enabledChains,
  connectors: wagmiConnectors(),
  ssr: true,
  client: ({ chain }) => {
    const rpcTransports: ReturnType<typeof http>[] = [];

    const rpcOverrideUrl = (scaffoldConfig.rpcOverrides as ScaffoldConfig["rpcOverrides"])?.[chain.id];
    if (rpcOverrideUrl) {
      rpcTransports.push(http(rpcOverrideUrl));
    } else {
      const alchemyHttpUrl = getAlchemyHttpUrl(chain.id);
      if (alchemyHttpUrl) {
        rpcTransports.push(http(alchemyHttpUrl));
      }
    }

    if (rpcTransports.length === 0) {
      const defaultRpcUrls = chain.rpcUrls?.default?.http ?? [];
      for (const url of defaultRpcUrls) {
        rpcTransports.push(http(url));
      }
    }

    if (rpcTransports.length === 0) {
      rpcTransports.push(http());
    }

    return createClient({
      chain,
      transport: rpcTransports.length === 1 ? rpcTransports[0] : fallback(rpcTransports),
      ...(chain.id !== (hardhat as Chain).id ? { pollingInterval: scaffoldConfig.pollingInterval } : {}),
    });
  },
});
