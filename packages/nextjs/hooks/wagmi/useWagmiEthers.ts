"use client";

import { useEffect, useMemo, useRef } from "react";
import { ethers } from "ethers";
import { useAccount, useWalletClient } from "wagmi";

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

  const ethersReadonlyProvider = useMemo(() => {
    if (!ethersProvider) return undefined;

    const rpcUrl = initialMockChains?.[chainId || 0];
    if (rpcUrl) {
      return new ethers.JsonRpcProvider(rpcUrl);
    }

    return ethersProvider;
  }, [ethersProvider, initialMockChains, chainId]);

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
