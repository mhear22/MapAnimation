import {
  AWS_REGION,
  ECR_REPOSITORY,
  capture,
  resolveContainerEngine,
  run
} from "./docker-lib.js";

const containerEngine = resolveContainerEngine();
const gitHash = capture("git", ["rev-parse", "HEAD"]);
const [registry] = ECR_REPOSITORY.split("/");
if (!registry) {
  throw new Error(`Invalid ECR repository "${ECR_REPOSITORY}"`);
}
const imageRef = `${ECR_REPOSITORY}:${gitHash}`;

console.log(`Logging into ${registry} with ${containerEngine}`);
const password = capture("aws", ["ecr", "get-login-password", "--region", AWS_REGION]);
run(containerEngine, ["login", "--username", "AWS", "--password-stdin", registry], {
  input: `${password}\n`,
  stdio: ["pipe", "inherit", "inherit"]
});

console.log(`Building ${imageRef}`);
run(containerEngine, ["build", "--tag", imageRef, "--file", "Dockerfile", "."]);

console.log(`Pushing ${imageRef}`);
run(containerEngine, ["push", imageRef]);

console.log(`Published ${imageRef}`);
