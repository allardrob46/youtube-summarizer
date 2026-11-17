import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useThemeColor } from "heroui-native";
import type { JSX } from "react";
import type { ColorValue } from "react-native";

import type { IconName } from "@/components/ui";

function TabIcon({ name, color }: { name: IconName; color: ColorValue }): JSX.Element {
  // RN 0.88's `ColorValue` also admits `null` and processed numbers, which Ionicons rejects.
  const iconColor = color === null || typeof color === "number" ? undefined : color;
  return <Ionicons name={name} size={24} color={iconColor} />;
}

export default function TabsLayout(): JSX.Element {
  const [surface, border, accent, muted] = useThemeColor(["surface", "border", "accent", "muted"]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: muted,
        tabBarStyle: { backgroundColor: surface, borderTopColor: border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Summarize",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "create" : "create-outline"} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "library" : "library-outline"} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
