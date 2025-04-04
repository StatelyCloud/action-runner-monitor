lint:
    npm run lint

lint-fix:
    npm run lint:fix

build:
    npm run build

# Note that this deploys to our Sandbox AWS Account!
deploy:
    cdk deploy --profile sandbox