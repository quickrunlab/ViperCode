import { AppState, type AppStateStatus } from "react-native";

export type AppLifecyclePhase = "active" | "background" | "inactive";

function toPhase(state: AppStateStatus): AppLifecyclePhase {
  if (state === "active") return "active";
  if (state === "background") return "background";
  return "inactive";
}

export interface AppLifecycleHandlers {
  readonly onForeground: () => void;
  readonly onBackground: () => void;
}

export function subscribeAppLifecycle(handlers: AppLifecycleHandlers): () => void {
  let lastPhase = toPhase(AppState.currentState);

  const subscription = AppState.addEventListener("change", (nextState) => {
    const nextPhase = toPhase(nextState);
    if (lastPhase === nextPhase) return;

    if (nextPhase === "active" && lastPhase !== "active") {
      handlers.onForeground();
    } else if (nextPhase !== "active" && lastPhase === "active") {
      handlers.onBackground();
    }

    lastPhase = nextPhase;
  });

  return () => {
    subscription.remove();
  };
}
