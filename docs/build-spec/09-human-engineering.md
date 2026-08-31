# 09 — Human Engineering & Implementation Style

This document is an additional constraint on the implementation.

The technical specification in the other build-spec files remains the source of truth for product scope and architecture.

This file defines how the project should be implemented and written.

## 1. The goal

Do not optimize this project for looking impressive.

Optimize it for being:

* correct;
* understandable;
* deliberate;
* simple;
* well tested;
* easy for the developer to explain;
* pleasant for another engineer to review.

The final repository should look like it was built by one capable engineer who cared about the details.

It should NOT look like a generated showcase project.

## 2. Human-written code

Use simple names and simple language.

Prefer:

```ts
getDeployment()
createSandbox()
canDeploy()
pollDeployment()
```

over unnecessarily abstract names.

Avoid creating abstractions only to make the architecture look sophisticated.

Do not introduce:

* factories;
* registries;
* generic managers;
* generic repositories;
* abstract providers;
* unnecessary dependency injection;
* event buses;
* service locators;

unless there is a real problem that the abstraction solves.

If a normal function is enough, use a normal function.

## 3. Comments

Comments should be rare.

Do NOT comment obvious code.

Bad:

```ts
// Get the deployment
const deployment = await getDeployment(id);
```

Bad:

```ts
// Check whether the deployment is currently running
if (deployment.status === "SUCCESS") {
```

Good:

```ts
// Railway is the source of truth for deployment state.
// We don't keep a second copy in our database.
const deployment = await getDeployment(id);
```

Good:

```ts
// Don't start another deployment while Railway is already
// processing one. The UI can prevent double clicks, but the
// server still needs to protect the operation.
if (!canDeploy(deployment)) {
  throw new ConflictError("A deployment is already in progress");
}
```

Comments should explain WHY a decision exists, not WHAT the next line does.

## 4. Vocabulary

Use normal engineering language.

Avoid phrases such as:

* enterprise-grade;
* cutting-edge;
* highly scalable;
* robust distributed architecture;
* seamless experience;
* powerful abstraction;
* production-grade;
* revolutionary;
* sophisticated orchestration;
* state-of-the-art.

Do not use these phrases in code comments, README text, commit messages, or UI copy unless there is a very specific reason.

## 5. README style

The README should sound like the developer wrote it.

Use short sentences.

Prefer:

> "I kept this stateless because Railway already owns deployment state."

over:

> "The system leverages a stateless architecture to provide a highly scalable and resilient deployment-management experience."

Prefer:

> "I considered using a database, but there wasn't enough application state to justify it."

over:

> "A deliberate architectural decision was made to avoid persistent storage."

The writing should be technically accurate but conversational.

## 6. Do not invent experience

The repository must never imply that the developer has professional experience with something they have not actually used professionally.

The project may demonstrate learning.

It must not turn learning into fake prior experience.

For example:

Good:

> "I had not used GraphQL professionally before this project, so I kept the GraphQL integration small and isolated."

Bad:

> "I have extensive experience designing GraphQL APIs."

The same rule applies to Node.js, OAuth, Railway, or any other technology.

## 7. Keep the architecture honest

The project is intentionally small.

Do not add infrastructure just because it sounds senior.

Do not add:

* Redis;
* PostgreSQL;
* queues;
* workers;
* Temporal;
* Kafka;
* WebSockets;
* microservices;
* Kubernetes;

unless a real requirement appears and the existing architecture cannot solve it cleanly.

If a simpler design works, keep it.

## 8. Show engineering judgment through decisions

For every important architectural decision, keep a short decision note.

Use this format:

### Decision

What we chose.

### Why

The actual reason.

### Alternatives

The realistic alternatives considered.

### Why not

Why they were not chosen.

Keep each decision short.

Examples of decisions worth recording:

* Why Next.js instead of a separate backend?
* Why no database?
* Why polling?
* Why server-side Railway API access?
* Why OAuth?
* Why project-scoped permissions?
* Why a fixed Sandbox image?
* Why no background worker?
* How are duplicate deployment requests handled?
* What does "idempotent" mean in this application?

Do not create decision records for trivial implementation details.

## 9. Be honest about guarantees

Do not claim stronger guarantees than the implementation provides.

For example, do not say:

> "The application guarantees exactly-once deployment."

If the application only checks current state before issuing a mutation, say so.

A better description is:

> "The server prevents conflicting deployment commands based on the current Railway state. It does not provide distributed exactly-once execution."

Being precise is more important than sounding impressive.

## 10. Error messages

Write error messages like a developer talking to another developer.

Bad:

> "An unexpected error occurred while processing your request."

Better:

> "Railway could not be reached. The deployment state may have changed, so refresh before trying again."

Bad:

> "Deployment operation failed due to an infrastructure exception."

Better:

> "The deployment failed. Check the build logs for details."

## 11. UI copy

Keep UI text short.

Prefer:

* "Deploy"
* "Stop"
* "Restart"
* "Cancel"
* "Building"
* "Deploying"
* "Running"
* "Failed"
* "Crashed"

Avoid:

* "Initiate deployment workflow"
* "Terminate running workload"
* "Restart application lifecycle"
* "Deployment orchestration in progress"

The product should feel like a developer tool.

## 12. Don't over-document code

The code should explain itself through:

* good names;
* small functions;
* clear types;
* sensible file structure.

Use comments only where a future engineer might otherwise ask "why?"

Do not add comments to increase apparent code quality.

## 13. Keep generated code under control

Claude Code may generate an implementation, but it must not:

* create large files unnecessarily;
* create duplicate utility functions;
* create multiple abstractions for the same thing;
* add dependencies without a reason;
* add TODOs for work that is not needed;
* generate placeholder features;
* leave dead code;
* leave unused types;
* leave commented-out code.

After each feature, clean up unused code.

## 14. Prefer boring code

If this:

```ts
const deployment = await railway.getDeployment(id);

if (!deployment) {
  return null;
}
```

is enough, use it.

Do not turn it into a generic `ResourceResolutionPipeline`.

If this:

```ts
switch (deployment.status) {
  case "BUILDING":
    return "PROVISIONING";
  case "SUCCESS":
    return "RUNNING";
}
```

is enough, use it.

Do not build a configurable state-machine framework.

## 15. Human commit messages

Use normal commit messages.

Examples:

```text
add Railway OAuth login
add project and environment selection
add Sandbox creation
add deployment polling
handle deployment failures
add deployment logs
add Railway API error handling
polish control room states
```

Avoid:

```text
feat: implement comprehensive enterprise-grade asynchronous deployment orchestration subsystem
```

## 16. Developer understanding is a hard requirement

Before moving past a major feature, stop and explain:

1. what was implemented;
2. why it exists;
3. what could go wrong;
4. how the code handles that;
5. what the important files are.

If the developer asks why something was implemented a particular way, explain it before changing the code.

Do not hide architectural decisions behind generated code.

## 17. The final result should have a clear personality

The repository should feel:

* small;
* thoughtful;
* practical;
* direct;
* technically serious;
* not over-engineered.

The best outcome is not:

> "Wow, they built a huge system."

The best outcome is:

> "They made surprisingly good decisions for such a small system."

That is the standard.
