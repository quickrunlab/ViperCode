import * as Context from "effect/Context";

export interface AzureDevOpsCliShape {}

export class AzureDevOpsCli extends Context.Service<AzureDevOpsCli, AzureDevOpsCliShape>()(
  "vipercode/sourceControl/AzureDevOpsCli",
) {}
