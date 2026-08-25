import type { MtClassSession, MtClient, MtMembershipStatus, MtRosterEntry } from '../marianaTek/types.js';

export interface RuleContext {
  client: MtClient;
  status: MtMembershipStatus;
  classSession: MtClassSession;
  rosterEntry: MtRosterEntry;
  now: Date;
}

export interface ProposedAction {
  /** Stable id for touch-log dedup/cooldown — do not change once live without migrating the touch log. */
  segmentKey: string;
  segmentLabel: string;
  channel: 'email' | 'text';
  headline: string;
  message: string;
  /** Don't propose this same segment again for the same client within this many days. */
  cooldownDays: number;
}

export type Rule = (ctx: RuleContext) => ProposedAction | null;
