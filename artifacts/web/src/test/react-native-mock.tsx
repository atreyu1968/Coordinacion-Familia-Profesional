import React from "react";
import { vi } from "vitest";

type ConfirmationButton = {
  text: string;
  onPress?: () => void;
};

export const alertMock = vi.fn<
  (
    title: string,
    message: string,
    buttons?: ConfirmationButton[],
  ) => void
>();

export const Alert = { alert: alertMock };

export function View({
  children,
  testID,
}: {
  children?: React.ReactNode;
  testID?: string;
}) {
  return <div data-testid={testID}>{children}</div>;
}

export function Text({ children }: { children?: React.ReactNode }) {
  return <span>{children}</span>;
}

export function Pressable({
  children,
  onPress,
  accessibilityRole,
  accessibilityLabel,
  disabled,
}: {
  children?: React.ReactNode;
  onPress?: () => void;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
