# ShadowSense SDK

## Features

- Session ID + anonymous ID generation
- Auto tracking: page view, click, scroll depth, tab switch
- Session start and session end events
- Consent-aware tracking and opt-out support

## Usage

```ts
import { shadowSense } from "@shadowsense/sdk";

shadowSense.init({
  apiBaseUrl: "http://localhost:5000",
  siteId: "my-site",
  consent: true,
});
```

## Consent Banner Pattern

```ts
const accepted = localStorage.getItem("analytics_consent") === "1";

shadowSense.init({
  apiBaseUrl: "http://localhost:5000",
  siteId: "my-site",
  consent: accepted,
});
```

When user opts out:

```ts
shadowSense.optOut();
```
