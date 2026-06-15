import { NavigationContainer, type LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { HomeScreen } from "../screens/HomeScreen.tsx";
import { PairScreen } from "../screens/PairScreen.tsx";
import { EnvironmentThreadsScreen } from "../screens/EnvironmentThreadsScreen.tsx";
import { ThreadDetailScreen } from "../screens/ThreadDetailScreen.tsx";
import { NewThreadScreen } from "../screens/NewThreadScreen.tsx";
import { SettingsScreen } from "../screens/SettingsScreen.tsx";
import { theme } from "../../theme/index.ts";

export type RootStackParamList = {
  Home: undefined;
  Pair: undefined;
  EnvironmentThreads: { environmentId: string; label: string };
  ThreadDetail: { environmentId: string; threadId: string; title: string };
  NewThread: {
    environmentId: string;
    label: string;
    projects: ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>;
    providers: ReadonlyArray<{
      instanceId: string;
      label: string;
      driverLabel: string;
      availability: "ready" | "unavailable" | "needs-setup";
      message: string | null;
    }>;
  };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator({
  linking,
}: {
  readonly linking: LinkingOptions<RootStackParamList>;
}) {
  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.primary,
          headerTitleStyle: { fontFamily: theme.font.sans, fontWeight: "700", fontSize: 20 },
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Viper Code" }} />
        <Stack.Screen name="Pair" component={PairScreen} options={{ title: "Pair Environment" }} />
        <Stack.Screen
          name="EnvironmentThreads"
          component={EnvironmentThreadsScreen}
          options={({ route }) => ({ title: route.params.label })}
        />
        <Stack.Screen
          name="ThreadDetail"
          component={ThreadDetailScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
        <Stack.Screen
          name="NewThread"
          component={NewThreadScreen}
          options={{ title: "New Thread" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
