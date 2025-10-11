"use client";

import { useMemo } from "react";
import { RainbowKitCustomConnectButton } from "~~/components/helper";

const navItems = [
  { label: "Create Capsule", href: "#create" },
  { label: "Capsules", href: "#capsules" },
];

/**
 * Application header with brand, navigation and wallet connect
 */
export const Header = () => {
  const navigation = useMemo(() => navItems, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-[#05060A]/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 text-slate-100">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold shadow-inner">
            ⏳
          </div>
          <div className="leading-tight">
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">FHE</p>
            <p className="text-base font-semibold text-white">Time Capsule</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <nav className="hidden md:flex items-center gap-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {navigation.map(item => (
              <a key={item.href} href={item.href} className="transition hover:text-white">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="hidden md:block h-6 w-px bg-white/10" />
          <RainbowKitCustomConnectButton />
        </div>
      </div>
    </header>
  );
};
