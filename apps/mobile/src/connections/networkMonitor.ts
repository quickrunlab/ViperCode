import NetInfo from "@react-native-community/netinfo";

export interface NetworkStateHandlers {
  readonly onOnline: () => void;
  readonly onOffline: () => void;
}

export function subscribeNetworkState(handlers: NetworkStateHandlers): () => void {
  let wasOffline = false;

  const unsubscribe = NetInfo.addEventListener((state) => {
    const isOffline = !(state.isConnected ?? false);

    if (isOffline && !wasOffline) {
      wasOffline = true;
      handlers.onOffline();
    } else if (!isOffline && wasOffline) {
      wasOffline = false;
      handlers.onOnline();
    }
  });

  return unsubscribe;
}
