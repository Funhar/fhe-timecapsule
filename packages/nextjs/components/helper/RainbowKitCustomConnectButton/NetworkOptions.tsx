import { useAccount, useSwitchChain } from "wagmi";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/solid";
import { getTargetNetworks } from "~~/utils/helper";

const allowedNetworks = getTargetNetworks();

type NetworkOptionsProps = {
  onSelect?: () => void;
};

export const NetworkOptions = ({ onSelect }: NetworkOptionsProps) => {
  const { switchChain } = useSwitchChain();
  const { chain } = useAccount();

  const options = allowedNetworks.filter(allowedNetwork => allowedNetwork.id !== chain?.id);

  if (options.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Switch Network</p>
      {options.map(allowedNetwork => (
        <button
          key={allowedNetwork.id}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/30"
          type="button"
          onClick={() => {
            switchChain?.({ chainId: allowedNetwork.id });
            onSelect?.();
          }}
        >
          <ArrowsRightLeftIcon className="h-4 w-4 text-slate-300" />
          <span>{allowedNetwork.name}</span>
        </button>
      ))}
    </div>
  );
};
