"use client";

import { useEffect, useMemo, useRef } from "react";
import { ethers } from "ethers";
import { useAccount, useWalletClient } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";

export const useWagmiEthers = (initialMockChains?: Readonly<Record<number, string>>) => {
  const { address, isConnected, chain } = useAccount();
  const { data: walletClient } = useWalletClient();

  const chainId = chain?.id ?? walletClient?.chain?.id;
  const accounts = address ? [address] : undefined;

  const eip1193Provider = useMemo(() => {
    if (!walletClient) return undefined;

    return {
      request: async (args: any) => {
        return await walletClient.request(args);
      },
      on: () => {
        console.log("Provider events not fully implemented for wagmi");
      },
      removeListener: () => {
        console.log("Provider removeListener not fully implemented for wagmi");
      },
    } as ethers.Eip1193Provider;
  }, [walletClient]);

  const ethersProvider = useMemo(() => {
    if (!eip1193Provider) return undefined;
    return new ethers.BrowserProvider(eip1193Provider);
  }, [eip1193Provider]);

  const fallbackRpcUrl = useMemo(() => {
    const overrides = (scaffoldConfig.rpcOverrides ?? {}) as Record<number, string>;
    if (chainId && overrides[chainId]) {
      return overrides[chainId];
    }
    if (chainId && initialMockChains && initialMockChains[chainId]) {
      return initialMockChains[chainId];
    }
    const defaultNetwork = scaffoldConfig.targetNetworks[0];
    if (defaultNetwork) {
      if (overrides[defaultNetwork.id]) {
        return overrides[defaultNetwork.id];
      }
      if (initialMockChains && initialMockChains[defaultNetwork.id]) {
        return initialMockChains[defaultNetwork.id];
      }
    }
    return undefined;
  }, [chainId, initialMockChains]);

  const ethersReadonlyProvider = useMemo(() => {
    if (fallbackRpcUrl) {
      return new ethers.JsonRpcProvider(fallbackRpcUrl);
    }
    return ethersProvider;
  }, [ethersProvider, fallbackRpcUrl]);

  const ethersSigner = useMemo(() => {
    if (!ethersProvider || !address) return undefined;
    return new ethers.JsonRpcSigner(ethersProvider, address);
  }, [ethersProvider, address]);

  // Stable refs consumers can reuse
  const ropRef = useRef<typeof ethersReadonlyProvider>(ethersReadonlyProvider);
  const chainIdRef = useRef<number | undefined>(chainId);

  useEffect(() => {
    ropRef.current = ethersReadonlyProvider;
  }, [ethersReadonlyProvider]);

  useEffect(() => {
    chainIdRef.current = chainId;
  }, [chainId]);

  return {
    chainId,
    accounts,
    isConnected,
    ethersProvider,
    ethersReadonlyProvider,
    ethersSigner,
    eip1193Provider,
    ropRef,
    chainIdRef,
  } as const;
};
