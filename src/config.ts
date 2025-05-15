import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { StoreID } from "@stately-cloud/client";

// SSM parameter paths
const SSM_GITHUB_TOKEN = "/github-runner-monitor/github-token";
const SSM_STATELYDB_ACCESS_KEY = "/github-runner-monitor/statelydb-access-key";
const SSM_STATELYDB_STORE_ID = "/github-runner-monitor/statelydb-store-id";
const SSM_STATELYDB_REGION = "/github-runner-monitor/statelydb-region";
const SSM_REPOSITORIES = "/github-runner-monitor/repositories";
const SSM_SLACK_WEBHOOK = "/github-runner-monitor/slack-webhook";
const SSM_ORGANIZATIONS = "/github-runner-monitor/organizations";

/**
 * Configuration parameters retrieved from SSM Parameter Store
 * Contains all necessary credentials and settings for the application
 */
export type SSMParams = {
  githubToken: string;
  statelydbAccessKey: string;
  statelydbStoreId: StoreID;
  statelydbRegion: string;
  repositories: string[];
  slackWebhook?: string;
  organizations: string[];
};

/**
 * Fetch all SSM parameters needed for the function
 */
export async function fetchSSMParameters(): Promise<SSMParams> {
  if (process.env.AWS_SAM_LOCAL) {
    console.log("Running in local mode, using environment variables");
    const params: SSMParams = {
      githubToken: process.env.GITHUB_TOKEN!,
      statelydbAccessKey: process.env.STATELYDB_ACCESS_KEY!,
      statelydbStoreId: BigInt(process.env.STATELYDB_STORE_ID!),
      statelydbRegion: process.env.STATELYDB_REGION!,
      repositories: JSON.parse(process.env.GITHUB_REPOS!),
      slackWebhook: process.env.SLACK_WEBHOOK,
      organizations: JSON.parse(process.env.GITHUB_ORGANIZATIONS!),
    };
    // Display debugging info
    console.log("Fetched parameters:", {
      statelydbStoreId: params.statelydbStoreId,
      statelydbRegion: params.statelydbRegion,
      repositories: params.repositories,
      organizations: params.organizations,
    });
    return params;
  }

  // Initialize the SSM client
  const ssm = new SSMClient();

  const parameterResponse = await ssm.send(
    new GetParametersCommand({
      Names: [
        SSM_GITHUB_TOKEN,
        SSM_STATELYDB_ACCESS_KEY,
        SSM_STATELYDB_STORE_ID,
        SSM_STATELYDB_REGION,
        SSM_REPOSITORIES,
        SSM_SLACK_WEBHOOK,
        SSM_ORGANIZATIONS,
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
    statelydbStoreId: BigInt(getParameter(SSM_STATELYDB_STORE_ID)),
    statelydbRegion: getParameter(SSM_STATELYDB_REGION),
    repositories: JSON.parse(getParameter(SSM_REPOSITORIES)),
    slackWebhook: getParameter(SSM_SLACK_WEBHOOK),
    organizations: JSON.parse(getParameter(SSM_ORGANIZATIONS)),
  };
}
