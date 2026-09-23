"use client";

// crew-office: Hermes 프로필 없이 이 PC 의 Claude Code·Codex CLI 로 일하는 직원을 고용한다.
import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";
import {
  CLI_EMPLOYEE_ADAPTERS,
  CLI_EMPLOYEE_LIMITS,
  type CliEmployeeAdapter,
} from "@/lib/cli-employees";
import { officeLookAppearance } from "@/game/three/office-looks";
import OfficeLookGallery from "./OfficeLookGallery";

type AdapterStatus = { installed: boolean; version?: string };

const CLI_LABEL: Record<CliEmployeeAdapter, string> = { claude: "Claude Code", codex: "Codex" };

export default function CliEmployeeHireModal({
  channelId,
  onClose,
  onHired,
}: {
  channelId: string;
  onClose: () => void;
  onHired: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [adapterType, setAdapterType] = useState<CliEmployeeAdapter>("claude");
  const [model, setModel] = useState("");
  const [soul, setSoul] = useState("");
  const [lookId, setLookId] = useState<string | undefined>();
  const [status, setStatus] = useState<Partial<Record<CliEmployeeAdapter, AdapterStatus>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/adapters/status", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { adapters?: Record<string, AdapterStatus> } | null) => {
        if (data?.adapters) setStatus(data.adapters);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const installed = status[adapterType]?.installed;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/${channelId}/cli-employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          adapterType,
          model,
          soul,
          appearance: lookId ? officeLookAppearance(lookId) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      onHired();
      onClose();
    } catch (err) {
      setError(getLocalizedErrorMessage(t, err, "cliHire.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cli-hire-title"
    >
      <div className="max-h-[90vh] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-lg border border-border bg-surface p-4 text-text">
        <h2 id="cli-hire-title" className="text-base font-semibold">
          {t("cliHire.title")}
        </h2>
        <p className="mt-1 text-xs text-text-muted">{t("cliHire.description")}</p>

        <label className="mt-4 block text-xs text-text-secondary">
          {t("cliHire.name")}
          <input
            value={name}
            maxLength={CLI_EMPLOYEE_LIMITS.name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-raised p-2 text-sm text-text"
          />
        </label>

        <fieldset className="mt-3">
          <legend className="text-xs text-text-secondary">{t("cliHire.cli")}</legend>
          <div className="mt-1 flex gap-2">
            {CLI_EMPLOYEE_ADAPTERS.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={adapterType === type}
                onClick={() => setAdapterType(type)}
                className={`flex-1 rounded border px-2 py-2 text-left text-sm ${
                  adapterType === type
                    ? "border-primary bg-primary/15"
                    : "border-border bg-surface-raised"
                }`}
              >
                <span className="block font-semibold">{CLI_LABEL[type]}</span>
                <span className="block text-micro text-text-muted">
                  {status[type] === undefined
                    ? t("cliHire.checking")
                    : status[type]?.installed
                      ? (status[type]?.version ?? t("cliHire.installed"))
                      : t("cliHire.notInstalled")}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-3 block text-xs text-text-secondary">
          {t("cliHire.model")}
          <input
            value={model}
            maxLength={CLI_EMPLOYEE_LIMITS.model}
            placeholder={t("cliHire.modelPlaceholder")}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-raised p-2 text-sm text-text"
          />
        </label>

        <label className="mt-3 block text-xs text-text-secondary">
          {t("cliHire.soul")}
          <textarea
            value={soul}
            maxLength={CLI_EMPLOYEE_LIMITS.soul}
            rows={5}
            placeholder={t("cliHire.soulPlaceholder")}
            onChange={(e) => setSoul(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-raised p-2 text-sm text-text"
          />
        </label>

        <div className="mt-3">
          <p className="text-xs text-text-secondary">{t("cliHire.look")}</p>
          <OfficeLookGallery selectedId={lookId} onSelect={(look) => setLookId(look.id)} />
        </div>

        {installed === false && (
          <p className="mt-3 text-xs text-danger">{t("cliHire.notInstalledHint")}</p>
        )}
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-surface-raised"
          >
            {t("cliHire.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !name.trim() || installed === false}
            className="rounded-md bg-primary/80 px-3 py-2 text-sm font-semibold text-white hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t("cliHire.hiring") : t("cliHire.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
