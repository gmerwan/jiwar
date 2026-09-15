# Community Notices — Product and Architecture Plan

Date: 2026-09-14
Status: Initial planning baseline; no implementation started.

## 1. Goal

Build a responsive web app for discovering community notices near a chosen location, accessible from phone, tablet, and desktop browsers. Progressive Web App (PWA) capabilities may be added later if useful. Funerals are the motivating use case, but the core product should support other community announcements later without a rewrite.

The initial discovery radius is 20 km, configurable rather than hardcoded. People can use their current location or select an area manually. Continuous location tracking is not required.

The project is also an opportunity to gain practical experience with React, NestJS, and TypeScript across frontend and backend.

## 2. Confirmed decisions

- Frontend: React with TypeScript, delivered as a responsive web app.
- PWA installation and offline capabilities are optional later enhancements, not requirements for the initial release.
- Backend: NestJS with TypeScript.
- Product terminology: community notice.
- Discovery offers list and map views.
- Users submit notices through a form.
- Notices require approval before public publication.
- Prevent duplicate notices rather than simply grouping nearby map markers.
- Plan for a separate, independent AI-based review service later; do not build it in the initial version.

Kotlin Multiplatform and then React Native were considered. The agreed direction is now a regular React web frontend with a NestJS backend; native mobile apps are not part of the initial scope.

## 3. Proposed first-version experience

### Nearby notices

- A List / Map toggle sharing the same results and filters.
- Default search radius of 20 km, with an adjustable radius.
- Current location or manually selected area.
- List cards show title, category, date/time, and distance.
- Map markers open a preview leading to notice details.
- A “Search this area” action after moving the map.
- Basic category and date filters.
- Clear loading, empty, location-permission-denied, and network-error states.

### Notice details

- Title, category, description, and publication/review status.
- Location, schedule, and directions.
- Attendance guidance where applicable: public, invitation-only, or restricted.
- Responsible organizer information where appropriate and permitted.
- Proposed actions: follow updates and report incorrect information.

The model should allow a notice to describe multiple scheduled activities, such as a funeral service, burial, and family visitation. Whether the first form supports multiple activities immediately remains to be decided.

### Submit a community notice

A short guided form:

1. What: category and title.
2. Where and when: location and schedule.
3. Possible matches: check whether an existing notice describes the same event.
4. Details and review: description, applicable attendance/privacy information, and submission.

The submitter can follow or suggest a correction to an existing notice instead of creating another. If candidates are unrelated, they can continue with a separate submission.

### Submission tracking

Authors can see their own pending submissions, review feedback, and the outcome. Pending content is not publicly discoverable.

### Moderation

A private review queue lets authorized moderators:

- Approve for publication.
- Request changes with a reason.
- Reject with a reason.
- Mark a submission as a duplicate and link it to the existing notice.

The initial moderator population and review interface are not yet decided. The recommendation is a single project administrator initially, with backend role support for future moderators.

## 4. Duplicate prevention

### Principle

A notice is the shared record of an event or announcement. A submission or correction contributes information to that record; it should not necessarily create another public notice.

Proximity alone does not establish duplication. Two funerals at the same venue can be distinct events. Map-marker clustering is a display concern, not a duplicate-detection mechanism.

### Initial approach

Use server-side, explainable matching rules based on:

- Category.
- Relevant dates and times.
- Location or venue proximity.
- Category-specific identifying details, such as a person's name for a funeral notice.

Show likely public matches during submission and provide candidates to moderators during review. Private pending submissions must not be exposed to other submitters through duplicate suggestions.

Do not automatically merge uncertain matches. Moderators resolve ambiguous cases and preserve the relationship between duplicate submissions and the canonical notice. Recheck duplicate candidates at review time because another submission may have been approved in the meantime.

Duplicate similarity and factual verification are separate concerns.

## 5. Approval and revisions

### Proposed review states

- Draft.
- Pending review.
- Changes requested.
- Approved.
- Rejected.
- Duplicate, linked to another notice.

Public event lifecycle states, such as upcoming, cancelled, or archived, are separate from moderation status.

### Publication rules

- Only approved content is publicly accessible through lists, maps, search, or notice-detail endpoints.
- Authors can access their own submissions; moderators can access submissions within their authorized scope.
- Editing a published notice creates a pending revision rather than silently replacing approved content.
- The last approved revision remains public until its replacement is approved, unless an authorized withdrawal or takedown removes it.
- Review decisions apply to an exact revision. Stale decisions cannot approve subsequently edited content.
- Record the reviewer, timestamp, outcome, and reason for every decision.
- Provide a correction/takedown path and define cancellation handling before implementation.

## 6. Trust and privacy

Funeral notices need extra care because incorrect reports or exposed family information can cause harm.

Proposed safeguards:

- Distinguish moderation approval from confirmation by an organizer or trusted source.
- Prefer public venues; publish family-home addresses only with explicit permission.
- Clearly state whether visitors are welcome.
- Keep follower identities private.
- Support reporting, corrections, and removal requests.
- Do not gamify funeral submissions or reward posting volume.
- Collect only the personal information needed for the service.

An AI system cannot establish that a death occurred or that a family consented merely from plausible wording.

## 7. Technical architecture

### Confirmed stack

- React + TypeScript responsive web app.
- NestJS + TypeScript API.

### Recommended supporting choices — not yet finalized

- PostgreSQL with PostGIS for geographic radius queries.
- One repository containing web, API, and API-contract packages.
- Protected moderator routes in the web app, with authorization enforced by NestJS.
- A modular NestJS backend initially, rather than multiple deployed microservices.
- Explicit module boundaries for notices, geographic discovery, moderation, identity/authorization, and optional following/notifications.
- Shared or generated API contracts without exposing database entities directly to web clients.

React build tooling and rendering strategy, database tooling, authentication, maps, hosting, and notification providers remain open choices. A Vite-based React app is a simple starting candidate; decide whether search indexing and rich link previews require server rendering before finalizing it.

### Web experience

- Responsive layouts for phones, tablets, and desktops, with accessible forms, keyboard navigation, and touch-friendly controls.
- Shareable URLs for approved notices; opening a link must not require installing an app.
- Browser geolocation requested only when needed, with HTTPS in production and manual area selection when permission is denied or location is unavailable.
- Core browsing, submission, and review work in an ordinary browser without PWA installation.
- Define indexing and link-preview rules carefully: pending/private submissions must never appear in public metadata or search results.

### Optional PWA phase

- Add a web app manifest and installation support where available.
- Introduce service-worker caching only with an explicit offline and update policy.
- Start with caching the app shell; do not cache private submissions or moderator data by default.
- If approved notices are cached later, show freshness/offline status and account for cancellations and takedowns. Offline copies cannot be guaranteed to reflect immediate removals.
- Keep submission and approval online-only initially; offline queuing is not an initial requirement.
- Treat web push as optional: availability and installation requirements vary by browser and platform. Following notices must remain useful without push permission.

## 8. Independent AI review service — later phase

### Boundary

Start with manual moderation behind a clear NestJS interface. Later, a separately deployable service can process review requests through a versioned API or asynchronous integration.

The external reviewer receives only the necessary content and context and returns structured review output, such as:

- Recommended outcome.
- Reasons and relevant evidence.
- Possible duplicate matches.
- Flags requiring human attention.
- The submission/revision identifier and review-policy version.

NestJS retains publication authority, authorization enforcement, and audit history. The AI service does not write directly to the application's database.

### Reliability and safety

- Authenticate the service integration and validate its responses.
- Bind responses to the exact revision submitted for review.
- Make repeated delivery safe and reject stale decisions.
- Timeouts, service failures, or invalid responses leave the notice pending.
- Treat submitted notice text as untrusted content, not instructions to the reviewer.
- Minimize personal data sent externally and define retention rules before integration.
- Preserve manual review and override paths.

### Rollout

1. Manual review: establish policy and collect representative review examples.
2. AI-assisted review: suggest decisions while humans retain final approval.
3. Selective automatic approval: consider it only for categories and conditions supported by measured accuracy and acceptable error rates.

Evaluate against human-reviewed examples before enabling automation. Sensitive notices, including funerals, should retain human or trusted-source confirmation requirements where facts and consent cannot be independently established.

No AI provider or model has been selected.

## 9. Keep out of the initial scope

- AI-based approval implementation.
- Native Android/iOS apps and app-store distribution.
- PWA installation, offline caching, and background synchronization until a later phase is justified.
- Public comments and private messaging.
- Donations or payments.
- Popularity rankings and posting rewards.
- Continuous background location tracking.
- A fully configurable platform for every possible notice category.
- Complex microservice infrastructure before there is a demonstrated need.

Following and push notifications were recommended, but their inclusion in the first implementation milestone still needs confirmation.

## 10. Open decisions before implementation

1. Who moderates initially: project administrator only or approved community organizers too?
2. Which country/region and languages are targeted first?
3. Which notice categories are available at launch?
4. What evidence or organizer consent is required for sensitive notices?
5. Can users browse without an account, and what authentication is required to submit?
6. Which React tooling/rendering approach, and what search-indexing and link-preview behavior is desired?
7. Which web map/geocoding provider and hosting budget?
8. Confirm protected moderator routes within the same web app versus a separate admin web app.
9. Are following and push notifications part of the first milestone?
10. Does the initial form support multiple locations/times per notice?
11. What are the cancellation, withdrawal, appeal, retention, and deletion rules?

## 11. Proposed delivery sequence

1. Resolve the remaining product and architecture decisions.
2. Agree on low-fidelity layouts for discovery, details, submission, and review.
3. Write an implementation plan with acceptance criteria.
4. Scaffold the React web app and NestJS API.
5. Deliver the manual submission → review → publication flow end to end.
6. Add geographic list/map discovery and duplicate suggestions.
7. Add agreed update-following features and strengthen privacy, moderation, and reliability tests.
8. Evaluate optional PWA installation/offline support as a separate enhancement after the web experience is working.
9. Treat independent AI moderation as a separate project phase.

This document records the planning discussion. It is not authorization to scaffold, deploy, purchase services, or implement the later AI system.
