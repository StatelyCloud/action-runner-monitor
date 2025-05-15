import axios from "axios";
import { SSMParams } from "./config";
import { RunnerStatus } from "./schema/index";

/**
 * Represents a GitHub Actions runner with its properties
 * Contains information about a runner's status, attributes, and configuration
 */
export interface GitHubRunner {
  id: number;
  name: string;
  status: string;
  busy: boolean;
  os: string;
  labels: { name: string }[];
  enabled: boolean;
}

/**
 * Fetches all GitHub runners from both repositories and organizations
 * @param repo - The repository in the format "owner/repo"
 * @param params - The SSM parameters containing GitHub token and organizations list
 * @returns A promise that resolves to a Map of runner IDs to GitHubRunner objects
 */
export async function fetchAllGithubRunners(
  repo: string,
  params: SSMParams,
): Promise<Map<number, GitHubRunner>> {
  const runners = new Map<number, GitHubRunner>();
  const repoRunners = await fetchGitHubRunnersForRepository(
    repo,
    params.githubToken,
  );
  console.log(`Found ${repoRunners.length} runners for repository ${repo}`);
  for (const runner of repoRunners) {
    runners.set(runner.id, runner);
  }

  // Fetch runners from GitHub API for Organizations
  for (const org of params.organizations) {
    const orgRunners = await fetchGitHubRunnersForOrganization(
      org,
      params.githubToken,
    );
    console.log(`Found ${orgRunners.length} runners for organization ${org}`);
    for (const runner of orgRunners) {
      runners.set(runner.id, runner);
    }
  }
  console.log(`Total runners after merging: ${runners.size}`);
  return runners;
}

/**
 * Fetch runners for a Github Repository
 * @param repo - The repository in the format "owner/repo"
 * @param githubToken - The GitHub token for authentication
 * @returns A promise that resolves to an array of GitHub runners
 */
async function fetchGitHubRunnersForRepository(
  repo: string,
  githubToken: string,
): Promise<GitHubRunner[]> {
  try {
    return await fetchGitHubRunnersFromEndpoint(
      `https://api.github.com/repos/${repo}/actions/runners`,
      githubToken,
    );
  } catch (error) {
    console.error(`Error fetching runners for repository ${repo}:`, error);
    throw error;
  }
}

/**
 * Fetch runners for a GitHub Organization
 * @param org - The organization name
 * @param githubToken - The GitHub token for authentication
 * @returns A promise that resolves to an array of GitHub runners
 */
async function fetchGitHubRunnersForOrganization(
  org: string,
  githubToken: string,
): Promise<GitHubRunner[]> {
  try {
    return await fetchGitHubRunnersFromEndpoint(
      `https://api.github.com/orgs/${org}/actions/runners`,
      githubToken,
    );
  } catch (error) {
    console.error(`Error fetching runners for organization ${org}:`, error);
    throw error;
  }
}

/**
 * Fetch runners for a given GitHub API endpoint
 * @param endpoint - The GitHub API endpoint
 * @param githubToken - The GitHub token for authentication
 * @returns A promise that resolves to an array of GitHub runners
 */
async function fetchGitHubRunnersFromEndpoint(
  endpoint: string,
  githubToken: string,
): Promise<GitHubRunner[]> {
  try {
    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    return response.data.runners;
  } catch (error) {
    console.error(`Error fetching runners from ${endpoint}:`, error);
    throw error;
  }
}

/**
 * Maps a GitHub runner's status to our internal RunnerStatus enum
 * @param githubRunner - The GitHub runner object to map the status from
 * @returns The corresponding RunnerStatus enum value
 */
export function mapGitHubStatus(githubRunner: GitHubRunner): number {
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
