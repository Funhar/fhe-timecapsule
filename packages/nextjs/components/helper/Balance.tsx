"use client";

import { Address, formatEther } from "viem";
import { useTargetNetwork } from "~~/hooks/helper/useTargetNetwork";
import { useWatchBalance } from "~~/hooks/helper/useWatchBalance";

type BalanceProps = {
  address?: Address;
  className?: string;
  usdMode?: boolean;
};

/**
 * Display (ETH & USD) balance of an ETH address.
 */
export const Balance = ({ address, className = "" }: BalanceProps) => {
  const { targetNetwork } = useTargetNetwork();

  const {
    data: balance,
    isError,
    isLoading,
  } = useWatchBalance({
    address,
  });

  if (!address || isLoading || balance === null) {
    return <div className={`h-5 w-20 animate-pulse rounded-full bg-white/10 ${className}`} />;
  }

  if (isError) {
    return <div className={`text-xs font-medium text-rose-300 ${className}`}>Bakiye getirilemedi</div>;
  }

  const formattedBalance = balance ? Number(formatEther(balance.value)) : 0;

  return (
    <div className={`flex items-center gap-1 text-xs font-semibold text-slate-200 ${className}`}>
      <span>{formattedBalance.toFixed(4)}</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{targetNetwork.nativeCurrency.symbol}</span>
    </div>
  );
};
