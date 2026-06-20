import { createAuthEnvironmentAtoms } from "@vipercode/client-runtime/state/auth";

import { connectionAtomRuntime } from "../connection/runtime";

export const authEnvironment = createAuthEnvironmentAtoms(connectionAtomRuntime);
