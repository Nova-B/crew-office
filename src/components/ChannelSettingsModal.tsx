"use client";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_NPC_MOTION,
  NPC_MOTION_KINDS,
  NPC_SPEED_RANGE,
  RUN_SPEED_THRESHOLD,
  normalizeNpcMotionConfig,
  tilesPerSecond,
  type NpcMotionConfig,
} from "@/lib/npc-motion-config";
import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";

// crew-office: Hermes 게이트웨이("AI 연결") 탭은 Hermes 와 함께 걷어냈다.
type ChannelSettingsTab = "settings" | "members";

interface ChannelSettingsModalProps {
  channelId: string;
  channelName: string;
  channelDescription: string | null;
  isPublic: boolean;
  inviteCode: string | null;
  /** 채널의 NPC 걸음 속도. 서버가 접어서 준다. */
  motionConfig?: NpcMotionConfig;
  initialTab?: ChannelSettingsTab;
  onClose: () => void;
  onUpdated: (data: {
    name?: string;
    description?: string | null;
    isPublic?: boolean;
    motionConfig?: NpcMotionConfig;
  }) => void;
}

interface Member {
  userId: string;
  nickname: string;
  role: string;
  joinedAt: string;
  isOnline: boolean;
}

export default function ChannelSettingsModal({
  channelId,
  channelName,
  channelDescription,
  isPublic,
  inviteCode,
  motionConfig,
  initialTab = "settings",
  onClose,
  onUpdated,
}: ChannelSettingsModalProps) {
  const t = useT();
  const [tab, setTab] = useState<ChannelSettingsTab>(initialTab);
  const [name, setName] = useState(channelName);
  const [description, setDescription] = useState(channelDescription || "");
  const [visibility, setVisibility] = useState(isPublic);
  const initialMotion = normalizeNpcMotionConfig(motionConfig);
  const [motion, setMotion] = useState<NpcMotionConfig>(initialMotion);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [kickingUserId, setKickingUserId] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState<Member | null>(null);

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError("");
    try {
      const res = await fetch(`/api/channels/${channelId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setMembersError(getLocalizedErrorMessage(t, data, "errors.failedToFetchMembers"));
      }
    } catch {
      setMembersError(t("errors.failedToFetchMembers"));
    }
    setMembersLoading(false);
  }, [channelId, t]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (tab === "members") {
      timer = setTimeout(() => {
        void loadMembers();
      }, 0);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [tab, loadMembers]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    const updates: Record<string, unknown> = {};
    if (name.trim() !== channelName) updates.name = name.trim();
    if (description.trim() !== (channelDescription || ""))
      updates.description = description.trim() || null;
    if (visibility !== isPublic) updates.isPublic = visibility;
    if (!visibility && password) updates.password = password;
    if (NPC_MOTION_KINDS.some((kind) => motion[kind] !== initialMotion[kind]))
      updates.motionConfig = motion;

    if (Object.keys(updates).length === 0) {
      setSaving(false);
      return;
    }

    if (updates.isPublic === false && !password && isPublic) {
      setSaveError(t("settings.passwordRequiredForPrivate"));
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/channels/${channelId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        setSaveError(getLocalizedErrorMessage(t, data, "settings.failedToSave"));
      } else {
        setSaveSuccess(true);
        setPassword("");
        onUpdated(
          updates as {
            name?: string;
            description?: string | null;
            isPublic?: boolean;
            motionConfig?: NpcMotionConfig;
          },
        );
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch {
      setSaveError(t("settings.failedToSave"));
    }
    setSaving(false);
  };

  const handleKick = async (member: Member) => {
    setKickingUserId(member.userId);
    setMembersError("");
    try {
      const res = await fetch(`/api/channels/${channelId}/members/${member.userId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      } else {
        const data = await res.json().catch(() => ({}));
        setMembersError(getLocalizedErrorMessage(t, data, "errors.failedToKickMember"));
      }
    } catch {
      setMembersError(t("errors.failedToKickMember"));
    }
    setKickingUserId(null);
    setConfirmKick(null);
  };

  const copyInviteCode = () => {
    if (inviteCode) {
      navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface rounded-xl w-full max-w-lg border border-border max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-lg font-bold text-white">{t("settings.title")}</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text text-xl"
            aria-label={t("common.close")}
          >
            &times;
          </button>
        </div>

        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("settings")}
            className={`flex-1 py-2 text-sm font-semibold ${tab === "settings" ? "text-info border-b-2 border-info" : "text-text-muted"}`}
          >
            {t("settings.general")}
          </button>
          <button
            onClick={() => setTab("members")}
            className={`flex-1 py-2 text-sm font-semibold ${tab === "members" ? "text-info border-b-2 border-info" : "text-text-muted"}`}
          >
            {t("settings.members")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "settings" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1">
                  {t("settings.channelName")}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  className="w-full px-3 py-2 bg-bg border border-border rounded text-text focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1">
                  {t("settings.description")}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={2}
                  className="w-full px-3 py-2 bg-bg border border-border rounded text-text focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1">
                  {t("settings.visibility")}
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibility(true)}
                    className={`px-3 py-1 rounded text-sm ${visibility ? "bg-indigo-600 text-text" : "bg-surface-raised text-text-muted"}`}
                  >
                    {t("channels.public")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibility(false)}
                    className={`px-3 py-1 rounded text-sm ${!visibility ? "bg-indigo-600 text-text" : "bg-surface-raised text-text-muted"}`}
                  >
                    {t("channels.private")}
                  </button>
                </div>
                {!visibility && isPublic && (
                  <p className="text-npc text-xs mt-1">{t("settings.switchToPrivateWarning")}</p>
                )}
                {visibility && !isPublic && (
                  <p className="text-npc text-xs mt-1">{t("settings.switchToPublicWarning")}</p>
                )}
              </div>
              {!visibility && (
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-1">
                    {isPublic ? t("settings.setPassword") : t("settings.changePassword")}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={100}
                    placeholder={
                      isPublic
                        ? t("settings.passwordPlaceholderNew")
                        : t("settings.passwordPlaceholderKeep")
                    }
                    className="w-full px-3 py-2 bg-bg border border-border rounded text-text placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-text-secondary mb-1">
                  {t("settings.inviteCode")}
                </label>
                <div className="flex gap-2">
                  <code className="flex-1 px-3 py-2 bg-bg border border-border rounded text-npc font-mono text-sm">
                    {inviteCode || "—"}
                  </code>
                  <button
                    onClick={copyInviteCode}
                    className="px-3 py-2 bg-surface-raised hover:bg-gray-600 rounded text-sm text-text"
                  >
                    {copied ? t("game.copied") : t("common.copy")}
                  </button>
                </div>
              </div>
              <fieldset className="space-y-3 border-t border-border pt-4" data-motion-settings>
                <legend className="text-sm font-semibold text-text-secondary">
                  {t("settings.npcMotion")}
                </legend>
                <p className="text-caption text-text-muted">{t("settings.npcMotionHint")}</p>
                {NPC_MOTION_KINDS.map((kind) => (
                  <label key={kind} className="block">
                    <span className="flex items-baseline justify-between text-sm text-text-secondary mb-1">
                      <span>{t(`settings.npcMotion.${kind}`)}</span>
                      <span className="text-text tabular-nums">
                        {t("settings.npcMotion.value", {
                          tiles: tilesPerSecond(motion[kind]),
                          times: Math.round((motion[kind] / motion.walk) * 10) / 10,
                        })}
                        {motion[kind] >= RUN_SPEED_THRESHOLD
                          ? ` · ${t("settings.npcMotion.running")}`
                          : ""}
                      </span>
                    </span>
                    <input
                      type="range"
                      data-motion-kind={kind}
                      min={NPC_SPEED_RANGE.min}
                      max={NPC_SPEED_RANGE.max}
                      step={NPC_SPEED_RANGE.step}
                      value={motion[kind]}
                      onChange={(e) => setMotion({ ...motion, [kind]: Number(e.target.value) })}
                      className="w-full"
                    />
                  </label>
                ))}
                <button
                  type="button"
                  data-motion-reset
                  onClick={() => setMotion(DEFAULT_NPC_MOTION)}
                  className="text-sm text-info hover:underline"
                >
                  {t("settings.npcMotion.reset")}
                </button>
              </fieldset>
              {saveError && <p className="text-danger text-sm">{saveError}</p>}
              {saveSuccess && <p className="text-success text-sm">{t("settings.saved")}</p>}
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded font-semibold text-white disabled:opacity-50"
              >
                {saving ? t("common.loading") : t("common.save")}
              </button>
            </div>
          ) : (
            <div>
              {membersLoading ? (
                <p className="text-text-muted text-sm py-4 text-center">
                  {t("settings.loadingMembers")}
                </p>
              ) : membersError ? (
                <p className="text-danger text-sm py-4 text-center">{membersError}</p>
              ) : members.length === 0 ? (
                <p className="text-text-muted text-sm py-4 text-center">
                  {t("settings.noMembers")}
                </p>
              ) : (
                <div className="space-y-2">
                  {members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex items-center justify-between px-3 py-2 bg-bg rounded"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${m.isOnline ? "bg-green-400" : "bg-gray-600"}`}
                        />
                        <span className="text-white text-sm">{m.nickname}</span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${m.role === "owner" ? "bg-amber-600/30 text-npc" : "bg-surface-raised text-text-muted"}`}
                        >
                          {m.role === "owner" ? t("settings.roleOwner") : t("settings.roleMember")}
                        </span>
                      </div>
                      {m.role !== "owner" && (
                        <button
                          onClick={() => setConfirmKick(m)}
                          disabled={kickingUserId === m.userId}
                          className="text-danger hover:text-danger-hover text-xs px-2 py-1 disabled:opacity-50"
                        >
                          {t("settings.kick")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {confirmKick && (
                <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded">
                  <p className="text-sm text-white mb-2">
                    {t("settings.kickConfirm", { name: confirmKick.nickname })}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleKick(confirmKick)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm text-white"
                    >
                      {t("common.confirm")}
                    </button>
                    <button
                      onClick={() => setConfirmKick(null)}
                      className="px-3 py-1 bg-surface-raised hover:bg-gray-600 rounded text-sm text-text-secondary"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
