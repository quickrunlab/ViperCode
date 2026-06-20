import {
  InfoIcon,
  SmartphoneIcon,
  SmartphoneChargingIcon,
  DownloadCloudIcon,
  UnplugIcon,
} from "lucide-react";
import { useAuth } from "@clerk/react";
import { memo, useState } from "react";

import { hasCloudPublicConfig, resolveRelayClerkTokenOptions } from "~/cloud/publicConfig";
import { useViperConnectAuthPrompt } from "../clerk/useViperConnectAuthPrompt";
import { refreshManagedRelayEnvironments } from "~/cloud/managedRelayState";
import { usePrimaryCloudLinkState } from "~/cloud/primaryCloudLinkState";
import {
  linkPrimaryEnvironmentToCloud,
  unlinkPrimaryEnvironmentFromCloud,
  updatePrimaryCloudPreferences,
} from "~/cloud/linkEnvironment";
import { webRuntime } from "~/lib/runtime";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Switch } from "../ui/switch";
import { SettingsSection, SettingsRow } from "./settingsLayout";

function CloudLinkSwitch({
  checked,
  disabled,
  disabledReason,
  onCheckedChange,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly onCheckedChange?: (enabled: boolean) => void;
}) {
  const control = (
    <Switch
      aria-label="Enable Viper Connect"
      checked={checked}
      disabled={disabled}
      {...(onCheckedChange ? { onCheckedChange } : {})}
    />
  );
  return disabledReason ? (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex">{control}</span>} />
      <TooltipPopup side="top">{disabledReason}</TooltipPopup>
    </Tooltip>
  ) : (
    control
  );
}

interface ViperConnectSectionProps {
  readonly canManageRelay: boolean;
}

export const ViperConnectSection = memo(function ViperConnectSection({
  canManageRelay,
}: ViperConnectSectionProps) {
  if (!hasCloudPublicConfig()) return null;

  return <ViperConnectSectionInner canManageRelay={canManageRelay} />;
});

function ViperConnectSectionInner({ canManageRelay }: ViperConnectSectionProps) {
  const { getToken, isSignedIn } = useAuth();
  const { authPrompt, openAuthPrompt } = useViperConnectAuthPrompt();
  const primaryCloudLinkState = usePrimaryCloudLinkState();
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUpdatingPreference, setIsUpdatingPreference] = useState(false);

  const updateLink = async (enabled: boolean) => {
    setIsUpdating(true);
    setOperationError(null);
    try {
      const clerkToken = await getToken(resolveRelayClerkTokenOptions());
      if (enabled) {
        if (!clerkToken) {
          throw new Error("Sign in to Viper Connect before linking this environment.");
        }
        await webRuntime.runPromise(linkPrimaryEnvironmentToCloud({ clerkToken }));
      } else {
        await webRuntime.runPromise(
          unlinkPrimaryEnvironmentFromCloud({ clerkToken: clerkToken ?? null }),
        );
      }
      primaryCloudLinkState.refresh();
      refreshManagedRelayEnvironments();
      toastManager.add({
        type: "success",
        title: enabled ? "Viper Connect linked" : "Viper Connect unlinked",
        description: enabled
          ? "This environment is available through Viper Connect."
          : "This environment is no longer available through Viper Connect.",
      });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Could not update Viper Connect access.";
      setOperationError(message);
      toastManager.add({
        type: "error",
        title: "Could not update Viper Connect",
        description: message,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const updatePublishAgentActivity = async (enabled: boolean) => {
    setIsUpdatingPreference(true);
    try {
      await webRuntime.runPromise(updatePrimaryCloudPreferences({ publishAgentActivity: enabled }));
      primaryCloudLinkState.refresh();
      toastManager.add({
        type: "success",
        title: enabled ? "Agent activity enabled" : "Agent activity disabled",
        description: enabled
          ? "This environment can publish agent activity to your notification devices."
          : "This environment will stop publishing agent activity.",
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not update Viper Connect preferences",
        description:
          cause instanceof Error ? cause.message : "Could not update agent activity publishing.",
      });
    } finally {
      setIsUpdatingPreference(false);
    }
  };

  const disabledReason = !isSignedIn
    ? "Sign in to Viper Connect"
    : !canManageRelay
      ? "Your session does not have permission to manage Viper Connect access."
      : null;
  const linked = primaryCloudLinkState.data?.linked ?? false;

  return (
    <SettingsSection title="Viper Connect">
      <SettingsRow
        title="Viper Connect"
        description={
          linked
            ? "This environment is available to your other devices through Viper Connect."
            : "Make this environment available to your other devices through Viper Connect."
        }
        status={operationError ?? primaryCloudLinkState.error}
        control={
          <CloudLinkSwitch
            checked={linked}
            disabled={
              (isSignedIn && !canManageRelay) || primaryCloudLinkState.isPending || isUpdating
            }
            disabledReason={disabledReason}
            onCheckedChange={(enabled) => {
              if (!isSignedIn) {
                openAuthPrompt();
                return;
              }
              void updateLink(enabled);
            }}
          />
        }
      />

      {linked ? (
        <>
          <SettingsRow
            title="Publish agent activity"
            description="Send agent activity from this environment to your notification devices."
            className="bg-muted/20 pl-7 sm:pl-8"
            control={
              <Switch
                aria-label="Publish agent activity"
                checked={primaryCloudLinkState.data?.publishAgentActivity ?? false}
                disabled={
                  !canManageRelay ||
                  !isSignedIn ||
                  primaryCloudLinkState.isPending ||
                  isUpdatingPreference
                }
                onCheckedChange={(enabled) => void updatePublishAgentActivity(enabled)}
              />
            }
          />
          <MobileSetupSection />
        </>
      ) : null}

      {authPrompt}
    </SettingsSection>
  );
}

function MobileSetupSection() {
  return (
    <div className="border-t border-border/60 px-4 pt-4 pb-3 sm:px-5">
      <div className="mb-3 flex items-center gap-2">
        <SmartphoneIcon className="size-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
          Mobile Setup
        </h3>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <SetupStep
            step={1}
            label="Install the Android APK"
            done={false}
            description={
              <span>
                Download the Viper Code Android app.{" "}
                <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  <DownloadCloudIcon className="size-3" />
                  APK coming soon
                </span>
              </span>
            }
          />
          <SetupStep
            step={2}
            label="Sign in on your phone"
            done={false}
            description="Sign in to the same Viper Connect account in the mobile app."
          />
          <SetupStep
            step={3}
            label="Connect from your phone"
            done={false}
            description="This environment will appear in your mobile environment list. Tap to connect."
          />
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/15 p-3">
          <div className="flex items-start gap-2">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="space-y-2">
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                <strong>Revocation:</strong> Unlinking this environment above removes access for all
                connected mobile devices. Individual device sessions can be revoked from the
                "Authorized clients" section below. Signing out of Viper Connect on any device
                clears that device's local session but does not affect the linked environment.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/80 px-3 py-2">
          <div className="flex items-center gap-2">
            <SmartphoneChargingIcon className="size-4 text-muted-foreground/70" />
            <span className="text-[12px] text-muted-foreground">Linked devices</span>
          </div>
          <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            Available after first mobile connection
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/80 px-3 py-2">
          <div className="flex items-center gap-2">
            <UnplugIcon className="size-4 text-muted-foreground/70" />
            <span className="text-[12px] text-muted-foreground">Last mobile connection</span>
          </div>
          <span className="text-[11px] text-muted-foreground">None yet</span>
        </div>
      </div>
    </div>
  );
}

function SetupStep({
  step,
  label,
  done,
  description,
}: {
  readonly step: number;
  readonly label: string;
  readonly done: boolean;
  readonly description: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          done
            ? "bg-success text-success-foreground"
            : "border border-border bg-muted/40 text-muted-foreground"
        }`}
      >
        {done ? "✓" : step}
      </div>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
