/**
 * Every GraphQL document this app sends. Nothing outside src/railway builds one.
 *
 * Field selections match Railway's live schema as recorded in
 * docs/railway-schema-verification.md. Deprecated paths (Service.deployments,
 * Service.serviceInstances) are deliberately avoided.
 */

/** Projects reachable through a project-scoped OAuth token. */
export const PROJECTS = `
  query Projects {
    externalWorkspaces {
      id
      name
      projects {
        id
        name
      }
    }
  }
`

export const ENVIRONMENTS = `
  query Environments($projectId: String!) {
    environments(projectId: $projectId, first: 50) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`

/** Used to find an existing Sandbox before creating a second one. */
export const PROJECT_SERVICES = `
  query ProjectServices($projectId: String!) {
    project(id: $projectId) {
      services(first: 100) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }
`

export const SERVICE_CREATE = `
  mutation ServiceCreate($input: ServiceCreateInput!) {
    serviceCreate(input: $input) {
      id
      name
    }
  }
`

/** Carries the service's current deployment, so it doubles as the "what is running" read. */
export const SERVICE_INSTANCE = `
  query ServiceInstance($serviceId: String!, $environmentId: String!) {
    serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
      id
      serviceId
      environmentId
      latestDeployment {
        id
        status
        createdAt
        statusUpdatedAt
        url
        staticUrl
        deploymentStopped
      }
    }
  }
`

export const DEPLOYMENT = `
  query Deployment($id: String!) {
    deployment(id: $id) {
      id
      status
      createdAt
      statusUpdatedAt
      url
      staticUrl
      deploymentStopped
    }
  }
`

export const DEPLOYMENTS = `
  query Deployments($input: DeploymentListInput!, $first: Int!) {
    deployments(input: $input, first: $first) {
      edges {
        node {
          id
          status
          createdAt
          statusUpdatedAt
          url
          staticUrl
          deploymentStopped
        }
      }
    }
  }
`

/** Returns the deployment ID as a bare String, so there is no selection set. */
export const SERVICE_INSTANCE_DEPLOY = `
  mutation Deploy($serviceId: String!, $environmentId: String!) {
    serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
  }
`

export const DEPLOYMENT_RESTART = `
  mutation Restart($id: String!) {
    deploymentRestart(id: $id)
  }
`

export const DEPLOYMENT_STOP = `
  mutation Stop($id: String!) {
    deploymentStop(id: $id)
  }
`

export const DEPLOYMENT_CANCEL = `
  mutation Cancel($id: String!) {
    deploymentCancel(id: $id)
  }
`

export const DEPLOYMENT_APPROVE = `
  mutation Approve($id: String!) {
    deploymentApprove(id: $id)
  }
`

export const BUILD_LOGS = `
  query BuildLogs($deploymentId: String!, $limit: Int!) {
    buildLogs(deploymentId: $deploymentId, limit: $limit) {
      timestamp
      message
      severity
    }
  }
`

export const RUNTIME_LOGS = `
  query RuntimeLogs($deploymentId: String!, $limit: Int!) {
    deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
      timestamp
      message
      severity
    }
  }
`
