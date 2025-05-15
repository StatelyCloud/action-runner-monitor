import { accessKeyAuth } from "@stately-cloud/client";
import { fetchSSMParameters, SSMParams } from "./config";
import { fetchAllGithubRunners, GitHubRunner, mapGitHubStatus } from "./github";
import {
  createClient,
  DatabaseClient,
  Runner,
  RunnerStatus,
} from "./schema/index";
import {
  sendSlackOutageNotification,
  sendSlackRecoveryNotification,
} from "./slack";
import {
  createOutageEvent,
  ensureStatelyRepo,
  fetchAllStatelyRunners,
  resolveOutageEvent,
  UNHEALTHY_STATUSES,
} from "./stately";

/**
 * Main Lambda handler function for GitHub runner monitoring
 * Fetches parameters, initializes the StatelyDB client, and processes each repository
 * @param _event - AWS Lambda event object
 * @returns A promise that resolves to the Lambda response with a status code and body
 */
export const handler = async (_event: Record<string, unknown>) => {
  console.log("Starting GitHub runner monitoring process");

  try {
    // Fetch all required parameters from SSM
    const params = await fetchSSMParameters();

    // Initialize StatelyDB client
    const statelyClient = createClient(params.statelydbStoreId, {
      authTokenProvider: accessKeyAuth({
        accessKey: params.statelydbAccessKey,
      }),
      region: params.statelydbRegion,
    });

    // Process each repository in parallel
    await Promise.all(
      params.repositories.map((repo) =>
        updateRepo(repo, statelyClient, params),
      ),
    );
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

async function updateRepo(
  repo: string,
  statelyClient: DatabaseClient,
  params: SSMParams,
) {
  try {
    console.log(`Processing repository: ${repo}`);

    const repository = await ensureStatelyRepo(statelyClient, repo);

    // Fetch runners from GitHub API for Repositories
    const githubRunners = await fetchAllGithubRunners(repo, params);

    // Get existing runners from StatelyDB
    const statelyRunners = await fetchAllStatelyRunners(
      statelyClient,
      repository.repoId,
    );

    // Handle for missing runners (runners that exist in our DB but weren't returned by GitHub)
    await handleMissingRunners(
      statelyClient,
      params,
      githubRunners,
      statelyRunners,
    );

    // Process each runner from GitHub
    for (const [_, githubRunner] of githubRunners) {
      // Map GitHub runner status to our enum
      const newStatus = mapGitHubStatus(githubRunner) as RunnerStatus;

      // Check if runner already exists. update it or
      // create a new one if it doesn't exist
      let updatedRunner = statelyRunners.get(BigInt(githubRunner.id));
      const oldStatus = updatedRunner?.status;
      if (updatedRunner) {
        // Update existing runner
        updatedRunner.name = githubRunner.name;
        updatedRunner.status = newStatus;
        updatedRunner.enabled = githubRunner.enabled;
        updatedRunner.os = githubRunner.os;
        updatedRunner.labels = githubRunner.labels.map((label) =>
          statelyClient.create("Label", { name: label.name }),
        );
        updatedRunner.lastSeenAt = BigInt(Date.now());
      } else {
        const now = BigInt(Date.now());
        updatedRunner = statelyClient.create("Runner", {
          runnerId: BigInt(githubRunner.id),
          repoId: repository.repoId,
          name: githubRunner.name,
          status: newStatus,
          enabled: githubRunner.enabled,
          os: githubRunner.os,
          labels: githubRunner.labels,
          lastSeenAt: now,
          firstSeenAt: now,
        });
        console.log(
          `Creating a new runner record for ${githubRunner.name} (${githubRunner.id})`,
        );
      }
      await statelyClient.put(updatedRunner);

      // if the status hasn't changed, then there is nothing to report.
      if (newStatus !== oldStatus) {
        return;
      }

      if (UNHEALTHY_STATUSES.includes(newStatus)) {
        await reportOutage(statelyClient, updatedRunner, params);
      } else {
        await reportRecovery(statelyClient, updatedRunner, params);
      }
    }
  } catch (repoError) {
    console.error(`Error processing repository ${repo}:`, repoError);
  }
}

async function handleMissingRunners(
  statelyClient: DatabaseClient,
  params: SSMParams,
  githubRunners: Map<number, GitHubRunner>,
  statelyRunners: Map<bigint, Runner>,
) {
  // Check for missing runners (runners that exist in our DB but weren't returned by GitHub)
  const missingRunners = [...statelyRunners.values()].filter(
    (runner) => !githubRunners.has(Number(runner.runnerId)),
  );

  await Promise.all(
    missingRunners.map((runner) =>
      handleMissingRunner(statelyClient, params, runner),
    ),
  );
}

async function handleMissingRunner(
  statelyClient: DatabaseClient,
  params: SSMParams,
  runner: Runner,
) {
  console.log(
    `Runner ${runner.name} (${runner.runnerId}) was not found in GitHub response`,
  );

  // Only update status to UNKNOWN if it's not already UNKNOWN
  if (runner.status !== RunnerStatus.RunnerStatus_UNKNOWN) {
    const oldStatus = runner.status;
    runner.status = RunnerStatus.RunnerStatus_UNKNOWN;

    // Don't update lastSeenAt since we didn't actually see the runner
    await statelyClient.put(runner);
    console.log(`Updated runner ${runner.name} status to UNKNOWN`);

    // Create an outage event if this is a new transition to UNKNOWN
    // from a previously healthy status. If it was already unhealthy, we don't
    // want to create a new outage event.
    if (!UNHEALTHY_STATUSES.includes(oldStatus) && params.slackWebhook) {
      await reportOutage(statelyClient, runner, params);
    }
  }
}

async function reportOutage(
  statelyClient: DatabaseClient,
  runner: Runner,
  params: SSMParams,
) {
  // Create a new outage event
  const outage = await createOutageEvent(statelyClient, runner);

  // Send notification to Slack
  if (params.slackWebhook) {
    await sendSlackOutageNotification(
      params.slackWebhook,
      runner,
      outage.outageId,
    );
    outage.notificationSent = true;
    await statelyClient.put(outage);
  }
}

async function reportRecovery(
  statelyClient: DatabaseClient,
  runner: Runner,
  params: SSMParams,
) {
  // Resolve the outage
  const lastOutage = await resolveOutageEvent(statelyClient, runner);

  // Send notification to Slack
  if (params.slackWebhook) {
    await sendSlackRecoveryNotification(
      params.slackWebhook,
      runner,
      lastOutage,
    );
  }
}
