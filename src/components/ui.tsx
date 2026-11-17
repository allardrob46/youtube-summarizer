/**
 * Small pieces shared by the screens. Everything visual comes from HeroUI Native;
 * these only fix spacing and the one typographic motif the app repeats:
 * timestamps set in a monospaced face so they line up like a margin column.
 */
import { Ionicons } from "@expo/vector-icons";
import { Typography, useThemeColor } from "heroui-native";
import type { ComponentProps, JSX, ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon({
  name,
  size = 20,
  color = "foreground",
}: {
  name: IconName;
  size?: number;
  color?: "foreground" | "muted" | "accent" | "danger" | "accent-foreground";
}): JSX.Element {
  const value = useThemeColor(color);
  return <Ionicons name={name} size={size} color={value} />;
}

/** Page wrapper: paper background and safe-area padding at the top. */
export function Screen({ children }: { children: ReactNode }): JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {children}
    </View>
  );
}

/** Section heading inside a long page. Sentence case, no shouting. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }): JSX.Element {
  return (
    <View className="mb-3 mt-8 flex-row items-baseline justify-between">
      <Typography.Heading type="h5">{children}</Typography.Heading>
      {aside}
    </View>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
