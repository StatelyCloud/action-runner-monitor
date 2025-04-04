# Stately Schema
This directory contains a boilerplate schema to help you start your StatelyDB journey!

## Prerequisites
- You've already setup a Stately account at [https://console.stately.cloud](https://console.stately.cloud)
- You have installed the `stately` CLI from [here](https://stately.cloud/downloads) and it's available on your `PATH`
- You have installed [nodejs and npm](https://nodejs.org/en/download/package-manager), or any other package manager of your choice
- You've run `npm install` in this directory to install the required dependencies

## Getting started
- Once you've completed the prerequisites above you can start editing your schema in the [schema.ts](./schema.ts) file
- Validate your schema with `stately schema validate schema.ts`
- Print your schema with `stately schema print schema.ts`
- Generate a preview client library in your desired language with `stately schema generate --language <ts|ruby|go> --preview schema.ts <output-dir>`
  > _A preview client can only be used to test your schema locally, it will not be able to communicate with StatelyDB._

## Applying your schema
- Login to Stately with `stately login`
- Publish a new version to your schema with `stately schema put --schema-id=<your-schema-id> --message "A schema update" schema.ts`
  - You can get the SchemaID bound to your store from the [Stately Web Console](https://console.stately.cloud)
- Generate a release client based on the published version with `stately schema generate --language <ts|ruby|go> --schema-id=<your-schema-id> --version <version> <output-dir>`

## Other useful commands
- `stately schema print --schema-id=<your-schema-id>` will print the current schema for the provided SchemaID
- `stately schema print --schema-id=<your-schema-id> -v=<version>` will print a specific version of schema for the provided SchemaID

## Need help?
- Email us at [support@stately.cloud](mailto:support@stately.cloud)
- Contact us over Slack