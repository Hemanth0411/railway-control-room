# 05 — UI / UX Direction

## Design goal

Build a developer tool that looks polished and deliberate without turning the project into a visual-design exercise.

The visual standard is:
- clean;
- dark or neutral developer-tool aesthetic;
- strong typography;
- clear hierarchy;
- restrained color;
- compact information density;
- excellent status feedback;
- responsive;
- accessible.

Avoid:
- excessive gradients;
- giant hero sections;
- unnecessary animations;
- dashboard-card spam;
- fake "AI" visual language;
- visual effects that obscure state.

## Suggested product structure

### Screen 1 — Landing / Login

Purpose:
- explain the tool in one sentence;
- show the core benefit;
- Login with Railway button.

Possible headline:
"Control a Railway deployment without losing sight of its state."

Do not over-market.

### Screen 2 — Resource selection

Show:
- selected Railway account identity;
- project selector;
- environment selector.

Then:
- existing Sandbox status if found;
- Create Sandbox if none exists.

### Screen 3 — Control Room

Primary screen.

Suggested layout:

Header:
- product name;
- project/environment;
- user identity;
- logout.

Main:
- current Sandbox status;
- current deployment ID/short identifier;
- deployment timeline;
- primary action;
- secondary actions.

Secondary:
- logs;
- recent deployments;
- deployment details.

## Status visualization

Use both:
- text;
- semantic indicator.

Never rely on color alone.

Examples:
- "Building"
- "Deploying"
- "Running"
- "Failed"
- "Crashed"
- "Stopped"

Show the raw Railway state in a secondary/detail position when useful.

## Primary actions

When no active deployment:
- Deploy

When running:
- Restart
- Stop

When queued/building:
- Cancel

When provisioning:
- disable conflicting actions;
- show progress;
- allow safe navigation/refresh.

## Confirmation

Require confirmation for:
- Stop, if stopping has meaningful consequences.
- Any future destructive operation.

Do not require confirmation for harmless state refresh.

## Logs

Use a terminal-like surface:
- timestamp;
- severity;
- message;
- auto-scroll only while the user is at the bottom;
- allow manual scrolling without fighting the user;
- show loading state;
- show empty state;
- show log-fetch failure independently from deployment state.

## Deployment timeline

Represent the lifecycle:

Queued
→ Building
→ Deploying
→ Running

If failed:

Queued
→ Building
→ Failed

If crashed:

Running
→ Crashed

Use actual observed timestamps where available.

Do not fabricate timing.

## Error presentation

Every error should answer:
1. What happened?
2. Is the state known?
3. Can the user retry?
4. What should they do?

Bad:
"Error 500."

Better:
"Railway could not be reached. We don't know whether the deployment command was accepted. Refresh the deployment state before retrying."

## Empty states

Examples:
- no projects authorized;
- no environments;
- no Sandbox yet;
- no deployment history;
- no logs.

Every empty state explains what to do next.

## Responsive behavior

The primary control room must work on:
- desktop;
- tablet;
- mobile width.

The desktop layout can be denser, but mobile must remain usable.

## Accessibility

Minimum:
- semantic buttons;
- keyboard focus;
- visible focus state;
- aria labels where necessary;
- no color-only status;
- reasonable contrast;
- loading indicators that do not rely only on animation.

## Design implementation rule

Claude Code may propose visual details, but must preserve this hierarchy:

1. state clarity;
2. action clarity;
3. error clarity;
4. logs/history;
5. visual polish.

Do not spend implementation time polishing decorative elements while async behavior is incomplete.
