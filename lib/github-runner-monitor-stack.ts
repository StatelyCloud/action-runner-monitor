// lib/github-runner-monitor-stack.ts
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { aws_iam as iam } from "aws-cdk-lib";
import { aws_events as events } from "aws-cdk-lib";
import { aws_events_targets as targets } from "aws-cdk-lib";
import { aws_apigateway as apigateway } from "aws-cdk-lib";
import * as path from "path";

export class GitHubRunnerMonitorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda execution role
    const lambdaRole = new iam.Role(this, "GitHubRunnerMonitorRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });

    // Add permissions to access SSM parameters
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/github-runner-monitor/*`,
        ],
      }),
    );

    // Create Lambda function
    const monitorFunction = new lambda.Function(
      this,
      "GitHubRunnerMonitorFunction",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "probe.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
        timeout: cdk.Duration.minutes(5),
        memorySize: 512,
        role: lambdaRole,
        environment: {
          NODE_OPTIONS: "--enable-source-maps",
        },
        description:
          "Lambda function to monitor GitHub self-hosted runners and alert when unhealthy",
      },
    );

    // Create EventBridge rule to trigger Lambda every 5 minutes
    const rule = new events.Rule(this, "ScheduleRule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: "Trigger GitHub runner monitoring every 5 minutes",
    });

    // Add Lambda as target for the rule
    rule.addTarget(
      new targets.LambdaFunction(monitorFunction, {
        retryAttempts: 2,
      }),
    );

    // Output the Lambda function ARN
    new cdk.CfnOutput(this, "MonitorFunctionArn", {
      value: monitorFunction.functionArn,
      description: "The ARN of the GitHub runner monitor Lambda function",
      exportName: "GitHubRunnerMonitorFunctionArn",
    });

    // Create Lambda function for Slack interactions
    const slackFunction = new lambda.Function(
      this,
      "SlackInteractionFunction",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "slack.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        role: lambdaRole,
        environment: {
          NODE_OPTIONS: "--enable-source-maps",
        },
        description: "Lambda function to handle Slack interactions",
      },
    );

    // Create API Gateway
    const api = new apigateway.RestApi(this, "SlackApi", {
      restApiName: "Slack Interaction API",
      description: "API Gateway for Slack interactions",
      cloudWatchRole: true, // Enable CloudWatch logging
      deployOptions: {
        stageName: "default",
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });

    // Create API resource and method
    const slackResource = api.root.addResource("slack");
    slackResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(slackFunction),
      {
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
        ],
      },
    );

    // Output the API endpoint URL
    new cdk.CfnOutput(this, "SlackEndpoint", {
      value: `${api.url}slack`,
      description: "The URL for Slack interactions",
      exportName: "SlackInteractionEndpoint",
    });
  }
}
