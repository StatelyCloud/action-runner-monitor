// schema.ts - StatelyDB Schema for GitHub Runner Monitoring
import {
  itemType,
  objectType,
  enumType,
  string,
  uint,
  bool,
  timestampMilliseconds,
  arrayOf,
  migrate,
} from "@stately-cloud/schema";

/**
 * Enumeration of possible runner statuses
 */
export const RunnerStatus = enumType("RunnerStatus", {
  ONLINE: 1,
  OFFLINE: 2,
  BUSY: 3,
  UNKNOWN: 4,
  IDLE: 5,
});

/**
 * Label object to store runner capabilities/labels
 */
export const Label = objectType("Label", {
  fields: {
    name: { type: string },
  },
});

/**
 * Repository information
 * Primary grouping entity for runners
 */
export const Repository = itemType("Repository", {
  keyPath: "/repo-:repoId",
  fields: {
    // Repository identifier (owner/name format)
    repoId: { type: string },

    // GitHub repository owner
    owner: { type: string },

    // GitHub repository name
    name: { type: string },

    // Whether this repository is currently being monitored
    isActive: { type: bool },

    // When this repository was first added to monitoring
    createdAt: {
      type: timestampMilliseconds,
      fromMetadata: "createdAtTime",
    },

    // Last time monitoring was performed on this repository
    lastSyncedAt: { type: timestampMilliseconds },
  },
});

/**
 * Runner information
 * Stores metadata and current status for each GitHub runner
 */
export const Runner = itemType("Runner", {
  // Multiple key paths to allow for efficient querying
  keyPath: [
    // Primary key path: Each runner belongs to a repository
    "/repo-:repoId/runner-:name",
  ],
  fields: {
    // GitHub's runner ID (numeric)
    runnerId: { type: uint },

    // Repository this runner belongs to
    repoId: { type: string },

    // Runner name as shown in GitHub
    name: { type: string },

    // Current status of the runner
    status: { type: RunnerStatus },

    // Whether the runner is enabled in GitHub
    enabled: { type: bool },

    // Operating system of the runner
    os: { type: string },

    // Labels assigned to this runner
    labels: { type: arrayOf(Label) },

    // Last time this runner was seen/checked
    lastSeenAt: { type: timestampMilliseconds },

    // First time this runner was discovered
    firstSeenAt: { type: timestampMilliseconds },

    // When this runner record was created
    createdAt: {
      type: timestampMilliseconds,
      fromMetadata: "createdAtTime",
    },

    // Last time this runner record was updated
    updatedAt: {
      type: timestampMilliseconds,
      fromMetadata: "lastModifiedAtTime",
    },
  },
});

/**
 * OutageEvent records a period when a runner was in an unhealthy state
 */
export const OutageEvent = itemType("OutageEvent", {
  keyPath: "/repo-:repoId/history-:runnerId/outage-:outageId",
  ttl: {
    // Outage events are retained for 30 days
    source: "fromCreated",
    durationSeconds: 30 * 24 * 60 * 60,
  },
  fields: {
    // Unique identifier for this outage event
    outageId: {
      type: uint,
      initialValue: "sequence",
    },

    // Repository this outage belongs to
    repoId: { type: string },

    // Runner that experienced the outage
    runnerId: { type: uint },

    // Runner name as shown in GitHub
    runnerName: { type: string, readDefault: "Unknown" },

    // Status that triggered this outage event
    status: { type: RunnerStatus },

    // When the outage was first detected
    startedAt: { type: timestampMilliseconds },

    // When the outage was resolved (null if ongoing)
    resolvedAt: {
      type: timestampMilliseconds,
      required: false,
    },

    // Description of the outage
    description: { type: string },

    // Whether a notification was sent for this outage
    notificationSent: { type: bool },

    // When this outage record was created
    createdAt: {
      type: timestampMilliseconds,
      fromMetadata: "createdAtTime",
    },

    // Last time this outage record was updated
    updatedAt: {
      type: timestampMilliseconds,
      fromMetadata: "lastModifiedAtTime",
    },
  },
});

export const m2 = migrate(
  1,
  "Add runner name to outage event, add a ttl",
  (m) => {
    m.changeType("OutageEvent", (t) => {
      t.addField("runnerName");
    });
  },
);
