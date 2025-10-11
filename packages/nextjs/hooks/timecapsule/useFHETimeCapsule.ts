"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useWatchContractEvent } from "wagmi";
import { ethers } from "ethers";
import type { InterfaceAbi } from "ethers";
import type { Abi } from "viem";
import { FhevmDecryptionSignature, useFhevm, useFHEDecrypt, useFHEEncryption } from "fhevm-sdk";
import { useDeployedContractInfo } from "../helper";
import { useWagmiEthers } from "../wagmi/useWagmiEthers";
import type { Contract } from "~~/utils/helper/contract";
import type { AllowedChainIds } from "~~/utils/helper/networks";
import { LocalStorageStringStorage } from "~~/utils/storage/LocalStorageStringStorage";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const BYTES_PER_CHUNK = 32;
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

type CapsuleStatus = "active" | "pending" | "expired" | "unlocked" | "cancelled";

type CapsuleHandles = {
  creator: `0x${string}`;
  unlockTime: `0x${string}`;
  isActive: `0x${string}`;
  isUnlocked: `0x${string}`;
  message: `0x${string}`[];
};

export type CapsuleDetails = {
  id: number;
  creator: string;
  unlockTime: number;
  unlockDate: Date;
  isActive: boolean;
  isUnlocked: boolean;
  isExpired: boolean;
  messageChunkCount: number;
  decryptedMessage?: string;
  status: CapsuleStatus;
  isOwn: boolean;
  allowDecrypt: boolean;
  pendingManualDecrypt: boolean;
  handles: CapsuleHandles;
};

export type CapsuleStatistics = {
  totalCapsules: bigint;
  expiredCapsules: bigint;
  activeCapsules: bigint;
};

type DecryptRequest = { handle: `0x${string}`; contractAddress: `0x${string}` };

type UseFHETimeCapsuleParams = {
  initialMockChains?: Readonly<Record<number, string>>;
};

type WriteResult = {
  txHash?: string;
};

type WriteAction =
  | { type: "create"; message: string; unlockTime: number }
  | { type: "cancel"; capsuleId: number }
  | { type: "open"; capsuleId: number };

const toHex32 = (value: string | Uint8Array): `0x${string}` => {
  if (typeof value === "string") {
    return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
  }
  return ethers.hexlify(value) as `0x${string}`;
};

const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return BigInt(`0x${hex}`);
};

const encodeMessageToChunks = (message: string): bigint[] => {
  const messageBytes = textEncoder.encode(message);
  const prefixed = new Uint8Array(4 + messageBytes.length);
  const view = new DataView(prefixed.buffer);
  view.setUint32(0, messageBytes.length, false);
  prefixed.set(messageBytes, 4);

  const chunkCount = Math.ceil(prefixed.length / BYTES_PER_CHUNK);
  const chunks: bigint[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = new Uint8Array(BYTES_PER_CHUNK);
    const start = i * BYTES_PER_CHUNK;
    const end = Math.min(start + BYTES_PER_CHUNK, prefixed.length);
    if (start < prefixed.length) {
      chunk.set(prefixed.slice(start, end));
    }
    chunks.push(bytesToBigInt(chunk));
  }
  return chunks;
};

const concatUint8Arrays = (arrays: readonly Uint8Array[]): Uint8Array => {
  const totalLength = arrays.reduce((sum, current) => sum + current.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    merged.set(array, offset);
    offset += array.length;
  }
  return merged;
};

const valueToBytes32 = (value: string | bigint | boolean): Uint8Array | undefined => {
  if (typeof value === "boolean") {
    const bytes = new Uint8Array(BYTES_PER_CHUNK);
    bytes[BYTES_PER_CHUNK - 1] = value ? 1 : 0;
    return bytes;
  }

  if (typeof value === "bigint") {
    let hex = value.toString(16);
    if (hex.length % 2 !== 0) hex = `0${hex}`;
    hex = hex.slice(-BYTES_PER_CHUNK * 2);
    hex = hex.padStart(BYTES_PER_CHUNK * 2, "0");
    return ethers.getBytes(`0x${hex}`);
  }

  if (typeof value === "string") {
    const normalized = value.startsWith("0x") ? value : `0x${value}`;
    const bytes = ethers.getBytes(normalized);
    if (bytes.length === BYTES_PER_CHUNK) return bytes;
    if (bytes.length > BYTES_PER_CHUNK) {
      return bytes.slice(bytes.length - BYTES_PER_CHUNK);
    }
    const padded = new Uint8Array(BYTES_PER_CHUNK);
    padded.set(bytes, BYTES_PER_CHUNK - bytes.length);
    return padded;
  }

  return undefined;
};

const decodeMessageFromResults = (
  handles: readonly `0x${string}`[],
  results: Map<string, string | bigint | boolean>,
): string | undefined => {
  if (!handles.length) return undefined;

  const chunks: Uint8Array[] = [];
  for (const handle of handles) {
    const result = results.get(handle.toLowerCase());
    if (result === undefined) {
      return undefined;
    }
    const chunk = valueToBytes32(result);
    if (!chunk) {
      return undefined;
    }
    chunks.push(chunk);
  }

  const merged = concatUint8Arrays(chunks);
  if (merged.length < 4) return undefined;

  const view = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);
  const declaredLength = view.getUint32(0, false);
  const available = merged.length - 4;
  if (declaredLength > available) return undefined;

  const messageBytes = merged.slice(4, 4 + declaredLength);
  return textDecoder.decode(messageBytes);
};

export const useFHETimeCapsule = (params: UseFHETimeCapsuleParams = {}) => {
  const { initialMockChains } = params;
  const { address: account } = useAccount();

  const { chainId, isConnected, ethersProvider, ethersReadonlyProvider, ethersSigner, eip1193Provider } =
    useWagmiEthers(initialMockChains);

  const allowedChainId = typeof chainId === "number" ? (chainId as AllowedChainIds) : undefined;
  const { data: contractInfo } = useDeployedContractInfo({
    contractName: "FHETimeCapsule",
    chainId: allowedChainId,
  });

  type FHETimeCapsuleContract = Contract<"FHETimeCapsule"> & { chainId?: number };

  const hasContract = Boolean(contractInfo?.address && contractInfo?.abi);
  const hasSigner = Boolean(ethersSigner);
  const contractAddress = hasContract ? (contractInfo!.address as `0x${string}`) : undefined;

  const providerForFhe = useMemo(() => {
    if (eip1193Provider) {
      return eip1193Provider;
    }
    if (chainId !== undefined && initialMockChains && Object.hasOwn(initialMockChains, chainId)) {
      return initialMockChains[chainId];
    }
    return undefined;
  }, [chainId, eip1193Provider, initialMockChains]);

  const { instance, status: fheStatus, error: fheError } = useFhevm({
    provider: providerForFhe,
    chainId,
    initialMockChains,
    enabled: Boolean(providerForFhe && chainId),
  });

  const { canEncrypt, encryptWith } = useFHEEncryption({
    instance,
    ethersSigner,
    contractAddress,
  });

  const [statistics, setStatistics] = useState<CapsuleStatistics | undefined>(undefined);
  const [capsules, setCapsules] = useState<CapsuleDetails[]>([]);
  const [allCapsules, setAllCapsules] = useState<CapsuleDetails[]>([]);
  const [decryptRequests, setDecryptRequests] = useState<DecryptRequest[]>([]);
  const decryptRequestsKey = useMemo(() => {
    if (!decryptRequests.length) return "";
    const sorted = [...decryptRequests].sort((a, b) =>
      (a.handle + a.contractAddress).localeCompare(b.handle + b.contractAddress),
    );
    return JSON.stringify(sorted);
  }, [decryptRequests]);
  const [handledDecryptKey, setHandledDecryptKey] = useState<string>("");
  const [activeDecryptCapsuleId, setActiveDecryptCapsuleId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const autoDecryptRequestedRef = useRef<Set<number>>(new Set());
  const hasPrefetchedSignatureRef = useRef<boolean>(false);
  const resolvedAccount = account?.toLowerCase();

  const decryptSignatureStorage = useMemo(() => new LocalStorageStringStorage("fhevm-signature"), []);

  const { canDecrypt, decrypt, isDecrypting, message: decryptStatusMessage, results: decryptResults, error: decryptError } =
    useFHEDecrypt({
      instance,
      ethersSigner,
      fhevmDecryptionSignatureStorage: decryptSignatureStorage,
      chainId,
      requests: decryptRequests,
    });

  const getDecryptedStorageKeys = useCallback(
    (capsuleId: number) => {
      if (typeof window === "undefined") return undefined;
      if (!contractAddress) return undefined;
      const baseParts: (string | number)[] = [
        "fhe-timecapsule",
        "decrypted-message",
        chainId ?? "unknown-chain",
        contractAddress,
        capsuleId,
      ];
      const publicKey = baseParts.join(":");
      const accountKey = resolvedAccount ? [...baseParts, resolvedAccount].join(":") : undefined;
      return { publicKey, accountKey };
    },
    [chainId, contractAddress, resolvedAccount],
  );

  const persistDecryptedMessage = useCallback(
    (capsuleId: number, message: string | undefined) => {
      const keys = getDecryptedStorageKeys(capsuleId);
      if (!keys) return;
      try {
        const { publicKey, accountKey } = keys;
        if (message) {
          window.localStorage.setItem(publicKey, message);
          if (accountKey) {
            window.localStorage.setItem(accountKey, message);
          }
        } else {
          window.localStorage.removeItem(publicKey);
          if (accountKey) {
            window.localStorage.removeItem(accountKey);
          }
        }
      } catch (error) {
        console.warn("Failed to persist decrypted capsule message", error);
      }
    },
    [getDecryptedStorageKeys],
  );

  const restoreStoredDecryptedMessage = useCallback(
    (capsule: CapsuleDetails) => {
      const keys = getDecryptedStorageKeys(capsule.id);
      if (!keys) return capsule;
      if (!capsule.allowDecrypt) {
        persistDecryptedMessage(capsule.id, undefined);
        return capsule;
      }
      try {
        const { publicKey, accountKey } = keys;
        const storedAccount = accountKey ? window.localStorage.getItem(accountKey) : null;
        const stored = storedAccount ?? window.localStorage.getItem(publicKey);
        if (stored && stored.length > 0) {
          return { ...capsule, decryptedMessage: stored };
        }
      } catch (error) {
        console.warn("Failed to restore decrypted capsule message", error);
      }
      return capsule;
    },
    [getDecryptedStorageKeys, persistDecryptedMessage],
  );

  const hasContractAbi = Boolean(contractInfo?.abi);

  const getContract = useCallback(
    (mode: "read" | "write") => {
      if (!hasContract || !hasContractAbi) return undefined;

      const providerOrSigner = mode === "write" ? ethersSigner : ethersReadonlyProvider;
      if (!providerOrSigner) return undefined;

      return new ethers.Contract(
        contractInfo!.address,
        ((contractInfo as FHETimeCapsuleContract).abi as unknown as InterfaceAbi),
        providerOrSigner,
      );
    },
    [contractInfo, ethersReadonlyProvider, ethersSigner, hasContract, hasContractAbi],
  );

  const resetMessages = useCallback(() => {
    setStatusMessage("");
    setErrorMessage(null);
  }, []);

  const computeStatus = useCallback((capsule: CapsuleDetails): CapsuleStatus => {
    if (capsule.isUnlocked) return "unlocked";
    if (!capsule.isActive) return "cancelled";
    if (capsule.isExpired) return "expired";
    return "active";
  }, []);

  const updateCapsulePartial = useCallback((capsuleId: number, partial: Partial<CapsuleDetails>) => {
    setCapsules(prev => prev.map(capsule => (capsule.id === capsuleId ? { ...capsule, ...partial } : capsule)));
    setAllCapsules(prev => prev.map(capsule => (capsule.id === capsuleId ? { ...capsule, ...partial } : capsule)));
  }, []);

  const getCapsuleById = useCallback(
    (capsuleId: number) => {
      const combined = [...capsules, ...allCapsules];
      return combined.find(capsule => capsule.id === capsuleId);
    },
    [allCapsules, capsules],
  );

  const normalizeCapsule = useCallback(
    (
      capsuleId: bigint,
      rawCapsule: any,
      encryptedMetadata: readonly string[],
      encryptedMessage: readonly string[],
      viewerAddress?: string,
    ): CapsuleDetails => {
      const creator = rawCapsule[0] as string;
      const unlockTime = Number(rawCapsule[1]);
      const isActive = Boolean(rawCapsule[2]);
      const isUnlocked = Boolean(rawCapsule[3]);
      const messageChunkCount = Number(rawCapsule[4]);

      const handles: CapsuleHandles = {
        creator: toHex32(encryptedMetadata[0]),
        unlockTime: toHex32(encryptedMetadata[1]),
        isActive: toHex32(encryptedMetadata[2]),
        isUnlocked: toHex32(encryptedMetadata[3]),
        message: encryptedMessage.map(value => toHex32(value)),
      };

      const viewer = viewerAddress?.toLowerCase();
      const creatorLower = creator.toLowerCase();
      const isOwn = Boolean(viewer && viewer === creatorLower);

      const unlockDate = new Date(unlockTime * 1000);
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const isExpired = currentTimestamp >= unlockTime;
      const allowDecrypt = isUnlocked;

      const capsule: CapsuleDetails = {
        id: Number(capsuleId),
        creator,
        unlockTime,
        unlockDate,
        isActive,
        isUnlocked,
        isExpired,
        messageChunkCount,
        decryptedMessage: undefined,
        status: "pending",
        isOwn,
        allowDecrypt,
        pendingManualDecrypt: false,
        handles,
      };

      return { ...capsule, status: computeStatus(capsule) };
    },
    [computeStatus],
  );

  const loadStatistics = useCallback(async (): Promise<CapsuleStatistics | undefined> => {
    if (!hasContract) return undefined;

    const readContract = getContract("read");
    if (!readContract) return undefined;

    try {
      const [totalCapsules, expiredCapsules] = await Promise.all([
        readContract.getTotalCapsules(),
        readContract.getExpiredCapsulesCount(),
      ]);
      const total = BigInt(totalCapsules);
      const expired = BigInt(expiredCapsules);
      const activeCapsules = total > expired ? total - expired : 0n;

      return {
        totalCapsules: total,
        expiredCapsules: expired,
        activeCapsules,
      };
    } catch (error) {
      console.error("Failed to load statistics", error);
      return undefined;
    }
  }, [getContract, hasContract]);

  const fetchCapsule = useCallback(
    async (capsuleId: bigint, viewerAddress?: string): Promise<CapsuleDetails | undefined> => {
      const readContract = getContract("read");
      if (!readContract) return undefined;

      try {
        const [capsuleRaw, encryptedMetadata, encryptedMessage] = await Promise.all([
          readContract.getTimeCapsule(capsuleId),
          readContract.getEncryptedCapsuleMetadata(capsuleId),
          readContract.getEncryptedMessage(capsuleId),
        ]);

        return normalizeCapsule(
          capsuleId,
          capsuleRaw,
          encryptedMetadata as readonly string[],
          encryptedMessage as readonly string[],
          viewerAddress,
        );
      } catch (error) {
        console.error(`Failed to load capsule ${capsuleId}`, error);
        return undefined;
      }
    },
    [getContract, normalizeCapsule],
  );

  const fetchOwnCapsules = useCallback(async (): Promise<CapsuleDetails[]> => {
    if (!hasContract) return [];
    const readContract = getContract("read");
    if (!readContract) return [];
    if (!account) return [];

    try {
      const capsuleIds: bigint[] = await readContract.getUserCapsules(account);
      if (!capsuleIds.length) return [];

      const viewerAddress = account.toLowerCase();
      const capsulesRaw = await Promise.all(capsuleIds.map(id => fetchCapsule(id, viewerAddress)));
      const filtered = capsulesRaw.filter((capsule): capsule is CapsuleDetails => Boolean(capsule));
      filtered.sort((a, b) => a.unlockTime - b.unlockTime);
      return filtered;
    } catch (error) {
      console.error("Failed to load user capsules", error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return [];
    }
  }, [account, fetchCapsule, getContract, hasContract]);

  const fetchAllCapsules = useCallback(async (): Promise<CapsuleDetails[]> => {
    if (!hasContract) return [];
    const readContract = getContract("read");
    if (!readContract) return [];

    try {
      const totalCapsules: bigint = await readContract.getTotalCapsules();
      const totalNumber = Number(totalCapsules);
      if (!Number.isFinite(totalNumber) || totalNumber <= 0) {
        return [];
      }

      const viewerAddress = account?.toLowerCase();
      const capsuleIds = Array.from({ length: totalNumber }, (_, index) => BigInt(index + 1));
      const capsulesRaw = await Promise.all(capsuleIds.map(id => fetchCapsule(id, viewerAddress)));
      const filtered = capsulesRaw.filter((capsule): capsule is CapsuleDetails => Boolean(capsule));
      filtered.sort((a, b) => a.unlockTime - b.unlockTime);
      return filtered;
    } catch (error) {
      console.error("Failed to load all capsules", error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return [];
    }
  }, [account, fetchCapsule, getContract, hasContract]);

  const refreshStatistics = useCallback(async () => {
    const stats = await loadStatistics();
    setStatistics(stats);
  }, [loadStatistics]);

  const refreshCapsules = useCallback(async () => {
    if (!hasContract) return;

    resetMessages();
    setIsLoading(true);
    window.dispatchEvent(new CustomEvent("fhe-capsule-loading", { detail: { startedAt: Date.now() } }));
    try {
      const [ownCapsules, allCapsulesList, stats] = await Promise.all([
        fetchOwnCapsules(),
        fetchAllCapsules(),
        loadStatistics(),
      ]);

      const restoredOwnCapsules = ownCapsules.map(restoreStoredDecryptedMessage);
      const restoredAllCapsules = allCapsulesList.map(restoreStoredDecryptedMessage);

      setCapsules(restoredOwnCapsules);
      setAllCapsules(restoredAllCapsules);
      setStatistics(stats);
    } catch (error) {
      console.error("Failed to refresh capsules", error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
      window.dispatchEvent(new CustomEvent("fhe-capsule-loading", { detail: { finishedAt: Date.now() } }));
    }
  }, [fetchAllCapsules, fetchOwnCapsules, hasContract, loadStatistics, resetMessages, restoreStoredDecryptedMessage]);

  useWatchContractEvent({
    address: hasContract ? (contractInfo!.address as `0x${string}`) : undefined,
    abi: hasContract ? ((contractInfo as FHETimeCapsuleContract).abi as Abi) : undefined,
    eventName: "CapsuleCreated",
    onLogs: () => {
      void refreshCapsules();
    },
    enabled: Boolean(hasContract),
  });

  useWatchContractEvent({
    address: hasContract ? (contractInfo!.address as `0x${string}`) : undefined,
    abi: hasContract ? ((contractInfo as FHETimeCapsuleContract).abi as Abi) : undefined,
    eventName: "CapsuleUnlocked",
    onLogs: () => {
      void refreshCapsules();
    },
    enabled: Boolean(hasContract),
  });

  useWatchContractEvent({
    address: hasContract ? (contractInfo!.address as `0x${string}`) : undefined,
    abi: hasContract ? ((contractInfo as FHETimeCapsuleContract).abi as Abi) : undefined,
    eventName: "CapsuleCancelled",
    onLogs: () => {
      void refreshCapsules();
    },
    enabled: Boolean(hasContract),
  });

  useWatchContractEvent({
    address: hasContract ? (contractInfo!.address as `0x${string}`) : undefined,
    abi: hasContract ? ((contractInfo as FHETimeCapsuleContract).abi as Abi) : undefined,
    eventName: "CapsuleEncryptionGranted",
    onLogs: () => {
      void refreshCapsules();
    },
    enabled: Boolean(hasContract),
  });

  useEffect(() => {
    if (hasPrefetchedSignatureRef.current) return;
    if (!instance || !ethersSigner || !contractAddress) return;
    if (fheStatus !== "ready") return;

    hasPrefetchedSignatureRef.current = true;

    const run = async () => {
      try {
        await FhevmDecryptionSignature.loadOrSign(instance, [contractAddress], ethersSigner, decryptSignatureStorage);
      } catch (error) {
        console.warn("Failed to prefetch FHE decrypt signature", error);
        hasPrefetchedSignatureRef.current = false;
      }
    };

    void run();
  }, [contractAddress, decryptSignatureStorage, ethersSigner, fheStatus, instance]);

  const requestDecryptCapsule = useCallback(
    (capsuleId: number, options: { skipLockCheck?: boolean } = {}) => {
      if (!contractAddress) {
        setErrorMessage("Contract address unavailable for decryption.");
        return false;
      }
      if (!canDecrypt) {
        setStatusMessage("Waiting for FHE relayer to initialise before decrypting...");
      }
      if (isDecrypting) {
        setStatusMessage("A decryption request is already in progress.");
        return false;
      }

      const capsule = getCapsuleById(capsuleId);
      if (!capsule) {
        setErrorMessage("Capsule not found.");
        return false;
      }
      if (!capsule.allowDecrypt && !options.skipLockCheck) {
        setErrorMessage("Capsule is still locked on-chain.");
        return false;
      }
      if (capsule.decryptedMessage) {
        setStatusMessage("Capsule already decrypted.");
        return false;
      }
      if (capsule.pendingManualDecrypt) {
        setStatusMessage("Capsule decryption is already queued.");
        return false;
      }
      if (!capsule.handles.message.length) {
        setErrorMessage("No encrypted message chunks available to decrypt.");
        return false;
      }

      const requests = capsule.handles.message.map(handle => ({ handle, contractAddress }));
      setDecryptRequests(requests);
      setHandledDecryptKey("");
      setActiveDecryptCapsuleId(capsuleId);
      updateCapsulePartial(capsuleId, { pendingManualDecrypt: true });
      setStatusMessage(canDecrypt ? "Preparing capsule decryption request..." : "Queued until FHE relayer is ready.");
      return true;
    },
    [
      contractAddress,
      canDecrypt,
      getCapsuleById,
      isDecrypting,
      updateCapsulePartial,
    ],
  );

  useEffect(() => {
    const activeIds = new Set<number>();
    const evaluateCapsules = (list: readonly CapsuleDetails[]) => {
      for (const capsule of list) {
        activeIds.add(capsule.id);
        if (!capsule.isOwn) continue;
        if (!capsule.allowDecrypt) {
          autoDecryptRequestedRef.current.delete(capsule.id);
          continue;
        }
        if (capsule.decryptedMessage || capsule.pendingManualDecrypt) {
          continue;
        }
        if (!autoDecryptRequestedRef.current.has(capsule.id)) {
          autoDecryptRequestedRef.current.add(capsule.id);
          const scheduled = requestDecryptCapsule(capsule.id, { skipLockCheck: true });
          if (!scheduled) {
            autoDecryptRequestedRef.current.delete(capsule.id);
          }
        }
      }
    };

    evaluateCapsules(capsules);
    evaluateCapsules(allCapsules);

    for (const requestedId of Array.from(autoDecryptRequestedRef.current)) {
      if (!activeIds.has(requestedId)) {
        autoDecryptRequestedRef.current.delete(requestedId);
      }
    }
  }, [allCapsules, capsules, requestDecryptCapsule]);

  const executeWrite = useCallback(
    async (action: WriteAction): Promise<WriteResult | undefined> => {
      if (!hasContract || !hasSigner || !contractAddress) {
        setErrorMessage("Wallet or contract not available.");
        return undefined;
      }

      const writeContract = getContract("write");
      if (!writeContract) {
        setErrorMessage("Unable to access contract signer.");
        return undefined;
      }

      await yieldToBrowser();

      resetMessages();
      setIsSubmitting(true);

      try {
        let tx;
        switch (action.type) {
          case "create": {
            if (!action.message.trim()) {
              setErrorMessage("Message cannot be empty.");
              return undefined;
            }
            if (action.unlockTime <= Math.floor(Date.now() / 1000)) {
              setErrorMessage("Unlock time must be in the future.");
              return undefined;
            }
            if (!canEncrypt) {
              setErrorMessage("FHE encryption is not ready yet. Please wait for the relayer to initialise.");
              return undefined;
            }

            setStatusMessage("Encrypting unlock time...");
            const encryptedUnlockTime = await encryptWith(builder => builder.add64(BigInt(action.unlockTime)));
            if (!encryptedUnlockTime) {
              setErrorMessage("Failed to encrypt unlock time.");
              return undefined;
            }

            const unlockTimeHandle = toHex32(encryptedUnlockTime.handles[0]);
            const unlockTimeProof = toHex32(encryptedUnlockTime.inputProof);

            const messageChunks = encodeMessageToChunks(action.message);
            if (!messageChunks.length) {
              setErrorMessage("Unable to encode message for encryption.");
              return undefined;
            }

            await yieldToBrowser();

            const encryptedHandles: `0x${string}`[] = [];
            const encryptedProofs: `0x${string}`[] = [];

            for (let index = 0; index < messageChunks.length; index++) {
              const chunk = messageChunks[index];
              await yieldToBrowser();
              setStatusMessage(`Encrypting message chunk ${index + 1}/${messageChunks.length}...`);
              const encryptedChunk = await encryptWith(builder => builder.add256(chunk));
              if (!encryptedChunk) {
                setErrorMessage("Failed to encrypt message chunk.");
                return undefined;
              }

              encryptedHandles.push(toHex32(encryptedChunk.handles[0]));
              encryptedProofs.push(toHex32(encryptedChunk.inputProof));
            }

            setStatusMessage("Submitting encrypted capsule...");
            tx = await writeContract.createTimeCapsule(
              encryptedHandles,
              encryptedProofs,
              unlockTimeHandle,
              unlockTimeProof,
              BigInt(action.unlockTime),
            );
            break;
          }
          case "cancel": {
            setStatusMessage(`Cancelling capsule #${action.capsuleId}...`);
            tx = await writeContract.cancelTimeCapsule(BigInt(action.capsuleId));
            break;
          }
          case "open": {
            setStatusMessage(`Opening capsule #${action.capsuleId}...`);
            tx = await writeContract.openTimeCapsule(BigInt(action.capsuleId));
            break;
          }
          default: {
            setErrorMessage("Unsupported action.");
            return undefined;
          }
        }

        setStatusMessage("Waiting for confirmation...");
        const receipt = await tx.wait();
        setStatusMessage("Transaction confirmed.");
        return { txHash: receipt?.hash ?? tx.hash };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        setErrorMessage(errMsg);
        console.error("Transaction failed:", errMsg);
        return undefined;
      } finally {
        setIsSubmitting(false);
      }
    },
    [canEncrypt, contractAddress, encryptWith, getContract, hasContract, hasSigner, resetMessages],
  );

  const createCapsule = useCallback(
    async (message: string, unlockTime: number) => {
      const result = await executeWrite({ type: "create", message, unlockTime });
      if (result?.txHash) {
        await refreshCapsules();
      }
      return result;
    },
    [executeWrite, refreshCapsules],
  );

  const cancelCapsule = useCallback(
    async (capsuleId: number) => {
      const result = await executeWrite({ type: "cancel", capsuleId });
      if (result?.txHash) {
        await refreshCapsules();
      }
      return result;
    },
    [executeWrite, refreshCapsules],
  );

  const openCapsule = useCallback(
    async (capsuleId: number) => {
      const existingCapsule = getCapsuleById(capsuleId);
      const result = await executeWrite({ type: "open", capsuleId });
      if (result?.txHash) {
        if (existingCapsule) {
          updateCapsulePartial(capsuleId, {
            isUnlocked: true,
            isActive: false,
            allowDecrypt: true,
            status: "unlocked",
            pendingManualDecrypt: true,
          });
        }
        await refreshCapsules();
        requestDecryptCapsule(capsuleId, { skipLockCheck: true });
      }
      return result;
    },
    [executeWrite, getCapsuleById, refreshCapsules, requestDecryptCapsule, updateCapsulePartial],
  );

  useEffect(() => {
    void refreshCapsules();
  }, [refreshCapsules]);

  useEffect(() => {
    if (!decryptRequestsKey) {
      setHandledDecryptKey("");
      return;
    }
    if (!canDecrypt) return;
    if (handledDecryptKey === decryptRequestsKey) return;
    if (isDecrypting) return;
    setHandledDecryptKey(decryptRequestsKey);
    decrypt();
  }, [canDecrypt, decrypt, decryptRequestsKey, handledDecryptKey, isDecrypting]);

  useEffect(() => {
    if (!decryptError) return;
    setErrorMessage(decryptError);
    if (activeDecryptCapsuleId !== null) {
      autoDecryptRequestedRef.current.delete(activeDecryptCapsuleId);
      updateCapsulePartial(activeDecryptCapsuleId, { pendingManualDecrypt: false });
      setActiveDecryptCapsuleId(null);
    }
    setDecryptRequests([]);
    setHandledDecryptKey("");
  }, [activeDecryptCapsuleId, decryptError, updateCapsulePartial]);

  useEffect(() => {
    if (fheError) {
      setErrorMessage(fheError.message);
    }
  }, [fheError]);

  const normalizedDecryptResults = useMemo(() => {
    if (!decryptResults) return undefined;
    const entries = Object.entries(decryptResults);
    if (!entries.length) return undefined;
    const map = new Map<string, string | bigint | boolean>();
    for (const [key, value] of entries) {
      map.set(key.toLowerCase(), value);
    }
    return map;
  }, [decryptResults]);

  useEffect(() => {
    if (!normalizedDecryptResults || normalizedDecryptResults.size === 0) return;
    if (activeDecryptCapsuleId === null) return;

    const capsule = getCapsuleById(activeDecryptCapsuleId);
    if (!capsule) {
      autoDecryptRequestedRef.current.delete(activeDecryptCapsuleId);
      persistDecryptedMessage(activeDecryptCapsuleId, undefined);
      updateCapsulePartial(activeDecryptCapsuleId, { pendingManualDecrypt: false });
      setActiveDecryptCapsuleId(null);
      setDecryptRequests([]);
      setHandledDecryptKey("");
      return;
    }

    const decoded = decodeMessageFromResults(capsule.handles.message, normalizedDecryptResults);
    if (decoded) {
      persistDecryptedMessage(activeDecryptCapsuleId, decoded);
      updateCapsulePartial(activeDecryptCapsuleId, {
        decryptedMessage: decoded,
        pendingManualDecrypt: false,
      });
      setStatusMessage("Capsule decrypted.");
    } else {
      persistDecryptedMessage(activeDecryptCapsuleId, undefined);
      updateCapsulePartial(activeDecryptCapsuleId, { pendingManualDecrypt: false });
      setErrorMessage("Failed to decrypt capsule message.");
    }

    autoDecryptRequestedRef.current.delete(activeDecryptCapsuleId);
    setActiveDecryptCapsuleId(null);
    setDecryptRequests([]);
    setHandledDecryptKey("");
  }, [
    activeDecryptCapsuleId,
    getCapsuleById,
    normalizedDecryptResults,
    persistDecryptedMessage,
    updateCapsulePartial,
  ]);

  const canCreate = useMemo(
    () => Boolean(isConnected && hasSigner && hasContract && !isSubmitting && canEncrypt),
    [canEncrypt, hasContract, hasSigner, isConnected, isSubmitting],
  );

  const canMutateCapsule = useMemo(
    () => Boolean(isConnected && hasSigner && hasContract && !isSubmitting),
    [hasContract, hasSigner, isConnected, isSubmitting],
  );

  return {
    contractAddress,
    capsules,
    allCapsules,
    statistics,
    isLoading,
    isSubmitting,
    isDecrypting,
    statusMessage,
    decryptStatusMessage,
    errorMessage,
    canCreate,
    canEncrypt,
    canMutateCapsule,
    canDecrypt,
    fheStatus,
    refreshCapsules,
    refreshStatistics,
    createCapsule,
    cancelCapsule,
    openCapsule,
    decryptCapsule: requestDecryptCapsule,
  } as const;
};
