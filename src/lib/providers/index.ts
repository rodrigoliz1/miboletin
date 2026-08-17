import { FederalProvider } from "./federal/provider";
import { JaliscoProvider } from "./jalisco/provider";
import { StjJaliscoProvider } from "./stj/provider";

export const providers = {
  jalisco: new JaliscoProvider(),
  stj: new StjJaliscoProvider(),
  federal: new FederalProvider(),
} as const;

export type ProviderId = keyof typeof providers;
