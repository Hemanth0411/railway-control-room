# 07 — Deployment & README

## Deployment target

The Control Room itself should be deployed on Railway.

The Sandbox service is also created/managed on Railway.

This creates a useful dogfooding relationship:

Railway hosts the Control Room
and
Railway is controlled by the Control Room.

## Railway deployment of Control Room

Use a single Railway service for the application.

Recommended production configuration:
- Node runtime through the chosen Next.js deployment strategy;
- production build;
- start command appropriate to the chosen Next.js version;
- health endpoint if useful;
- environment variables configured through Railway secrets.

Do not add another service unless required.

## Environment variables

Maintain `.env.example` with names only.

Likely categories:
- Railway OAuth client ID;
- Railway OAuth client secret;
- Railway OAuth redirect URI;
- application session secret;
- application base URL;
- optional Sandbox image reference.

Never commit real values.

## OAuth app registration

Before production:
1. Create Railway OAuth app in a workspace where the developer has permission.
2. Configure local redirect URI.
3. Configure production redirect URI.
4. Select Web/Confidential app type.
5. Store client secret only in server-side secrets.
6. Verify requested scopes.
7. Test login and logout.
8. Test token refresh.

Exact Railway setup must follow current Railway OAuth docs.

## Free-tier constraint

The project should be able to run on Railway Free for development/demo use if resource usage stays within the Free plan's limits.

Current Railway docs state:
- Free plan is $0/month;
- $1 of free resource credit per month;
- 1 vCPU;
- 0.5 GB RAM per service;
- 1 replica;
- 1 GB ephemeral storage;
- 0.5 GB volume storage.

A new account receives a one-time $5 trial credit for up to 30 days before the Free plan.

Do not promise that continuous production uptime or heavy repeated deployment testing will fit within Free.

Keep the Control Room and Sandbox small and stop unused workloads.

## Cost-control behavior

The UI should not create unlimited Sandbox services.

Use one Sandbox per project/environment for the MVP.

Avoid background polling when no user is viewing the control room.

Stop polling terminal deployments.

Avoid unnecessary image rebuilds.

## README structure

### 1. What this is

One paragraph describing the Control Room.

### 2. Why I built it

Explain that the project explores asynchronous deployment control through Railway's GraphQL API.

Do not write a fake story about professional experience.

### 3. Architecture

Include one simple diagram.

Explain:
- browser;
- Next.js server;
- Railway client;
- GraphQL;
- OAuth;
- stateless design.

### 4. Async state model

Explain:
- command vs observed state;
- deployment ID correlation;
- polling;
- terminal states;
- failure handling;
- duplicate-action prevention.

### 5. API integration

List the Railway operations actually used.

Link to official Railway docs.

### 6. Security

Explain:
- OAuth;
- scopes;
- server-side tokens;
- secure session;
- no Railway credentials in browser.

### 7. Trade-offs

Explicitly state:
- no database;
- no queue;
- no worker;
- polling instead of WebSocket for MVP;
- fixed Sandbox image;
- one Sandbox per project/environment.

Explain why.

### 8. Testing

Explain:
- unit;
- integration;
- E2E;
- manual Railway smoke tests.

### 9. Local development

Give exact steps:
- install;
- configure env;
- register OAuth redirect;
- run dev server;
- run tests.

### 10. Deployment

Give exact Railway deployment steps.

### 11. Known limitations

Be honest.

Examples:
- stateless sessions/operation state;
- polling;
- Free-tier resource constraints;
- no arbitrary image selection;
- no service deletion in UI.

### 12. Demo

Give the shortest reliable demo sequence:
Login → select project/environment → create Sandbox → deploy → watch state → logs → restart → stop → failure case.

## README writing rule

Do not use:
- "enterprise-grade";
- "production-ready";
- "scalable architecture";
- "highly available";
- "distributed system";
- "zero-downtime";
unless the implementation actually proves the claim.

Prefer:
- "stateless";
- "typed";
- "rate-aware";
- "state-aware";
- "server-side OAuth";
- "explicit failure handling".

## Interview review preparation

The README should make it easy to answer:
- Why Next.js instead of a separate backend?
- Why no database?
- Why polling?
- Why server-side Railway API?
- Why OAuth?
- Why project:member?
- How do you prevent duplicate deployments?
- What happens if the browser refreshes?
- What happens if Railway returns 429?
- What happens if deployment fails?
- What happens if the access token expires?
- What happens if the deployment command succeeds but the deployment later fails?
