import { createReviewEnvironmentAtoms } from "@vipercode/client-runtime/state/review";

import { connectionAtomRuntime } from "../connection/runtime";

export const reviewEnvironment = createReviewEnvironmentAtoms(connectionAtomRuntime);
