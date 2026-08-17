import { FederalProvider } from "./federal/provider";
import { JaliscoProvider } from "./jalisco/provider";

export const providers = {
  jalisco: new JaliscoProvider(),
  federal: new FederalProvider(),
} as const;

export type ProviderId = keyof typeof providers;
