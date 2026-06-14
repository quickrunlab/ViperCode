export type MobilePlatform = "android";

export interface MobileDeviceRegistration {
  readonly deviceId: string;
  readonly platform: MobilePlatform;
  readonly label: string;
  readonly appVersion: string;
  readonly pushToken: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegisterAndroidDeviceRequest {
  readonly deviceId: string;
  readonly label: string;
  readonly appVersion: string;
  readonly pushToken: string | null;
}

export interface RegisterAndroidDeviceResponse {
  readonly deviceId: string;
  readonly registeredAt: string;
}

export const NOTIFICATION_TRIGGERS = {
  taskCompleted: "task.completed",
  taskBlocked: "task.blocked",
  approvalNeeded: "approval.needed",
  userInputNeeded: "user-input.needed",
} as const;

export type NotificationTriggerKind =
  (typeof NOTIFICATION_TRIGGERS)[keyof typeof NOTIFICATION_TRIGGERS];

export interface NotificationPayload {
  readonly kind: NotificationTriggerKind;
  readonly environmentId: string;
  readonly label: string;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly message: string;
}

export interface NotificationState {
  readonly permissionGranted: boolean;
  readonly pushToken: string | null;
  readonly deviceId: string;
  readonly isRegistered: boolean;
}
