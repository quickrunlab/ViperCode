import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { HomeScreen } from "../screens/HomeScreen.tsx";
import { PairScreen } from "../screens/PairScreen.tsx";
import { SettingsScreen } from "../screens/SettingsScreen.tsx";
import { theme } from "../../theme/index.ts";

export type RootStackParamList = {
  Home: undefined;
  Pair: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.text,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Viper Code" }} />
        <Stack.Screen name="Pair" component={PairScreen} options={{ title: "Pair Environment" }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
