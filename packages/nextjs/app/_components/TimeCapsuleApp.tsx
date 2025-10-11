"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { type CapsuleDetails, useFHETimeCapsule } from "~~/hooks/timecapsule";

const statusStyles: Record<CapsuleDetails["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30",
  expired: "bg-amber-500/15 text-amber-200 border border-amber-400/30",
  unlocked: "bg-indigo-500/15 text-indigo-200 border border-indigo-400/30",
  cancelled: "bg-rose-500/15 text-rose-200 border border-rose-400/30",
  pending: "bg-slate-500/15 text-slate-200 border border-slate-400/30",
};

const statusLabels: Record<CapsuleDetails["status"], string> = {
  active: "Active",
  expired: "Expired",
  unlocked: "Unlocked",
  cancelled: "Cancelled",
  pending: "Pending",
};

const formatRelativeTime = (unlockDate: Date, isExpired: boolean) => {
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const now = new Date();
  const diffMs = unlockDate.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(isExpired ? -Math.abs(diffMinutes) : Math.abs(diffMinutes), "minute");
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 48) {
    return formatter.format(isExpired ? -Math.abs(diffHours) : Math.abs(diffHours), "hour");
  }
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(isExpired ? -Math.abs(diffDays) : Math.abs(diffDays), "day");
};

export const TimeCapsuleApp = () => {
  const { isConnected } = useAccount();
  const [message, setMessage] = useState("");
  const [unlockDate, setUnlockDate] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"mine" | "community">("mine");

  const {
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
    createCapsule,
    cancelCapsule,
    openCapsule,
    decryptCapsule,
  } = useFHETimeCapsule();

  const hasCapsules = useMemo(() => capsules.length > 0, [capsules]);
  const otherCapsules = useMemo(() => allCapsules.filter(capsule => !capsule.isOwn), [allCapsules]);
  const hasOtherCapsules = useMemo(() => otherCapsules.length > 0, [otherCapsules]);
  const statBlocks = useMemo(
    () => [
      {
        label: "Total Capsules",
        value: statistics ? Number(statistics.totalCapsules) : 0,
        description: "Created capsules on-chain",
        icon: "🗃️",
        accent: "text-amber-500",
      },
      {
        label: "Active",
        value: statistics ? Number(statistics.activeCapsules) : 0,
        description: "Capsules waiting to unlock",
        icon: "🕒",
        accent: "text-emerald-500",
      },
      {
        label: "Unlocking Soon",
        value: statistics ? Number(statistics.expiredCapsules) : 0,
        description: "Expired or about to unlock",
        icon: "✨",
        accent: "text-indigo-500",
      },
    ],
    [statistics],
  );

  const creationHint = useMemo(() => {
    if (isSubmitting) return "Encrypting and submitting capsule...";
    if (fheStatus === "loading") return "Initialising FHE relayer...";
    if (fheStatus === "error") return "FHE relayer unavailable. Reconnect your wallet or refresh.";
    if (!canEncrypt) return "Waiting for FHE relayer permissions...";
    return "Write your note and choose a time—you're all set.";
  }, [canEncrypt, fheStatus, isSubmitting]);

  const handleCreateCapsule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!unlockDate) {
      setFormError("Please choose an unlock time.");
      return;
    }

    const unlockTimestamp = Math.floor(new Date(unlockDate).getTime() / 1000);
    if (!Number.isFinite(unlockTimestamp)) {
      setFormError("Please enter a valid date.");
      return;
    }

    if (unlockTimestamp <= Math.floor(Date.now() / 1000)) {
      setFormError("Unlock time must be in the future.");
      return;
    }

    const result = await createCapsule(message, unlockTimestamp);
    if (result?.txHash) {
      setMessage("");
      setUnlockDate("");
    }
  };

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white shadow-xl rounded-3xl px-8 py-12 text-center space-y-6">
          <div className="flex justify-center">
            <span className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-slate-900/10 text-3xl">
              ⏳
            </span>
          </div>
          <h2 className="text-3xl font-semibold text-slate-900">Welcome to FHE Time Capsule</h2>
          <p className="text-slate-600">Connect your wallet to create and manage encrypted capsules.</p>
          <div className="flex justify-center">
            <RainbowKitCustomConnectButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05060A] text-slate-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-5">
            <span className="inline-flex w-max items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300">
              encrypted memories on-chain
            </span>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold text-white sm:text-[34px]">FHE Time Capsule</h1>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
                <span className="block">Keep your message sealed, choose when it unlocks, and pin it on-chain.</span>
                <span className="block">
                  When the timer ends the capsule unlocks automatically—or manually, if you prefer.
                </span>
              </p>
            </div>
            <div className="grid gap-2 text-[12px] text-slate-300 sm:grid-cols-3">
              <FeaturePill icon="🔐" label="Fully encrypted storage" />
              <FeaturePill icon="⏱️" label="Scheduled unlocks" />
              <FeaturePill icon="🤝" label="Community capsules" />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {statBlocks.map(stat => (
            <StatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              description={stat.description}
              icon={stat.icon}
              accent={stat.accent}
            />
          ))}
        </section>

        <section id="create" className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-xl backdrop-blur">
          <div className="border-b border-white/10 pb-4">
            <h2 className="text-lg font-semibold text-white">Create a new capsule</h2>
            <p className="mt-2 text-sm text-slate-400">
              Your note is encrypted on-chain; choose a future unlock time so it only becomes readable when you decide.
            </p>
          </div>
          <form className="pt-5" onSubmit={handleCreateCapsule}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-2">
                <label
                  htmlFor="capsuleMessage"
                  className="text-[11px] font-semibold uppercase tracking-wide text-slate-300"
                >
                  Message
                </label>
                <textarea
                  id="capsuleMessage"
                  className="w-full min-h-[110px] rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white shadow-inner transition focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="What would your future self—or your teammates—need to hear?"
                  value={message}
                  onChange={event => setMessage(event.target.value)}
                  disabled={!canCreate || isSubmitting}
                  required
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="unlockDate"
                  className="text-[11px] font-semibold uppercase tracking-wide text-slate-300"
                >
                  Unlock Time
                </label>
                <input
                  id="unlockDate"
                  type="datetime-local"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white shadow-inner transition focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  value={unlockDate}
                  onChange={event => setUnlockDate(event.target.value)}
                  disabled={!canCreate || isSubmitting}
                  required
                />
                <p className="text-[11px] text-slate-400">
                  Block latency can add a few seconds of drift, but your encrypted payload remains safe.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Status</label>
                <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                  {creationHint}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {formError && <Alert tone="error" message={formError} />}
              {errorMessage && <Alert tone="error" message={errorMessage} />}
              {statusMessage && <Alert tone="info" message={statusMessage} />}
              {decryptStatusMessage && <Alert tone="info" message={decryptStatusMessage} />}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-900 shadow-lg transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canCreate || isSubmitting}
              >
                {isSubmitting ? "Sending..." : "Send Capsule"}
              </button>
            </div>
          </form>
        </section>

        <section id="capsules" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-full border border-white/15 bg-white/10 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("mine")}
                className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide rounded-full transition ${
                  activeTab === "mine" ? "bg-white text-slate-900 shadow" : "text-slate-300 hover:text-white"
                }`}
              >
                My Capsules
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("community")}
                className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide rounded-full transition ${
                  activeTab === "community" ? "bg-white text-slate-900 shadow" : "text-slate-300 hover:text-white"
                }`}
              >
                Community Capsules
              </button>
            </div>
            <span className="text-sm text-slate-400">
              {activeTab === "mine" ? `${capsules.length} entries` : `${otherCapsules.length} entries`}
            </span>
          </div>

          {isLoading ? (
            <EmptyState title="Loading capsules" message="Please wait..." emoji="⏳" />
          ) : activeTab === "mine" ? (
            hasCapsules ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {capsules.map(capsule => {
                  const showDecrypt = capsule.allowDecrypt && !capsule.decryptedMessage;
                  const decryptDisabled =
                    !canDecrypt || isDecrypting || capsule.pendingManualDecrypt || isSubmitting;
                  const decryptAction = showDecrypt ? (
                    <ActionButton
                      key={`decrypt-${capsule.id}`}
                      label={
                        capsule.pendingManualDecrypt || isDecrypting
                          ? "Decrypting..."
                          : canDecrypt
                            ? "Decrypt"
                            : "Decrypt (Unavailable)"
                      }
                      onClick={() => {
                        void decryptCapsule(capsule.id);
                      }}
                      disabled={decryptDisabled}
                      tone="primary"
                    />
                  ) : null;

                  return (
                    <CapsuleCard
                      key={capsule.id}
                      capsule={capsule}
                      isDecrypting={isDecrypting}
                      canDecrypt={canDecrypt}
                    >
                      <>
                        {decryptAction}
                        <ActionButton
                          key={`cancel-${capsule.id}`}
                          label="Cancel"
                          onClick={() => void cancelCapsule(capsule.id)}
                          disabled={!canMutateCapsule || isSubmitting || capsule.status !== "active"}
                          tone="danger"
                        />
                        <ActionButton
                          key={`open-${capsule.id}`}
                          label="Open"
                          onClick={() => void openCapsule(capsule.id)}
                          disabled={!canMutateCapsule || isSubmitting || capsule.status !== "expired"}
                          tone="primary"
                        />
                      </>
                    </CapsuleCard>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="No capsules yet"
                message="Write your first message and drop it into the future."
                emoji="📮"
              />
            )
          ) : hasOtherCapsules ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {otherCapsules.map(capsule => {
                const showDecrypt = capsule.allowDecrypt && !capsule.decryptedMessage;
                const decryptDisabled =
                  !canDecrypt || isDecrypting || capsule.pendingManualDecrypt || isSubmitting;
                const decryptAction = showDecrypt ? (
                  <ActionButton
                    key={`decrypt-${capsule.id}`}
                    label={
                      capsule.pendingManualDecrypt || isDecrypting
                        ? "Decrypting..."
                        : canDecrypt
                          ? "Decrypt"
                          : "Decrypt (Unavailable)"
                    }
                    onClick={() => {
                      void decryptCapsule(capsule.id);
                    }}
                    disabled={decryptDisabled}
                    tone="primary"
                  />
                ) : null;

                return (
                  <CapsuleCard
                    key={`public-${capsule.id}`}
                    capsule={capsule}
                    isDecrypting={isDecrypting}
                    canDecrypt={canDecrypt}
                  >
                    {decryptAction}
                  </CapsuleCard>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No community capsules"
              message="Nobody has left a message yet. Start the timeline with yours."
              emoji="🌱"
            />
          )}
        </section>
      </div>
    </div>
  );
};

const StatCard = ({
  label,
  value,
  description,
  icon,
  accent,
}: {
  label: string;
  value: number;
  description: string;
  icon?: string;
  accent?: string;
}) => (
  <div className="rounded-xl border border-white/10 bg-white/[0.06] p-5 shadow-inner transition hover:-translate-y-[2px] hover:border-white/25">
    <div className="flex items-center justify-between text-slate-300">
      <span className={`text-xl ${accent ?? ""}`}>{icon ?? "📦"}</span>
      <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
        {label}
      </span>
    </div>
    <p className="mt-5 text-[28px] font-semibold text-white">{value}</p>
    <p className="mt-1 text-xs text-slate-400">{description}</p>
  </div>
);

const FeaturePill = ({ icon, label }: { icon: string; label: string }) => (
  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-slate-200">
    <span>{icon}</span>
    <span>{label}</span>
  </div>
);

const InfoRow = ({ label, value, isAddress = false }: { label: string; value: string; isAddress?: boolean }) => (
  <div className="space-y-1">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`text-sm text-white/90 ${isAddress ? "truncate font-mono text-white" : ""}`} title={value}>
      {value}
    </p>
  </div>
);

const EmptyState = ({ title, message, emoji }: { title: string; message: string; emoji: string }) => (
  <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-8 py-10 text-center text-slate-300">
    <span className="text-4xl">{emoji}</span>
    <p className="text-base font-semibold text-white">{title}</p>
    <p className="max-w-lg text-sm text-slate-400">{message}</p>
  </div>
);

const CapsuleCard = ({
  capsule,
  isDecrypting,
  canDecrypt,
  children,
}: {
  capsule: CapsuleDetails;
  isDecrypting: boolean;
  canDecrypt: boolean;
  children?: ReactNode;
}) => {
  const relative = formatRelativeTime(capsule.unlockDate, capsule.isExpired);
  const truncatedMessage =
    capsule.decryptedMessage && capsule.decryptedMessage.length > 80
      ? `${capsule.decryptedMessage.slice(0, 77)}...`
      : capsule.decryptedMessage ?? undefined;

  const messagePreview = truncatedMessage
    ? truncatedMessage
    : capsule.allowDecrypt
      ? capsule.pendingManualDecrypt || isDecrypting
        ? "Decrypting ciphertext…"
        : canDecrypt
          ? "Ready to decrypt"
          : "FHE setup required"
      : "Encrypted capsule";
  const statusBadgeClass = statusStyles[capsule.status] ?? statusStyles.pending;
  const statusLabel = statusLabels[capsule.status] ?? statusLabels.pending;
  const creatorDisplay = capsule.isOwn ? "Sen" : capsule.creator;
  const encryptedPreview =
    capsule.handles.message.length > 0 ? capsule.handles.message.slice(0, 4).join("\n") : "No ciphertext stored.";
  const remainingChunks = capsule.handles.message.length - Math.min(capsule.handles.message.length, 4);
  const encryptedFooter = remainingChunks > 0 ? `\n...and ${remainingChunks} more chunk(s)` : "";
  const decryptAccessLabel = capsule.allowDecrypt
    ? capsule.decryptedMessage
      ? "Decrypted"
      : capsule.pendingManualDecrypt || isDecrypting
        ? "Decrypting…"
        : canDecrypt
          ? "Ready to decrypt"
          : "FHE setup required"
    : "Locked";

  return (
    <article className="rounded-xl border border-white/10 bg-white/6 p-5 shadow-[0_25px_60px_-40px_rgba(10,10,15,0.8)] transition hover:-translate-y-[3px] hover:border-white/25">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-slate-200">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Capsule #{capsule.id}</span>
            {capsule.isOwn ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-white">
                ✨ Yours
              </span>
            ) : null}
          </div>
          <p className="text-base font-semibold text-white">{messagePreview}</p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold ${statusBadgeClass}`}
        >
          {statusLabel}
        </span>
      </header>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <InfoRow label="Unlock Time" value={capsule.unlockDate.toLocaleString()} />
        <InfoRow label="Block Status" value={relative} />
        <InfoRow label="Created By" value={creatorDisplay} isAddress={!capsule.isOwn} />
        <InfoRow label="Ciphertext Chunks" value={`${capsule.handles.message.length}`} />
        <InfoRow label="Decrypt Access" value={decryptAccessLabel} />
        <div className="space-y-2 sm:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {capsule.decryptedMessage ? "Decrypted Message" : "Encrypted Payload (FHE handles)"}
          </p>
          {capsule.decryptedMessage ? (
            <div className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/90">
              {capsule.decryptedMessage}
            </div>
          ) : (
            <code className="block max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-[11px] text-slate-200">
              {`${encryptedPreview}${encryptedFooter}`}
            </code>
          )}
        </div>
      </div>

      {children ? <div className="mt-4 flex flex-wrap justify-end gap-2">{children}</div> : null}
    </article>
  );
};

const Alert = ({ tone, message }: { tone: "error" | "info"; message: string }) => {
  const toneStyles =
    tone === "error"
      ? "bg-rose-500/20 text-rose-200 ring-1 ring-inset ring-rose-400/40"
      : "bg-white/10 text-white ring-1 ring-inset ring-white/20";

  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${toneStyles}`}>
      <span>{tone === "error" ? "⚠️" : "ℹ️"}</span>
      <span>{message}</span>
    </div>
  );
};

const ActionButton = ({
  label,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  onClick: () => Promise<void> | void;
  disabled?: boolean;
  tone: "primary" | "ghost" | "danger";
}) => {
  const base =
    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50";
  const palette =
    tone === "primary"
      ? "bg-white text-slate-900 hover:bg-slate-200 shadow-sm"
      : tone === "danger"
        ? "bg-rose-500 text-white hover:bg-rose-400"
        : "border border-white/15 bg-white/10 text-white hover:border-white/30";

  return (
    <button type="button" className={`${base} ${palette}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
};
