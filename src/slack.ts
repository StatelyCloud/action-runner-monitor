import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  createClient,
  DatabaseClient,
  OutageEvent,
  Runner,
  RunnerStatus,
} from "./schema/index";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { accessKeyAuth, keyPath, SortDirection } from "@stately-cloud/client";
import * as crypto from "crypto";
import * as querystring from "querystring";

const SSM_SLACK_SIGNING_SECRET = "/github-runner-monitor/slack-signing-secret";
const SSM_STATELYDB_ACCESS_KEY = "/github-runner-monitor/statelydb-access-key";
const SSM_STATELYDB_STORE_ID = "/github-runner-monitor/statelydb-store-id";
const SSM_STATELYDB_REGION = "/github-runner-monitor/statelydb-region";

const ssm = new SSMClient();

interface SlackBlock {
  type: string;
  text: {
    type: string;
    text: string;
  };
}

async function verifySlackRequest(
  event: APIGatewayProxyEvent,
  signingSecret: string,
): Promise<boolean> {
  // We dont need to verify the signature if we are running locally
  if (process.env.AWS_SAM_LOCAL) {
    return true;
  }

  const timestamp = event.headers["X-Slack-Request-Timestamp"];
  const signature = event.headers["X-Slack-Signature"];
  const body = event.body || "";

  // Validate headers
  if (!timestamp || !signature) {
    console.error("Missing required Slack headers");
    return false;
  }

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) {
    console.error("Timestamp is too old");
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const computedSignature = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(sigBasestring)
    .digest("hex")}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(computedSignature, "utf8"),
    );
  } catch (error) {
    console.error("Error during signature comparison:", error);
    return false;
  }
}

async function getStatelyClient(): Promise<DatabaseClient> {
  const [statelydbAccessKey, statelydbStoreId, statelydbRegion] =
    await Promise.all([
      ssm.send(
        new GetParameterCommand({
          Name: SSM_STATELYDB_ACCESS_KEY,
          WithDecryption: true,
        }),
      ),
      ssm.send(new GetParameterCommand({ Name: SSM_STATELYDB_STORE_ID })),
      ssm.send(new GetParameterCommand({ Name: SSM_STATELYDB_REGION })),
    ]);

  console.log("Fetched parameters:", {
    statelydbStoreId: statelydbStoreId.Parameter?.Value,
    statelydbRegion: statelydbRegion.Parameter?.Value,
  });

  return createClient(BigInt(statelydbStoreId.Parameter?.Value || ""), {
    authTokenProvider: accessKeyAuth({
      accessKey: statelydbAccessKey.Parameter?.Value || "",
    }),
    region: statelydbRegion.Parameter?.Value || "",
  });
}

function getRunnerStatusText(status: RunnerStatus): string {
  switch (status) {
    case RunnerStatus.RunnerStatus_ONLINE:
      return "Online";
    case RunnerStatus.RunnerStatus_BUSY:
      return "Busy";
    case RunnerStatus.RunnerStatus_IDLE:
      return "Idle";
    case RunnerStatus.RunnerStatus_OFFLINE:
      return "Offline";
    default:
      return "Unknown";
  }
}

async function getRecentOutagesForRunner(
  statelyClient: DatabaseClient,
  repoId: string,
  runnerName: string,
): Promise<SlackBlock[]> {
  // First look up the Runner ID. If we can't find it, return a friend not found message.
  const runner = await statelyClient.get(
    "Runner",
    keyPath`/repo-${repoId}/runner-${runnerName}`,
  );
  if (!runner) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Sorry, I couldn't find a runner with the name "${runnerName}"`,
        },
      },
    ];
  }

  const latestOutages: OutageEvent[] = [];
  const iter = statelyClient.beginList(
    keyPath`/repo-${repoId}/history-${runner.runnerId}/outage-`,
    { limit: 5, sortDirection: SortDirection.SORT_DESCENDING },
  );
  for await (const item of iter) {
    if (statelyClient.isType(item, "OutageEvent")) {
      latestOutages.push(item);
    }
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${runner.name} Recent Outages`,
      },
    },
    ...Object.values(latestOutages).map((outage) => {
      const startTime = Number(outage.startedAt);
      const endTime = Number(outage.resolvedAt || Date.now());
      const durationMinutes = Math.round((endTime - startTime) / (1000 * 60));

      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Status:* ${getRunnerStatusText(outage.status)}
*Started:* <!date^${Math.floor(
            startTime / 1000,
          )}^{date_short} {time}|${new Date(startTime).toISOString()}>
*Resolved:* ${
            outage.resolvedAt
              ? `<!date^${Math.floor(
                  endTime / 1000,
                )}^{date_short} {time}|${new Date(endTime).toISOString()}>`
              : "Ongoing"
          }
*Duration:* ${durationMinutes} minutes`,
        },
      };
    }),
  ];

  return blocks;
}

async function getStatusForRunners(
  statelyClient: DatabaseClient,
  repoId: string,
): Promise<SlackBlock[]> {
  const runners: Runner[] = [];
  const iter = statelyClient.beginList(keyPath`/repo-${repoId}/runner-`);
  for await (const item of iter) {
    if (statelyClient.isType(item, "Runner")) {
      runners.push(item);
    }
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${repoId} Runner Status`,
      },
    },
    ...Object.values(runners).map((runner) => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Runner:* ${runner.name}
*Status:* ${getRunnerStatusText(runner.status)}
*Last Seen:* <!date^${Math.floor(
          Number(runner.lastSeenAt) / 1000,
        )}^{date_short} {time}|${new Date(
          Number(runner.lastSeenAt),
        ).toISOString()}>
*First Seen:* <!date^${Math.floor(
          Number(runner.firstSeenAt) / 1000,
        )}^{date_short} {time}|${new Date(
          Number(runner.firstSeenAt),
        ).toISOString()}>`,
      },
    })),
  ];
  return blocks;
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    // Fetch Slack signing secret from SSM
    const signingSecret = await ssm.send(
      new GetParameterCommand({
        Name: SSM_SLACK_SIGNING_SECRET,
        WithDecryption: true,
      }),
    );

    // Verify request signature
    if (
      !(await verifySlackRequest(event, signingSecret.Parameter?.Value || ""))
    ) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Invalid signature" }),
      };
    }

    // Initialize StatelyDB client
    const statelyClient = await getStatelyClient();

    // For now, we only care about one repo
    // TODO: Make this dynamic
    const repoId = "stately";

    // Parse the event body as URL-encoded data
    const body = querystring.parse(event.body || "");
    const { command, text } = body;

    // Respond to slash commands
    let blocks: SlackBlock[] = [];
    switch (command) {
      case "/runner-history":
        if (!text) {
          blocks = [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "Please provide a runner name.",
              },
            },
          ];
        } else {
          blocks = await getRecentOutagesForRunner(
            statelyClient,
            repoId,
            text as string,
          );
        }
        break;
      case "/runner-status-all":
        blocks = await getStatusForRunners(statelyClient, repoId);
        break;
      default:
        blocks = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Sorry, I don't recognize the ${command} command`,
            },
          },
        ];
        break;
    }
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        response_type: "in_channel",
        blocks: blocks,
      }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
