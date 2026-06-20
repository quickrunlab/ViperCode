import { createEnvironmentCatalogAtoms } from "@vipercode/client-runtime/state/connections";

import { connectionAtomRuntime } from "./runtime";

export const environmentCatalog = createEnvironmentCatalogAtoms(connectionAtomRuntime);
