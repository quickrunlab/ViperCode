import type { SourceControlProviderAuth } from "@vipercode/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface BitbucketApiShape {
  readonly probeAuth: Effect.Effect<SourceControlProviderAuth>;
}

export class BitbucketApi extends Context.Service<BitbucketApi, BitbucketApiShape>()(
  "vipercode/sourceControl/BitbucketApi",
) {}
