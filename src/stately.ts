import { SortDirection } from "@stately-cloud/client";
import {
  DatabaseClient,
  OutageEvent,
  Runner,
  RunnerStatus,
} from "./schema/index";

/**
 * List of runner statuses that are considered unhealthy
 * Used to determine when to create outage events and send notifications
 */
export const UNHEALTHY_STATUSES = [
  RunnerStatus.RunnerStatus_OFFLINE,
  RunnerStatus.RunnerStatus_UNKNOWN,
];

/**
 * Fetches all existing runners from StatelyDB for a given repository
 * @param client - The StatelyDB client
 * @param repoId - The ID of the repository to fetch runners for
 * @returns A promise that resolves to a Map of runner IDs to runner objects
 */
export async function fetchAllStatelyRunners(
  client: DatabaseClient,
  repoId: string,
): Promise<Map<BigInt, Runner>> {
  const runners = new Map<BigInt, Runner>();

  // List all runners for this repository
  for await (const item of client.beginList(`/repo-${repoId}/runner-`)) {
    if (client.isType(item, "Runner")) {
      runners.set(item.runnerId, item);
    }
  }

  return runners;
}

/**
 * Creates a new outage event for a runner in StatelyDB
 * @param client - The StatelyDB client
 * @param runner - The runner with the outage
 * @returns A promise that resolves to the created OutageEvent
 */
export async function createOutageEvent(
  client: DatabaseClient,
  runner: Runner,
): Promise<OutageEvent> {
  // Create a new outage event
  const outage = await client.put(
    client.create("OutageEvent", {
      repoId: runner.repoId,
      runnerId: runner.runnerId,
      runnerName: runner.name,
      status: runner.status,
      startedAt: BigInt(Date.now()),
      description: `Runner ${runner.name} entered ${statusToString(
        runner.status,
      )} state`,
      notificationSent: false,
    }),
  );
  console.log(`Created new outage event for runner ${runner.name}`);
  return outage;
}

/**
 * Resolves any existing outage events for a runner when it recovers
 * @param client - The StatelyDB client
 * @param runner - The runner that has recovered
 * @returns A promise that resolves to the resolved OutageEvent
 * @throws Error if no ongoing outage is found for the runner
 */
export async function resolveOutageEvent(
  client: DatabaseClient,
  runner: Runner,
): Promise<OutageEvent> {
  // Find the last outage for this runner
  for await (const item of client.beginList(
    `/repo-${runner.repoId}/history-${runner.runnerId}/outage-`,
    { limit: 1, sortDirection: SortDirection.SORT_DESCENDING },
  )) {
    if (client.isType(item, "OutageEvent") && !item.resolvedAt) {
      // Mark outage as resolved
      item.resolvedAt = BigInt(Date.now());
      await client.put(item);
      console.log(
        `Resolved outage ${item.outageId} for runner ${runner.runnerId}`,
      );
      return item;
    }
  }
  throw new Error(`No ongoing outage found for runner ${runner.runnerId}`);
}

/**
 * Converts a runner status enum value to a readable string
 * @param runnerStatus - The runner status enum value
 * @returns A human-readable string representation of the status
 */
export function statusToString(runnerStatus: RunnerStatus): string {
  switch (runnerStatus) {
    case RunnerStatus.RunnerStatus_ONLINE:
      return "Online";
    case RunnerStatus.RunnerStatus_OFFLINE:
      return "Offline";
    case RunnerStatus.RunnerStatus_BUSY:
      return "Busy";
    case RunnerStatus.RunnerStatus_UNKNOWN:
      return "Unknown";
    case RunnerStatus.RunnerStatus_IDLE:
      return "Idle";
    default:
      return `Unknown status (${runnerStatus})`;
  }
}

/**
 * Ensures a repository exists in StatelyDB, creating it if necessary
 * @param statelyClient - The StatelyDB client
 * @param repo - The repository name in the format "owner/repo"
 * @returns A promise that resolves to the repository object
 */
export async function ensureStatelyRepo(
  statelyClient: DatabaseClient,
  repo: string,
) {
  // Create or update Repository item
  const [owner, name] = repo.split("/");
  const repoId = name;
  let repository = await statelyClient.get("Repository", `/repo-${repoId}`);

  if (!repository) {
    // Create new repository record
    repository = statelyClient.create("Repository", {
      repoId,
      owner,
      name,
      isActive: true,
      lastSyncedAt: BigInt(Date.now()),
    });

    await statelyClient.put(repository);
    console.log(`Created new repository record for ${repoId}`);
  } else {
    // Update existing repository
    repository.lastSyncedAt = BigInt(Date.now());
    await statelyClient.put(repository);
  }
  return repository;
}
