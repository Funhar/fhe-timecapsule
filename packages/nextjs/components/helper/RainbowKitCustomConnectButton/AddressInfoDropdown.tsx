import { useRef } from "react";
import { NetworkOptions } from "./NetworkOptions";
import { Address, getAddress } from "viem";
import { useDisconnect } from "wagmi";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { BlockieAvatar } from "~~/components/helper";
import { useOutsideClick } from "~~/hooks/helper";

type AddressInfoDropdownProps = {
  address: Address;
  displayName: string;
  ensAvatar?: string;
  blockExplorerAddressLink?: string;
};

export const AddressInfoDropdown = ({ address, ensAvatar, displayName }: AddressInfoDropdownProps) => {
  const { disconnect } = useDisconnect();
  const checksumAddress = getAddress(address);

  const dropdownRef = useRef<HTMLDetailsElement>(null);

  const closeDropdown = () => {
    dropdownRef.current?.removeAttribute("open");
  };

  useOutsideClick(dropdownRef, closeDropdown);

  return (
    <details ref={dropdownRef} className="relative">
      <summary className="flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-sm text-white outline-none transition hover:border-white/25">
        <BlockieAvatar address={checksumAddress} size={26} ensImage={ensAvatar} />
        <span className="hidden sm:inline text-xs font-semibold uppercase tracking-wide text-white/80">
          {displayName}
        </span>
        <ChevronDownIcon className="h-4 w-4 text-white/50" />
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-white/10 bg-[#0B0D17] p-3 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Connected Address</p>
            <p className="truncate font-mono text-[11px] uppercase text-slate-400">{checksumAddress}</p>
          </div>
          <NetworkOptions onSelect={closeDropdown} />
          <button
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-300/40"
            type="button"
            onClick={() => {
              disconnect();
              closeDropdown();
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    </details>
  );
};
