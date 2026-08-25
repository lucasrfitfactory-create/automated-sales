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
}

// Discriminated union — what a client's standing looks like at the moment
// we assess them, as read from Mariana Tek. This is the input to the rules
// engine (src/rules/engine.ts).
export type MtMembershipStatus =
  | {
      kind: 'intro_offer';
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
}
