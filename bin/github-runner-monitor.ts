#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as fs from "fs";
import { GitHubRunnerMonitorStack } from "../lib/github-runner-monitor-stack";

// Load region from .env.dev file or use us-west-2 as default
let region = "us-west-2";
try {
  const envContent = fs.readFileSync(".env.dev", "utf8");
  const regionMatch = envContent.match(/AWS_REGION=([a-z0-9-]+)/);
  if (regionMatch && regionMatch[1]) {
    region = regionMatch[1];
  }
} catch {
  console.log("Using default region us-west-2");
}

console.log(`Deploying to region: ${region}`);

const app = new cdk.App();
new GitHubRunnerMonitorStack(app, "GitHubRunnerMonitorStack", {
  /* If you need to add custom stack properties, do it here */
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  tags: {
    Project: "GitHubRunnerMonitor",
    Environment: app.node.tryGetContext("stage") || "dev",
  },
});
