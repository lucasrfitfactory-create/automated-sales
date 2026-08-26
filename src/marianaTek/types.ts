export interface MtClient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

export interface MtClassSession {
  id: string;
  className: string;
  instructor: string;
  startTime: string; // ISO
  locationId: string;
}

export interface MtRosterEntry {
  classSessionId: string;
  clientId: string;
  attended: boolean;
  /**
   * How this specific booking was made. 'classpass' = shows in Mariana Tek
   * as "Guest of ClassPass" — a booking-channel signal independent of the
   * client's underlying membership status (they might otherwise show as
   * no_active_status, or already hold some other pack/trial).
   * TODO: confirm the actual field/shape once we have real Admin API roster
   * responses — this may live on the reservation rather than the roster row.
   */
  bookingSource: 'direct' | 'classpass';
}

// Discriminated union — what a client's standing looks like at the moment
// we assess them, as read from Mariana Tek. This is the input to the rules
// engine (src/rules/engine.ts).
export type MtMembershipStatus =
  | {
      kind: 'trial_offer';
      offerName: string;
      startDate: string; // ISO date
      endDate: string; // ISO date
      classesUsed: number;
      classesIncluded: number;
    }
  | {
      kind: 'class_pack';
      packName: string;
      classesRemaining: number;
      classesTotal: number;
      expiresAt: string | null; // ISO date, null = no expiry
    }
  | {
      kind: 'membership_active';
      planName: string;
      memberSince: string; // ISO date
    }
  | {
      kind: 'membership_paused';
      planName: string;
      resumesAt: string | null;
    }
  | {
      kind: 'membership_lapsed';
      planName: string;
      endedAt: string; // ISO date
    }
  | {
      kind: 'no_active_status';
    };

export interface MarianaTekClient {
  /** Class sessions at the configured location that started before `before` and haven't been fetched yet. */
  getClassSessions(params: { locationId: string; since: string; before: string }): Promise<MtClassSession[]>;
  getRoster(classSessionId: string): Promise<MtRosterEntry[]>;
  getClient(clientId: string): Promise<MtClient>;
  getMembershipStatus(clientId: string): Promise<MtMembershipStatus>;
  /** How many classes this client has checked into since `sinceIso` — the "are they coming a lot?" signal for personalizing outreach. */
  getRecentAttendanceCount(clientId: string, sinceIso: string): Promise<number>;
}
