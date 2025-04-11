// probe.ts - AWS Lambda function for GitHub Runner Monitoring
import {
  createClient,
  Runner,
  RunnerStatus,
  DatabaseClient,
} from "./schema/index";
import {
  SSMClient,
  GetParametersCommand,
} from "@aws-sdk/client-ssm";
import { accessKeyAuth, SortDirection } from "@stately-cloud/client";
import axios from "axios";

// SSM parameter paths
const SSM_GITHUB_TOKEN = "/github-runner-monitor/github-token";
const SSM_STATELYDB_ACCESS_KEY = "/github-runner-monitor/statelydb-access-key";
const SSM_STATELYDB_STORE_ID = "/github-runner-monitor/statelydb-store-id";
const SSM_STATELYDB_REGION = "/github-runner-monitor/statelydb-region";
const SSM_REPOSITORIES = "/github-runner-monitor/repositories";
const SSM_SLACK_WEBHOOK = "/github-runner-monitor/slack-webhook";

// Initialize the SSM client
const ssm = new SSMClient();

// Statuses that are considered "unhealthy"
const UNHEALTHY_STATUSES = [
  RunnerStatus.RunnerStatus_OFFLINE,
  RunnerStatus.RunnerStatus_UNKNOWN,
];

interface GitHubRunner {
  id: number;
  name: string;
  status: string;
  busy: boolean;
  os: string;
  labels: { name: string }[];
  enabled: boolean;
}

/**
 * Main Lambda handler function
 */
export const handler = async (_event: Record<string, unknown>) => {
  console.log("Starting GitHub runner monitoring process");

  try {
    // Fetch all required parameters from SSM
    const params = await fetchSSMParameters();

    // Display debugging info
    console.log("Fetched parameters:", {
      statelydbStoreId: params.statelydbStoreId,
      statelydbRegion: params.statelydbRegion,
      repositories: params.repositories,
    });

    // Initialize StatelyDB client
    const statelyClient = createClient(BigInt(params.statelydbStoreId), {
      authTokenProvider: accessKeyAuth({
        accessKey: params.statelydbAccessKey,
      }),
      region: params.statelydbRegion,
    });

    // Parse the list of repositories to monitor
    const repositories = JSON.parse(params.repositories);

    // Process each repository
    for (const repo of repositories) {
      try {
        console.log(`Processing repository: ${repo}`);

        // Create or update Repository item
        const [owner, name] = repo.split("/");
        const repoId = name;

        let repository = await statelyClient.get(
          "Repository",
          `/repo-${repoId}`,
        );

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

        // Fetch runners from GitHub API
        const runners = await fetchGitHubRunners(repo, params.githubToken);
        console.log(`Found ${runners.length} runners for repository ${repoId}`);

        // Get existing runners from StatelyDB
        const existingRunners = await fetchExistingRunners(
          statelyClient,
          repoId,
        );

        // Track processed runner IDs to detect missing runners
        const processedRunnerIds = new Set<bigint>();

        // Process each runner from GitHub
        for (const githubRunner of runners) {
          processedRunnerIds.add(BigInt(githubRunner.id));

          // Map GitHub runner status to our enum
          const status = mapGitHubStatus(githubRunner);

          // Check if runner already exists
          const existingRunner = existingRunners.find(
            (r) => r.runnerId === BigInt(githubRunner.id),
          );

          if (existingRunner) {
            // Update existing runner
            const oldStatus = existingRunner.status;
            existingRunner.name = githubRunner.name;
            existingRunner.status = status;
            existingRunner.enabled = githubRunner.enabled;
            existingRunner.os = githubRunner.os;
            existingRunner.labels = githubRunner.labels.map((label) =>
              statelyClient.create("Label", { name: label.name }),
            );
            existingRunner.lastSeenAt = BigInt(Date.now());

            await statelyClient.put(existingRunner);

            // Check if runner entered an unhealthy state
            if (UNHEALTHY_STATUSES.includes(status) && status !== oldStatus) {
              await handleUnhealthyRunner(
                statelyClient,
                existingRunner,
                status,
                params.slackWebhook,
              );
            }

            // Check if runner recovered from an unhealthy state
            if (
              !UNHEALTHY_STATUSES.includes(status) &&
              UNHEALTHY_STATUSES.includes(oldStatus)
            ) {
              const outageId = await resolveOutage(
                statelyClient,
                repoId,
                githubRunner.id,
              );
              if (params.slackWebhook) {
                await sendSlackRecoveryNotification(
                  params.slackWebhook,
                  existingRunner,
                  status,
                  outageId,
                );
              }
            }
          } else {
            // Create new runner record
            const now = BigInt(Date.now());
            const newRunner = statelyClient.create("Runner", {
              runnerId: BigInt(githubRunner.id),
              repoId,
              name: githubRunner.name,
              status,
              enabled: githubRunner.enabled,
              os: githubRunner.os,
              labels: githubRunner.labels,
              lastSeenAt: now,
              firstSeenAt: now,
            });

            await statelyClient.put(newRunner);
            console.log(
              `Created new runner record for ${githubRunner.name} (${githubRunner.id})`,
            );

            // Check if new runner is already in an unhealthy state
            if (UNHEALTHY_STATUSES.includes(status) && params.slackWebhook) {
              await handleUnhealthyRunner(
                statelyClient,
                newRunner,
                status,
                params.slackWebhook,
              );
            }
          }
        }

        // Check for missing runners (runners that exist in our DB but weren't returned by GitHub)
        for (const existingRunner of existingRunners) {
          if (!processedRunnerIds.has(existingRunner.runnerId)) {
            console.log(
              `Runner ${existingRunner.name} (${existingRunner.runnerId}) was not found in GitHub response`,
            );

            // Only update status to UNKNOWN if it's not already UNKNOWN
            if (existingRunner.status !== RunnerStatus.RunnerStatus_UNKNOWN) {
              const oldStatus = existingRunner.status;
              existingRunner.status = RunnerStatus.RunnerStatus_UNKNOWN;

              // Don't update lastSeenAt since we didn't actually see the runner

              await statelyClient.put(existingRunner);
              console.log(
                `Updated runner ${existingRunner.name} status to UNKNOWN`,
              );

              // Create an outage event if this is a new transition to UNKNOWN
              if (
                !UNHEALTHY_STATUSES.includes(oldStatus) &&
                params.slackWebhook
              ) {
                await handleUnhealthyRunner(
                  statelyClient,
                  existingRunner,
                  RunnerStatus.RunnerStatus_UNKNOWN,
                  params.slackWebhook,
                );
              }
            }
          }
        }
      } catch (repoError) {
        console.error(`Error processing repository ${repo}:`, repoError);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "GitHub runner monitoring completed successfully",
      }),
    };
  } catch (error) {
    console.error("Error in GitHub runner monitoring:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error in GitHub runner monitoring",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};

/**
 * Fetch all SSM parameters needed for the function
 */
async function fetchSSMParameters() {
  if (process.env.AWS_SAM_LOCAL) {
    // Return mock parameters for local testing
    return {
      githubToken: process.env.GITHUB_TOKEN,
      statelydbAccessKey: process.env.STATELYDB_ACCESS_KEY,
      statelydbStoreId: process.env.STATELYDB_STORE_ID,
      statelydbRegion: process.env.STATELYDB_REGION,
      repositories: process.env.REPOS,
      slackWebhook: process.env.SLACK_WEBHOOK,
    };
  }

  const parameterResponse = await ssm.send(
    new GetParametersCommand({
      Names: [
        SSM_GITHUB_TOKEN,
        SSM_STATELYDB_ACCESS_KEY,
        SSM_STATELYDB_STORE_ID,
        SSM_STATELYDB_REGION,
        SSM_REPOSITORIES,
        SSM_SLACK_WEBHOOK,
      ],
      WithDecryption: true,
    }),
  );

  const getParameter = (name: string) => {
    const param = parameterResponse.Parameters?.find((p) => p.Name === name);
    if (!param || !param.Value) {
      throw new Error(`Parameter ${name} not found`);
    }
    return param.Value;
  };

  return {
    githubToken: getParameter(SSM_GITHUB_TOKEN),
    statelydbAccessKey: getParameter(SSM_STATELYDB_ACCESS_KEY),
    statelydbStoreId: getParameter(SSM_STATELYDB_STORE_ID),
    statelydbRegion: getParameter(SSM_STATELYDB_REGION),
    repositories: getParameter(SSM_REPOSITORIES),
    slackWebhook: getParameter(SSM_SLACK_WEBHOOK),
  };
}

/**
 * Fetch runners for a repository from GitHub API
 */
async function fetchGitHubRunners(
  repo: string,
  githubToken: string,
): Promise<GitHubRunner[]> {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${repo}/actions/runners`,
      {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    return response.data.runners;
  } catch (error) {
    console.error(`Error fetching runners for repository ${repo}:`, error);
    throw error;
  }
}

/**
 * Fetch existing runners from StatelyDB for a repository
 */
async function fetchExistingRunners(client: DatabaseClient, repoId: string) {
  const runners: Runner[] = [];

  // List all runners for this repository
  for await (const item of client.beginList(`/repo-${repoId}/runner-`)) {
    if (client.isType(item, "Runner")) {
      runners.push(item);
    }
  }

  return runners;
}

/**
 * Map GitHub runner status to our RunnerStatus enum
 */
function mapGitHubStatus(githubRunner: GitHubRunner): number {
  // Handle offline first
  if (githubRunner.status !== "online") {
    return RunnerStatus.RunnerStatus_OFFLINE;
  }

  // Then handle busy vs idle
  if (githubRunner.busy) {
    return RunnerStatus.RunnerStatus_BUSY;
  } else {
    return RunnerStatus.RunnerStatus_IDLE;
  }
}

/**
 * Handle a runner that has entered an unhealthy state
 */
async function handleUnhealthyRunner(
  client: DatabaseClient,
  runner: Runner,
  status: number,
  slackWebhook: string,
) {
  console.log(
    `Runner ${runner.name} (${runner.runnerId}) is now in unhealthy state: ${status}`,
  );

  // Create a new outage event
  const outage = await client.put(
    client.create("OutageEvent", {
      repoId: runner.repoId,
      runnerId: runner.runnerId,
      runnerName: runner.name,
      status,
      startedAt: BigInt(Date.now()),
      description: `Runner ${runner.name} entered ${statusToString(
        status,
      )} state`,
      notificationSent: false,
    }),
  );
  console.log(`Created new outage event for runner ${runner.name}`);

  // Send notification to Slack
  try {
    await sendSlackNotification(slackWebhook, runner, status, outage.outageId);

    // Update outage to mark notification as sent
    outage.notificationSent = true;
    await client.put(outage);
  } catch (error) {
    console.error(`Error sending Slack notification for outage:`, error);
  }
}

/**
 * Resolve any existing outages for a runner
 */
async function resolveOutage(
  client: DatabaseClient,
  repoId: string,
  runnerId: number,
): Promise<bigint> {
  let lastOutageId: bigint = BigInt(0);
  // Find the last outage for this runner
  for await (const item of client.beginList(
    `/repo-${repoId}/history-${runnerId}/outage-`,
    { limit: 1, sortDirection: SortDirection.SORT_DESCENDING },
  )) {
    if (client.isType(item, "OutageEvent") && !item.resolvedAt) {
      // Mark outage as resolved
      item.resolvedAt = BigInt(Date.now());
      await client.put(item);
      lastOutageId = item.outageId;
      console.log(`Resolved outage ${item.outageId} for runner ${runnerId}`);
    }
  }
  return lastOutageId;
}

/**
 * Send notification to Slack
 */
async function sendSlackNotification(
  slackWebhook: string,
  runner: Runner,
  status: number,
  outageId: bigint,
) {
  const statusText = statusToString(status);

  const message = {
    text: `🚨 GitHub Runner Alert 🚨`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🚨 GitHub Runner Alert: ${statusText} 🚨`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Repository:*\n${runner.repoId}`,
          },
          {
            type: "mrkdwn",
            text: `*Runner:*\n${runner.name}`,
          },
          {
            type: "mrkdwn",
            text: `*Status:*\n${statusText}`,
          },
          {
            type: "mrkdwn",
            text: `*Outage ID:*\n${outageId}`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Detected at ${new Date().toISOString()}`,
          },
        ],
      },
    ],
  };

  await axios.post(slackWebhook, message);
  console.log(`Sent Slack notification for runner ${runner.name}`);
}

/**
 * Send recovery notification to Slack
 */
async function sendSlackRecoveryNotification(
  slackWebhook: string,
  runner: Runner,
  status: number,
  outageId: bigint,
) {
  const statusText = statusToString(status);

  const message = {
    text: `✅ GitHub Runner Recovery`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `✅ GitHub Runner Recovered: ${statusText}`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Repository:*\n${runner.repoId}`,
          },
          {
            type: "mrkdwn",
            text: `*Runner:*\n${runner.name}`,
          },
          {
            type: "mrkdwn",
            text: `*New Status:*\n${statusText}`,
          },
          {
            type: "mrkdwn",
            text: `*Resolved Outage:*\n${outageId}`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Recovered at ${new Date().toISOString()}`,
          },
        ],
      },
    ],
  };

  await axios.post(slackWebhook, message);
  console.log(`Sent Slack recovery notification for runner ${runner.name}`);
}

/**
 * Convert status enum value to string
 */
function statusToString(status: number): string {
  switch (status) {
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
      return `Unknown status (${status})`;
  }
}
