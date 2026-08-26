import type { MtClassSession, MtClient, MtMembershipStatus, MtRosterEntry } from '../marianaTek/types.js';

export interface RuleContext {
  client: MtClient;
  status: MtMembershipStatus;
  classSession: MtClassSession;
  rosterEntry: MtRosterEntry;
  now: Date;
  /** Classes checked into in the last 30 days — "are they coming a lot?" for personalizing the ask. */
  attendanceLast30Days: number;
}

export interface FollowUp {
  channel: 'email';
  headline: string;
  message: string;
  /** Send this if no reply to the initial text within this many days (Lucas, 2026-08-26: 2 days default). */
  afterDays: number;
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
  /** Email fallback if the initial text gets no reply — undefined for non-sales touches (e.g. day-1 welcome). */
  followUp?: FollowUp;
}

export type Rule = (ctx: RuleContext) => ProposedAction | null;
