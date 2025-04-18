# GitHub Runner Monitoring

A serverless solution to monitor the status of self-hosted GitHub runners and notify via Slack when unhealthy states are detected.

## Overview

This system periodically checks the status of GitHub self-hosted runners across multiple repositories and alerts via Slack when runners become unhealthy. It uses AWS Lambda for computation and StatelyDB for persistence.

### Features

- Monitor self-hosted GitHub runners across multiple repositories
- Track runner status history and metadata
- Alert via Slack when runners become unhealthy (offline, etc.)
- Automatically mark runners as "unknown" if not seen in recent checks
- Persist runner data and outage history
- Fully configurable via AWS SSM parameters

## Architecture

The solution consists of:

1. **AWS Lambda function** running on a 5-minute schedule via EventBridge
2. **StatelyDB** for persistent storage of runner data
3. **AWS SSM Parameter Store** for configuration and secrets
4. **GitHub API** integration to fetch runner status
5. **Slack API** integration for notifications

## StatelyDB Schema

The [StatelyDB schema](schema/schema.ts) is designed to efficiently store and retrieve runner data:

### Item Types

1. **Repository**
   - Contains metadata about a GitHub repository
   - Primary entity for grouping runners

2. **Runner**
   - Contains metadata about a GitHub runner
   - Tracks current status and last seen timestamps
   - Partitioned by repository

3. **OutageEvent**
   - Tracks history of runner outages
   - Records when a runner entered an unhealthy state
   - Partitioned by repository and runner

### Key Path Structure

- Repositories: `/repo-:repoId`
- Runners: `/repo-:repoId/runner-:runnerId`
- Outage Events: `/repo-:repoId/runner-:runnerId/outage-:outageId`

This structure allows efficient querying and updates while maintaining repository-level partitioning.

## Setup and Deployment

### Prerequisites

- AWS Account with appropriate permissions
- StatelyDB account and store
- GitHub Personal Access Token with appropriate permissions
- Slack webhook URL or API token

### Configuration

All configuration is stored in AWS SSM Parameter Store:

| Parameter | Description | Type |
|-----------|-------------|------|
| `/github-runner-monitor/github-token` | GitHub API token | SecureString |
| `/github-runner-monitor/statelydb-access-key` | StatelyDB access key | SecureString |
| `/github-runner-monitor/statelydb-store-id` | StatelyDB store ID | String |
| `/github-runner-monitor/statelydb-schema-id` | StatelyDB schema ID | String |
| `/github-runner-monitor/statelydb-region` | StatelyDB region | String |
| `/github-runner-monitor/slack-webhook` | Slack webhook URL | SecureString |
| `/github-runner-monitor/repositories` | List of repos to monitor (JSON array) | String |
| `/github-runner-monitor/slack-signing-secret` | Slack signing secret | String |

### Deployment

The solution can be deployed using AWS CDK:

```bash
# Install dependencies
npm install

# Build the solution
npm run build

# Deploy to AWS
npx cdk deploy
```

Alternatively, you can use the provided CloudFormation template or manual setup through the AWS Console.

### Manual Setup

1. Create the Lambda function using the code in this repository
2. Set up IAM permissions for the Lambda function (SSM access, etc.)
3. Create an EventBridge rule to trigger the Lambda every 5 minutes
4. Configure the SSM parameters listed above
5. Create and publish your StatelyDB schema

## Development

### Prerequisites for Development

- Node.js 16+ and npm
- AWS CDK installed globally (`npm install -g aws-cdk`)
- StatelyDB CLI installed (`curl -sL https://stately.cloud/install | sh`)
- AWS CLI configured with appropriate credentials
- AWS SAM CLI for local Lambda testing

### Project Structure

```
github-runner-monitor/
├── bin/                      # CDK app entry point
├── lib/                      # CDK stack definition
├── schema/                   # StatelyDB schema definition
├── src/                      # Lambda function source code
├── dist/                     # Compiled Lambda function
├── cdk.json                  # CDK configuration
├── tsconfig.json             # TypeScript configuration
├── package.json              # Project dependencies
└── events/                   # Lambda test event files
```

### Setting Up Local CDK Environment

1. Clone this repository
   ```bash
   git clone https://github.com/your-org/github-runner-monitor.git
   cd github-runner-monitor
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Bootstrap your AWS environment (if not already done)
   ```bash
   cdk bootstrap aws://ACCOUNT-NUMBER/REGION
   ```

4. Create a development environment file
   ```bash
   cat > .env.dev << EOL
   STATELYDB_SCHEMA_ID=your-schema-id
   STATELYDB_STORE_ID=your-store-id
   AWS_REGION=us-west-2
   EOL
   ```

5. Initialize and publish StatelyDB schema
   ```bash
   # Initialize schema directory
   stately schema init ./schema
   
   # Copy schema definition to schema.ts
   cp src/schema.ts schema/
   
   # Login to StatelyDB if needed
   stately login
   
   # Publish schema to StatelyDB
   stately schema put --schema-id $(grep STATELYDB_SCHEMA_ID .env.dev | cut -d= -f2) \
     --message "Initial schema" ./schema/schema.ts
   
   # Generate TypeScript client code
   stately schema generate --language ts \
     --schema-id $(grep STATELYDB_SCHEMA_ID .env.dev | cut -d= -f2) \
     --version 1 ./src/schema
   ```

6. Configure SSM parameters for local testing
   ```bash
   # Create SSM parameters (do this only once)
   aws ssm put-parameter --name "/github-runner-monitor/github-token" \
     --type SecureString --value "your-github-token"
   
   aws ssm put-parameter --name "/github-runner-monitor/statelydb-access-key" \
     --type SecureString --value "your-statelydb-access-key"
   
   aws ssm put-parameter --name "/github-runner-monitor/statelydb-store-id" \
     --type String --value "your-statelydb-store-id"

   aws ssm put-parameter --name "/github-runner-monitor/statelydb-region" \
     --type String --value "your-statelydb-region"

   aws ssm put-parameter --name "/github-runner-monitor/repositories" \
     --type String --value '["owner/repo1", "owner/repo2"]'

   aws ssm put-parameter --name "/github-runner-monitor/organizations" \
     --type String --value '["owner"]'

   aws ssm put-parameter --name "/github-runner-monitor/slack-webhook" \
     --type SecureString --value "https://hooks.slack.com/services/your/webhook/url"

   aws ssm put-parameter --name "/github-runner-monitor/slack-signing-secret" \
     --type SecureString --value "your-secret"

   ```

7. Set up build scripts in package.json
   ```json
   "scripts": {
     "build": "tsc",
     "watch": "tsc -w",
     "cdk": "cdk",
     "test": "jest"
   }
   ```

8. Build the Lambda function
   ```bash
   npm run build
   ```

### Local Lambda Testing

You can test the Lambda function locally using AWS SAM CLI, which allows you to invoke the function with simulated events before deploying to AWS.

1. Create a test event file
   ```bash
   mkdir -p events
   
   cat > events/scheduled-event.json << EOL
   {
     "version": "0",
     "id": "53dc4d37-cffa-4f76-80c9-8b7d4a4d2eaa",
     "detail-type": "Scheduled Event",
     "source": "aws.events",
     "account": "123456789012",
     "time": "2023-04-01T00:00:00Z",
     "region": "us-west-2",
     "resources": [
       "arn:aws:events:us-west-2:123456789012:rule/my-schedule"
     ],
     "detail": {}
   }
   EOL
   ```

2. Create a SAM-specific environment variable override file
  ```bash
  cat > .env.json << EOL
  {
    "Parameters": {
      "STATELYDB_SCHEMA_ID": 1234,
      "STATELYDB_STORE_ID": 1234,
      "STATELYDB_ACCESS_KEY": "secret-here",
      "STATELYDB_REGION": "us-east-1",
      "REPOS": "[\"StatelyCloud/stately\"]",
      "ORGANIZATIONS": "[\"StatelyCloud\"]",
      "GITHUB_TOKEN": "secret-here",
      "AWS_REGION": "us-west-2",
      "SLACK_WEBHOOK": "secret-here"
    }
  }
  EOL
  ```

3. Create SAM template for local testing
   ```bash
   cat > template.yaml << EOL
   AWSTemplateFormatVersion: '2010-09-09'
   Transform: AWS::Serverless-2016-10-31
   Resources:
     GitHubRunnerMonitorFunction:
       Type: AWS::Serverless::Function
       Properties:
         CodeUri: ./dist/
         Handler: probe.handler
         Runtime: nodejs18.x
         Timeout: 300
         MemorySize: 512
         Policies:
           - SSMParameterReadPolicy:
               ParameterName: /github-runner-monitor/*
   EOL
   ```

4. Invoke the Lambda function locally
   ```bash
   # Ensure AWS_PROFILE is set if you're using named profiles
   export AWS_PROFILE=your-profile-name
   
   # Invoke the function
   sam local invoke GitHubRunnerMonitorFunction \
     -e events/scheduled-event.json \
     --region $(grep AWS_REGION .env.dev | cut -d= -f2)
   ```

5. Debug the Lambda function with VS Code
   - Create a `.vscode/launch.json` file:
   ```json
   {
     "version": "0.2.0",
     "configurations": [
       {
         "name": "Debug Lambda Function",
         "type": "node",
         "request": "launch",
         "program": "${workspaceFolder}/node_modules/aws-cdk/bin/cdk.js",
         "args": ["synth"],
         "cwd": "${workspaceFolder}",
         "console": "integratedTerminal",
         "sourceMaps": true,
         "skipFiles": ["<node_internals>/**"]
       },
       {
         "name": "Attach to SAM CLI",
         "type": "node",
         "request": "attach",
         "address": "localhost",
         "port": 5858,
         "localRoot": "${workspaceFolder}/dist",
         "remoteRoot": "/var/task",
         "protocol": "inspector",
         "sourceMapPathOverrides": {
           "/var/task/*": "${workspaceFolder}/dist/*"
         }
       }
     ]
   }
   ```
   
   - Run SAM with debugging enabled:
   ```bash
   sam local invoke GitHubRunnerMonitorFunction \
     -e events/scheduled-event.json \
     --debug-port 5858 \
     --region $(grep AWS_REGION .env.dev | cut -d= -f2)
   ```
   
   - In VS Code, select "Attach to SAM CLI" from the debug configurations and press F5

Example commands for local testing:

```bash
AWS_PROFILE=sandbox sam local invoke GitHubRunnerMonitorFunction \
          --event events/scheduled-event.json \
          --region $(grep AWS_REGION .env.dev | cut -d= -f2)

AWS_PROFILE=sandbox sam local invoke SlackInteractionFunction \
          --event ./events/slack-runner-status-all.json \
          --region $(grep AWS_REGION .env.dev | cut -d= -f2) 
```

### Deploying with CDK

1. Synthesize CloudFormation template
   ```bash
   cdk synth
   ```

2. Deploy to development environment
   ```bash
   cdk deploy
   ```

3. Deploy to specific environment with parameters
   ```bash
   cdk deploy --context stage=prod
   ```

## Operations

### Monitoring and Troubleshooting

- **CloudWatch Logs**: Check Lambda function logs for details on each execution
- **StatelyDB Console**: Inspect runner and outage data in the StatelyDB console
- **Slack Notifications**: Receive real-time alerts when runners become unhealthy

### Adding New Repositories

To add a new repository to monitor:

1. Update the SSM parameter `/github-runner-monitor/repositories` to include the new repository
2. Ensure the GitHub token has appropriate permissions for the new repository
