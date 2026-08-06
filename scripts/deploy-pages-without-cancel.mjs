import fs from "node:fs";

const FINAL_FAILURES = new Set([
  "deployment_failed",
  "deployment_perms_error",
  "deployment_content_failed",
  "deployment_cancelled",
  "deployment_lost",
]);

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const repository = required("GITHUB_REPOSITORY");
const runId = required("GITHUB_RUN_ID");
const buildVersion = required("GITHUB_SHA");
const githubToken = required("GITHUB_TOKEN");
const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
const eventName = process.env.GITHUB_EVENT_NAME || "";

async function github(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { response, payload };
}

async function idToken() {
  const requestUrl = required("ACTIONS_ID_TOKEN_REQUEST_URL");
  const requestToken = required("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  const response = await fetch(requestUrl, {
    headers: { Authorization: `Bearer ${requestToken}` },
  });
  if (!response.ok) {
    throw new Error(`OIDC token request failed (${response.status})`);
  }
  const payload = await response.json();
  if (!payload.value) {
    throw new Error("OIDC token response did not include a token");
  }
  return payload.value;
}

async function artifactId() {
  const { response, payload } = await github(
    `/repos/${repository}/actions/runs/${runId}/artifacts?name=github-pages&per_page=100`,
  );
  if (!response.ok) {
    throw new Error(`Artifact lookup failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  const artifacts = (payload.artifacts || []).filter((artifact) => artifact.name === "github-pages" && !artifact.expired);
  if (artifacts.length !== 1) {
    throw new Error(`Expected one github-pages artifact, found ${artifacts.length}`);
  }
  return artifacts[0].id;
}

async function deploymentStatus(version) {
  const { response, payload } = await github(`/repos/${repository}/pages/deployments/${version}`);
  if (!response.ok) {
    return null;
  }
  return payload;
}

async function cancelDeployment(version) {
  const { response, payload } = await github(`/repos/${repository}/pages/deployments/${version}/cancel`, {
    method: "POST",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not cancel blocking Pages deployment (${response.status}): ${JSON.stringify(payload)}`);
  }
}

async function createDeployment(artifact, oidcToken) {
  return github(`/repos/${repository}/pages/deployments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      artifact_id: artifact,
      pages_build_version: buildVersion,
      oidc_token: oidcToken,
    }),
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureDeployment(artifact, oidcToken) {
  for (let attempt = 1; attempt <= 13; attempt += 1) {
    const result = await createDeployment(artifact, oidcToken);
    if (result.response.ok) {
      return result.payload;
    }

    const message = String(result.payload?.message || result.payload || "");
    const blocker = message.match(/cancel ([0-9a-f]{40}) first/i)?.[1];
    if (result.response.status !== 400 || !blocker) {
      throw new Error(`Creating Pages deployment failed (${result.response.status}): ${message}`);
    }

    if (blocker === buildVersion) {
      console.log(`Pages deployment ${buildVersion.slice(0, 7)} already exists; monitoring it.`);
      return { id: buildVersion };
    }

    const blockerStatus = await deploymentStatus(blocker);
    console.log(
      `Pages deployment ${blocker.slice(0, 7)} blocks ${buildVersion.slice(0, 7)} (${blockerStatus?.status || "unknown"}).`,
    );
    if (eventName !== "schedule" || blockerStatus?.status === "deployment_cancelled") {
      await cancelDeployment(blocker);
    }
    await sleep(10_000);
  }
  throw new Error("Pages still reports a blocking deployment after two minutes");
}

async function monitorDeployment(deployment) {
  const deploymentId = deployment.id || buildVersion;
  for (let attempt = 1; attempt <= 360; attempt += 1) {
    await sleep(5_000);
    const status = await deploymentStatus(deploymentId);
    if (!status) {
      console.log("Pages deployment status is temporarily unavailable.");
      continue;
    }
    console.log(`Pages deployment status: ${status.status}`);
    if (status.status === "succeed") {
      return;
    }
    if (FINAL_FAILURES.has(status.status)) {
      throw new Error(`Pages deployment ended with ${status.status}`);
    }
  }
  console.log("::warning::Pages is still queued after 30 minutes; leaving the deployment active instead of cancelling it.");
}

const artifact = await artifactId();
const oidcToken = await idToken();
const deployment = await ensureDeployment(artifact, oidcToken);
const pageUrl = deployment.page_url || "https://mengtahsu.github.io/taiwan-fund-radar/";
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `page_url=${pageUrl}\n`, "utf8");
}
console.log(`Created or found Pages deployment ${String(deployment.id || buildVersion).slice(0, 12)}.`);
await monitorDeployment(deployment);
