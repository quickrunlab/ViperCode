import React from "react";
import { RootProvider } from "./providers/RootProvider.tsx";
import { AppNavigator } from "./navigation/AppNavigator.tsx";
import { MobileConnectionProvider } from "../connections/ConnectionProvider.tsx";

export function App() {
  return (
    <RootProvider>
      <MobileConnectionProvider>
        <AppNavigator />
      </MobileConnectionProvider>
    </RootProvider>
  );
}
